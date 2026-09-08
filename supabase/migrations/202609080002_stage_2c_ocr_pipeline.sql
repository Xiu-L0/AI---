alter table public.source_blocks
  add column source_attachment_id uuid,
  add constraint source_blocks_attachment_version_owner_fk
    foreign key (
      source_attachment_id,
      source_version_id,
      owner_user_id
    )
    references public.source_attachments (
      id,
      source_version_id,
      owner_user_id
    )
    on delete restrict;

create table public.asset_ocr_results (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  source_item_id uuid not null,
  source_version_id uuid not null,
  source_attachment_id uuid not null,
  processing_run_id uuid not null,
  input_sha256 text not null,
  provider text not null,
  model text not null,
  provider_request_id text not null,
  markdown_text text not null,
  layout_details jsonb not null,
  data_info jsonb not null,
  usage_json jsonb,
  created_at timestamptz not null default now(),
  constraint asset_ocr_results_space_owner_fk
    foreign key (space_id, owner_user_id)
    references public.spaces(id, owner_user_id),
  constraint asset_ocr_results_item_owner_space_fk
    foreign key (source_item_id, owner_user_id, space_id)
    references public.source_items(id, owner_user_id, space_id)
    on delete cascade,
  constraint asset_ocr_results_version_item_owner_fk
    foreign key (source_version_id, source_item_id, owner_user_id)
    references public.source_versions(id, source_item_id, owner_user_id)
    on delete cascade,
  constraint asset_ocr_results_attachment_version_owner_fk
    foreign key (
      source_attachment_id,
      source_version_id,
      owner_user_id
    )
    references public.source_attachments (
      id,
      source_version_id,
      owner_user_id
    )
    on delete cascade,
  constraint asset_ocr_results_run_owner_space_fk
    foreign key (processing_run_id, owner_user_id, space_id)
    references public.processing_runs(id, owner_user_id, space_id)
    on delete restrict,
  constraint asset_ocr_results_input_sha256_format
    check (input_sha256 ~ '^[a-f0-9]{64}$'),
  constraint asset_ocr_results_provider_length
    check (char_length(btrim(provider)) between 1 and 100),
  constraint asset_ocr_results_model_length
    check (char_length(btrim(model)) between 1 and 100),
  constraint asset_ocr_results_request_id_length
    check (char_length(btrim(provider_request_id)) between 6 and 64),
  constraint asset_ocr_results_markdown_size
    check (
      char_length(btrim(markdown_text)) >= 1
      and octet_length(markdown_text) <= 1048576
    ),
  constraint asset_ocr_results_layout_details_size
    check (octet_length(layout_details::text) <= 65536),
  constraint asset_ocr_results_data_info_size
    check (octet_length(data_info::text) <= 65536),
  constraint asset_ocr_results_usage_json_size
    check (
      usage_json is null
      or octet_length(usage_json::text) <= 65536
    ),
  constraint asset_ocr_results_id_owner_key unique (id, owner_user_id),
  constraint asset_ocr_results_attachment_sha_provider_model_key
    unique (source_attachment_id, input_sha256, provider, model)
);

create index asset_ocr_results_version_idx
  on public.asset_ocr_results (source_version_id, created_at);

alter table public.asset_ocr_results enable row level security;

revoke all on table public.asset_ocr_results
from public, anon, authenticated;

grant select on table public.asset_ocr_results to authenticated;

grant select, insert, update, delete on table public.asset_ocr_results
to service_role;

create policy asset_ocr_results_owner_member_select
on public.asset_ocr_results
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = owner_user_id
  and exists (
    select 1
    from public.space_members as membership
    where membership.space_id = asset_ocr_results.space_id
      and membership.user_id = (select auth.uid())
  )
);

create or replace function public.persist_asset_ocr_result(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_attachment_id uuid,
  p_input_sha256 text,
  p_provider text,
  p_model text,
  p_provider_request_id text,
  p_markdown_text text,
  p_layout_details jsonb,
  p_data_info jsonb,
  p_usage_json jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_item_id uuid;
  v_result_id uuid;
begin
  v_job := public.lock_claimed_processing_job(
    p_job_id,
    p_run_id,
    p_worker_id,
    'ocr_assets'
  );

  select version.source_item_id
  into v_item_id
  from public.source_versions as version
  where version.id = v_job.source_version_id
    and version.owner_user_id = v_job.owner_user_id;

  if v_item_id is null then
    raise exception 'processing job ancestry mismatch'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.source_attachments as attachment
    where attachment.id = p_attachment_id
      and attachment.source_version_id = v_job.source_version_id
      and attachment.owner_user_id = v_job.owner_user_id
  ) then
    raise exception 'processing job ancestry mismatch'
      using errcode = '22023';
  end if;

  insert into public.asset_ocr_results (
    owner_user_id,
    space_id,
    source_item_id,
    source_version_id,
    source_attachment_id,
    processing_run_id,
    input_sha256,
    provider,
    model,
    provider_request_id,
    markdown_text,
    layout_details,
    data_info,
    usage_json
  )
  values (
    v_job.owner_user_id,
    v_job.space_id,
    v_item_id,
    v_job.source_version_id,
    p_attachment_id,
    p_run_id,
    p_input_sha256,
    p_provider,
    p_model,
    p_provider_request_id,
    p_markdown_text,
    p_layout_details,
    p_data_info,
    p_usage_json
  )
  on conflict (source_attachment_id, input_sha256, provider, model)
  do nothing
  returning id into v_result_id;

  if v_result_id is null then
    select result.id
    into v_result_id
    from public.asset_ocr_results as result
    where result.source_attachment_id = p_attachment_id
      and result.input_sha256 = p_input_sha256
      and result.provider = p_provider
      and result.model = p_model
      and result.owner_user_id = v_job.owner_user_id
      and result.source_version_id = v_job.source_version_id;
  end if;

  return v_result_id;
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
  v_current_type text;
  v_job public.processing_jobs;
begin
  if p_job_type not in ('build_source_blocks', 'extract_knowledge') then
    raise exception 'unsupported followup job type'
      using errcode = '22023';
  end if;

  select job.job_type
  into v_current_type
  from public.processing_jobs as job
  where job.id = p_job_id;

  if v_current_type is null then
    raise exception 'processing job not found'
      using errcode = 'P0002';
  end if;

  if p_job_type = 'build_source_blocks'
    and v_current_type not in ('normalize_source', 'ocr_assets')
  then
    raise exception 'unsupported followup job type'
      using errcode = '22023';
  end if;

  if p_job_type = 'extract_knowledge'
    and v_current_type is distinct from 'normalize_source'
  then
    raise exception 'unsupported followup job type'
      using errcode = '22023';
  end if;

  v_job := public.lock_claimed_processing_job(
    p_job_id,
    p_run_id,
    p_worker_id,
    v_current_type
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
  v_block_type text;
  v_message_id uuid;
  v_attachment_id uuid;
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
    v_block_type := coalesce(v_block->>'block_type', '');
    v_message_id := nullif(v_block->>'source_message_id', '')::uuid;
    v_attachment_id := nullif(v_block->>'source_attachment_id', '')::uuid;

    if v_block_type not in ('message', 'paragraph', 'metadata', 'ocr_region') then
      raise exception 'unsupported source block type'
        using errcode = '22023';
    end if;

    if v_block_type = 'message' then
      if v_attachment_id is not null then
        raise exception 'message blocks cannot link a source attachment'
          using errcode = '22023';
      end if;

      select *
      into v_message
      from public.source_messages
      where id = v_message_id
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
    else
      if v_message_id is not null then
        raise exception 'non-message blocks cannot link a source message'
          using errcode = '22023';
      end if;
    end if;

    if v_block_type = 'ocr_region' then
      if v_attachment_id is null
        or not exists (
          select 1
          from public.source_attachments as attachment
          where attachment.id = v_attachment_id
            and attachment.source_version_id = v_job.source_version_id
            and attachment.owner_user_id = v_job.owner_user_id
        )
      then
        raise exception 'processing job ancestry mismatch'
          using errcode = '22023';
      end if;
    elsif v_attachment_id is not null then
      raise exception 'only ocr_region blocks may link a source attachment'
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
    source_attachment_id,
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
    nullif(incoming->>'source_message_id', '')::uuid,
    nullif(incoming->>'source_attachment_id', '')::uuid,
    (incoming->>'block_type')::public.source_block_type,
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
    source_attachment_id = excluded.source_attachment_id,
    block_type = excluded.block_type,
    locator_json = excluded.locator_json,
    text_content = excluded.text_content,
    updated_at = now();

  insert into public.source_asset_links (
    owner_user_id,
    space_id,
    source_attachment_id,
    source_block_id,
    relation_type
  )
  select
    v_job.owner_user_id,
    v_job.space_id,
    (incoming->>'source_attachment_id')::uuid,
    block.id,
    'ocr_source'
  from jsonb_array_elements(p_blocks) as incoming
  join public.source_blocks as block
    on block.source_version_id = v_job.source_version_id
    and block.owner_user_id = v_job.owner_user_id
    and block.space_id = v_job.space_id
    and block.locator_key = incoming->>'locator_key'
    and block.content_hash = incoming->>'content_hash'
  where incoming->>'block_type' = 'ocr_region'
  on conflict on constraint source_asset_links_relation_tuple_key
  do nothing;

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

revoke all on function public.persist_asset_ocr_result(
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb
)
from public, anon, authenticated;
grant execute on function public.persist_asset_ocr_result(
  uuid,
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  jsonb
)
to service_role;
