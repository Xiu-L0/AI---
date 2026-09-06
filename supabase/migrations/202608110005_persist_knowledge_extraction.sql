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
