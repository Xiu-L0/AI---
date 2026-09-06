create or replace function public.lock_claimed_processing_job(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_expected_job_type text
) returns public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_run public.processing_runs;
begin
  select *
  into v_job
  from public.processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'processing job not found'
      using errcode = 'P0002';
  end if;

  select *
  into v_run
  from public.processing_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'processing run not found'
      using errcode = 'P0002';
  end if;

  if v_run.processing_job_id <> v_job.id
    or v_run.owner_user_id <> v_job.owner_user_id
    or v_run.space_id <> v_job.space_id
  then
    raise exception 'processing job ancestry mismatch'
      using errcode = '22023';
  end if;

  perform public.assert_processing_job_ancestry(v_job);

  if v_job.job_type is distinct from p_expected_job_type then
    raise exception 'processing job type mismatch'
      using errcode = '22023';
  end if;

  if v_job.status <> 'processing'
    or v_job.locked_by is distinct from btrim(p_worker_id)
    or v_run.status <> 'processing'
  then
    raise exception 'processing job lease is not owned by this worker'
      using errcode = '42501';
  end if;

  return v_job;
end;
$$;

create or replace function public.enqueue_followup_processing_job(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_job_type text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  if p_job_type not in ('build_source_blocks', 'extract_knowledge') then
    raise exception 'unsupported followup job type'
      using errcode = '22023';
  end if;

  v_job := public.lock_claimed_processing_job(
    p_job_id,
    p_run_id,
    p_worker_id,
    'normalize_source'
  );

  insert into public.processing_jobs (
    owner_user_id,
    space_id,
    source_version_id,
    job_type
  )
  values (
    v_job.owner_user_id,
    v_job.space_id,
    v_job.source_version_id,
    p_job_type
  )
  on conflict (source_version_id, job_type) do nothing;
end;
$$;

create or replace function public.replace_source_blocks_and_enqueue_extract(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_blocks jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_item_id uuid;
  v_block jsonb;
  v_message public.source_messages;
begin
  if jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'source block payload must be an array'
      using errcode = '22023';
  end if;

  v_job := public.lock_claimed_processing_job(
    p_job_id,
    p_run_id,
    p_worker_id,
    'build_source_blocks'
  );

  select source_item_id
  into v_item_id
  from public.source_versions
  where id = v_job.source_version_id
    and owner_user_id = v_job.owner_user_id;

  if v_item_id is null then
    raise exception 'processing job ancestry mismatch'
      using errcode = '22023';
  end if;

  for v_block in
    select value
    from jsonb_array_elements(p_blocks) as value
  loop
    if coalesce(v_block->>'block_type', '') <> 'message' then
      raise exception 'Stage 1B source blocks must have block_type message'
        using errcode = '22023';
    end if;

    select *
    into v_message
    from public.source_messages
    where id = (v_block->>'source_message_id')::uuid
      and source_version_id = v_job.source_version_id
      and source_item_id = v_item_id
      and owner_user_id = v_job.owner_user_id;

    if not found then
      raise exception 'processing job ancestry mismatch'
        using errcode = '22023';
    end if;

    if v_block->>'locator_key' <> ('message:' || v_message.external_message_id || '/body') then
      raise exception 'source block locator does not match the claimed message'
        using errcode = '22023';
    end if;
  end loop;

  delete from public.source_blocks as block
  where block.source_version_id = v_job.source_version_id
    and block.owner_user_id = v_job.owner_user_id
    and block.space_id = v_job.space_id
    and not exists (
      select 1
      from jsonb_array_elements(p_blocks) as incoming
      where incoming->>'locator_key' = block.locator_key
        and incoming->>'content_hash' = block.content_hash
    );

  insert into public.source_blocks (
    owner_user_id,
    space_id,
    source_item_id,
    source_version_id,
    source_message_id,
    block_type,
    ordinal,
    locator_key,
    locator_json,
    content_hash,
    text_content
  )
  select
    v_job.owner_user_id,
    v_job.space_id,
    v_item_id,
    v_job.source_version_id,
    (incoming->>'source_message_id')::uuid,
    'message',
    (incoming->>'ordinal')::integer,
    incoming->>'locator_key',
    incoming->'locator_json',
    incoming->>'content_hash',
    incoming->>'text_content'
  from jsonb_array_elements(p_blocks) as incoming
  on conflict (source_version_id, locator_key, content_hash) do update
  set
    ordinal = excluded.ordinal,
    source_message_id = excluded.source_message_id,
    locator_json = excluded.locator_json,
    text_content = excluded.text_content,
    updated_at = now();

  insert into public.processing_jobs (
    owner_user_id,
    space_id,
    source_version_id,
    job_type
  )
  values (
    v_job.owner_user_id,
    v_job.space_id,
    v_job.source_version_id,
    'extract_knowledge'
  )
  on conflict (source_version_id, job_type) do nothing;
end;
$$;

revoke all on function public.lock_claimed_processing_job(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.lock_claimed_processing_job(uuid, uuid, text, text)
to service_role;

revoke all on function public.enqueue_followup_processing_job(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.enqueue_followup_processing_job(uuid, uuid, text, text)
to service_role;

revoke all on function public.replace_source_blocks_and_enqueue_extract(uuid, uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function public.replace_source_blocks_and_enqueue_extract(uuid, uuid, text, jsonb)
to service_role;

alter table public.knowledge_items
  add column if not exists source_version_id uuid,
  add column if not exists extraction_key text;

alter table public.knowledge_items
  drop constraint if exists knowledge_items_source_version_owner_fk;

alter table public.knowledge_items
  add constraint knowledge_items_source_version_owner_fk
    foreign key (source_version_id, owner_user_id)
    references public.source_versions(id, owner_user_id);

alter table public.knowledge_items
  drop constraint if exists knowledge_items_extraction_key_format;

alter table public.knowledge_items
  add constraint knowledge_items_extraction_key_format
    check (
      extraction_key is null
      or (
        source_version_id is not null
        and extraction_key ~ '^[a-f0-9]{64}$'
      )
    );

create unique index if not exists knowledge_items_space_source_extraction_key_idx
  on public.knowledge_items (space_id, source_version_id, extraction_key)
  where extraction_key is not null;

alter table public.knowledge_versions
  drop constraint if exists knowledge_versions_processor_run_owner_space_fk;

alter table public.processing_runs
  drop constraint if exists processing_runs_id_owner_space_key;

alter table public.processing_runs
  add constraint processing_runs_id_owner_space_key
    unique (id, owner_user_id, space_id);

alter table public.knowledge_versions
  add constraint knowledge_versions_processor_run_owner_space_fk
    foreign key (processor_run_id, owner_user_id, space_id)
    references public.processing_runs(id, owner_user_id, space_id);

create or replace function public.persist_knowledge_extraction(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_prompt_version text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_draft jsonb;
  v_citation jsonb;
  v_locator text;
  v_claim_path text;
  v_quote text;
  v_extraction_key text;
  v_item public.knowledge_items;
  v_block_id uuid;
  v_task_id uuid;
  v_user_governed boolean;
  v_block_count integer;
  v_results jsonb := '[]'::jsonb;
  v_conditions text[];
  v_limitations text[];
  v_input_scope jsonb;
begin
  if p_prompt_version is null
    or char_length(btrim(p_prompt_version)) not between 1 and 100
  then
    raise exception 'prompt version is invalid'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'knowledge extraction payload must be an object'
      using errcode = '22023';
  end if;

  v_job := public.lock_claimed_processing_job(
    p_job_id,
    p_run_id,
    p_worker_id,
    'extract_knowledge'
  );

  if (p_payload->>'source_version_id') is distinct from v_job.source_version_id::text then
    raise exception 'knowledge extraction payload source version does not match the claimed job'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload->'drafts') <> 'array'
    or jsonb_array_length(p_payload->'drafts') < 1
    or jsonb_array_length(p_payload->'drafts') > 12
  then
    raise exception 'knowledge extraction drafts must contain between 1 and 12 items'
      using errcode = '22023';
  end if;

  for v_draft in
    select value
    from jsonb_array_elements(p_payload->'drafts') as value
  loop
    v_extraction_key := v_draft->>'extraction_key';
    if v_extraction_key is null or v_extraction_key !~ '^[a-f0-9]{64}$' then
      raise exception 'knowledge extraction_key must be a SHA-256 hex digest'
        using errcode = '22023';
    end if;

    if coalesce(btrim(v_draft->>'title'), '') = ''
      or coalesce(btrim(v_draft->>'l0_summary'), '') = ''
      or v_draft->>'knowledge_type' is null
      or v_draft->>'evidence_mode' is null
      or v_draft->>'confidence' is null
    then
      raise exception 'knowledge draft is missing required fields'
        using errcode = '22023';
    end if;

    if jsonb_typeof(coalesce(v_draft->'citations', '[]'::jsonb)) <> 'array' then
      raise exception 'knowledge draft citations must be an array'
        using errcode = '22023';
    end if;

    if v_draft->>'evidence_mode' = 'cited'
      and jsonb_array_length(coalesce(v_draft->'citations', '[]'::jsonb)) < 1
    then
      raise exception 'cited knowledge drafts require at least one citation'
        using errcode = '22023';
    end if;

    for v_citation in
      select value
      from jsonb_array_elements(coalesce(v_draft->'citations', '[]'::jsonb)) as value
    loop
      v_locator := v_citation->>'locator_key';
      v_claim_path := v_citation->>'claim_path';
      v_quote := btrim(coalesce(v_citation->>'quote_excerpt', ''));

      if v_locator is null
        or v_claim_path not in (
          'l0_summary',
          'l1_content',
          'l2_content',
          'conditions',
          'limitations'
        )
        or char_length(v_quote) < 1
      then
        raise exception 'knowledge citation is invalid'
          using errcode = '22023';
      end if;

      select count(*)
      into v_block_count
      from public.source_blocks as block
      where block.source_version_id = v_job.source_version_id
        and block.owner_user_id = v_job.owner_user_id
        and block.space_id = v_job.space_id
        and block.locator_key = v_locator;

      if v_block_count <> 1 then
        raise exception 'knowledge citation locator does not match a source block'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  v_input_scope := case
    when jsonb_typeof(p_payload->'input_scope') = 'object' then p_payload->'input_scope'
    else null
  end;

  update public.processing_runs as run
  set
    prompt_or_pipeline_version = btrim(p_prompt_version),
    input_scope = v_input_scope,
    provider = nullif(btrim(coalesce(p_payload->>'provider', '')), ''),
    model = nullif(btrim(coalesce(p_payload->>'model', '')), '')
  where run.id = p_run_id
    and run.processing_job_id = v_job.id
    and run.owner_user_id = v_job.owner_user_id
    and run.space_id = v_job.space_id;

  for v_draft in
    select value
    from jsonb_array_elements(p_payload->'drafts') as value
  loop
    v_extraction_key := v_draft->>'extraction_key';
    v_task_id := null;

    select *
    into v_item
    from public.knowledge_items as item
    where item.space_id = v_job.space_id
      and item.source_version_id = v_job.source_version_id
      and item.extraction_key = v_extraction_key
    for update;

    if found then
      v_user_governed :=
        v_item.status not in ('ai_draft', 'pending_review')
        or coalesce(cardinality(v_item.human_locked_fields), 0) > 0
        or exists (
          select 1
          from public.knowledge_versions as version
          where version.knowledge_item_id = v_item.id
            and version.change_origin = 'user'
        );

      if v_user_governed then
        if v_item.status = 'confirmed' then
          select task.id
          into v_task_id
          from public.review_tasks as task
          where task.knowledge_item_id = v_item.id
            and task.task_type = 'conflict'
            and task.status = 'open';

          if v_task_id is null then
            insert into public.review_tasks (
              owner_user_id,
              space_id,
              knowledge_item_id,
              task_type,
              status,
              priority,
              reason
            )
            values (
              v_item.owner_user_id,
              v_item.space_id,
              v_item.id,
              'conflict',
              'open',
              40,
              'AI re-extraction left confirmed knowledge unchanged'
            )
            returning id into v_task_id;
          end if;
        end if;

        v_results := v_results || jsonb_build_array(
          jsonb_build_object(
            'knowledge_item_id', v_item.id,
            'extraction_key', v_extraction_key,
            'review_task_id', v_task_id,
            'reused', true,
            'user_governed', true
          )
        );
        continue;
      end if;

      select task.id
      into v_task_id
      from public.review_tasks as task
      where task.knowledge_item_id = v_item.id
        and task.task_type = 'knowledge_draft'
        and task.status = 'open';

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'knowledge_item_id', v_item.id,
          'extraction_key', v_extraction_key,
          'review_task_id', v_task_id,
          'reused', true,
          'user_governed', false
        )
      );
      continue;
    end if;

    select coalesce(array_agg(elem order by ord), '{}'::text[])
    into v_conditions
    from jsonb_array_elements_text(coalesce(v_draft->'conditions', '[]'::jsonb))
      with ordinality as entries(elem, ord);

    select coalesce(array_agg(elem order by ord), '{}'::text[])
    into v_limitations
    from jsonb_array_elements_text(coalesce(v_draft->'limitations', '[]'::jsonb))
      with ordinality as entries(elem, ord);

    insert into public.knowledge_items (
      owner_user_id,
      space_id,
      created_by_user_id,
      source_version_id,
      extraction_key,
      knowledge_type,
      title,
      l0_summary,
      l1_content,
      l2_content,
      conditions,
      limitations,
      confidence,
      status,
      evidence_mode
    )
    values (
      v_job.owner_user_id,
      v_job.space_id,
      v_job.owner_user_id,
      v_job.source_version_id,
      v_extraction_key,
      (v_draft->>'knowledge_type')::public.knowledge_type,
      btrim(v_draft->>'title'),
      btrim(v_draft->>'l0_summary'),
      coalesce(v_draft->>'l1_content', ''),
      coalesce(v_draft->>'l2_content', ''),
      v_conditions,
      v_limitations,
      (v_draft->>'confidence')::numeric,
      'pending_review',
      (v_draft->>'evidence_mode')::public.knowledge_evidence_mode
    )
    returning * into v_item;

    insert into public.knowledge_versions (
      owner_user_id,
      space_id,
      knowledge_item_id,
      version,
      snapshot_json,
      change_origin,
      processor_run_id
    )
    values (
      v_item.owner_user_id,
      v_item.space_id,
      v_item.id,
      1,
      jsonb_build_object(
        'title', v_item.title,
        'knowledge_type', v_item.knowledge_type,
        'l0_summary', v_item.l0_summary,
        'l1_content', v_item.l1_content,
        'l2_content', v_item.l2_content,
        'conditions', to_jsonb(v_item.conditions),
        'limitations', to_jsonb(v_item.limitations),
        'confidence', v_item.confidence,
        'evidence_mode', v_item.evidence_mode,
        'status', v_item.status,
        'prompt_version', btrim(p_prompt_version),
        'extraction_key', v_extraction_key
      ),
      'ai',
      p_run_id
    );

    for v_citation in
      select value
      from jsonb_array_elements(coalesce(v_draft->'citations', '[]'::jsonb)) as value
    loop
      select block.id
      into v_block_id
      from public.source_blocks as block
      where block.source_version_id = v_job.source_version_id
        and block.owner_user_id = v_job.owner_user_id
        and block.space_id = v_job.space_id
        and block.locator_key = v_citation->>'locator_key';

      insert into public.citations (
        owner_user_id,
        space_id,
        knowledge_item_id,
        source_block_id,
        claim_path,
        quote_excerpt,
        origin_type,
        review_status
      )
      values (
        v_item.owner_user_id,
        v_item.space_id,
        v_item.id,
        v_block_id,
        v_citation->>'claim_path',
        btrim(v_citation->>'quote_excerpt'),
        'ai',
        'pending'
      );
    end loop;

    insert into public.review_tasks (
      owner_user_id,
      space_id,
      knowledge_item_id,
      task_type,
      status,
      priority,
      reason
    )
    values (
      v_item.owner_user_id,
      v_item.space_id,
      v_item.id,
      'knowledge_draft',
      'open',
      50,
      'AI draft needs review'
    )
    returning id into v_task_id;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'knowledge_item_id', v_item.id,
        'extraction_key', v_extraction_key,
        'review_task_id', v_task_id,
        'reused', false,
        'user_governed', false
      )
    );
  end loop;

  return jsonb_build_object('items', v_results);
end;
$$;

revoke all on function public.persist_knowledge_extraction(uuid, uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.persist_knowledge_extraction(uuid, uuid, text, text, jsonb)
to service_role;
