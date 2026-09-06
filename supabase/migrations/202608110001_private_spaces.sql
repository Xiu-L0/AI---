create type public.space_type as enum ('private', 'shared');
create type public.space_member_role as enum ('owner', 'editor', 'viewer');

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  type public.space_type not null default 'private',
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint spaces_name_length
    check (char_length(btrim(name)) between 1 and 100),
  constraint spaces_id_owner_key unique (id, owner_user_id)
);

create unique index spaces_one_private_owner_idx
  on public.spaces (owner_user_id)
  where type = 'private';

create table public.space_members (
  space_id uuid not null,
  space_owner_user_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.space_member_role not null,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id),
  constraint space_members_space_owner_fk
    foreign key (space_id, space_owner_user_id)
    references public.spaces(id, owner_user_id)
    on delete cascade
);

create or replace function public.ensure_private_space(
  p_owner_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
begin
  if not exists (
    select 1
    from auth.users
    where id = p_owner_user_id
  ) then
    raise exception 'ensure_private_space requires an existing auth user';
  end if;

  insert into public.spaces (type, name, owner_user_id, created_by_user_id)
  values ('private', '我的知识库', p_owner_user_id, p_owner_user_id)
  on conflict (owner_user_id) where type = 'private'
  do update set name = public.spaces.name
  returning id into v_space_id;

  insert into public.space_members (
    space_id,
    space_owner_user_id,
    user_id,
    role
  )
  values (v_space_id, p_owner_user_id, p_owner_user_id, 'owner')
  on conflict (space_id, user_id) do nothing;

  return v_space_id;
end;
$$;

revoke all on function public.ensure_private_space(uuid)
from public, anon, authenticated;
grant execute on function public.ensure_private_space(uuid)
to service_role;

create or replace function public.assign_default_private_space()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.space_id is null then
    new.space_id := public.ensure_private_space(new.owner_user_id);
  end if;
  return new;
end;
$$;

alter table public.source_items
  add column space_id uuid;

alter table public.processing_jobs
  add column space_id uuid;

do $$
declare
  owner_id uuid;
begin
  for owner_id in
    select distinct owner_user_id
    from (
      select owner_user_id from public.source_items
      union
      select owner_user_id from public.capture_sessions
      union
      select owner_user_id from public.source_versions
      union
      select owner_user_id from public.source_messages
      union
      select owner_user_id from public.source_attachments
      union
      select owner_user_id from public.processing_jobs
      union
      select owner_user_id from public.extension_tokens
    ) as owners
  loop
    perform public.ensure_private_space(owner_id);
  end loop;
end;
$$;

update public.source_items as item
set space_id = public.ensure_private_space(item.owner_user_id)
where item.space_id is null;

update public.processing_jobs as job
set space_id = item.space_id
from public.source_versions as version
join public.source_items as item
  on item.id = version.source_item_id
where job.source_version_id = version.id
  and job.space_id is null;

update public.processing_jobs as job
set space_id = public.ensure_private_space(job.owner_user_id)
where job.space_id is null;

alter table public.source_items
  alter column space_id set not null;

alter table public.processing_jobs
  alter column space_id set not null;

alter table public.source_items
  add constraint source_items_space_owner_fk
    foreign key (space_id, owner_user_id)
    references public.spaces(id, owner_user_id);

alter table public.processing_jobs
  add constraint processing_jobs_space_owner_fk
    foreign key (space_id, owner_user_id)
    references public.spaces(id, owner_user_id);

alter table public.processing_jobs
  drop constraint processing_jobs_type_valid;

update public.processing_jobs
set job_type = 'normalize_source'
where job_type = 'prepare_for_milestone_b';

alter table public.processing_jobs
  add constraint processing_jobs_type_valid
    check (job_type in (
      'normalize_source',
      'parse_documents',
      'ocr_assets',
      'build_source_blocks',
      'extract_knowledge',
      'suggest_topics',
      'suggest_relations',
      'generate_embeddings',
      'update_search_index',
      'remove_from_indexes',
      'reprocess_version'
    ));

create index source_items_space_updated_idx
  on public.source_items (space_id, updated_at desc);

create index processing_jobs_space_status_next_idx
  on public.processing_jobs (space_id, status, next_attempt_at, created_at);

create trigger source_items_assign_default_space
  before insert or update of owner_user_id, space_id
  on public.source_items
  for each row
  execute function public.assign_default_private_space();

create trigger processing_jobs_assign_default_space
  before insert or update of owner_user_id, space_id
  on public.processing_jobs
  for each row
  execute function public.assign_default_private_space();

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;

revoke all on table public.spaces from public, anon, authenticated;
revoke all on table public.space_members from public, anon, authenticated;

grant select on table public.spaces to authenticated;
grant select on table public.space_members to authenticated;
grant select, insert, update, delete on table public.spaces to service_role;
grant select, insert, update, delete on table public.space_members to service_role;

create policy spaces_member_select
  on public.spaces
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.space_members as membership
      where membership.space_id = spaces.id
        and membership.user_id = auth.uid()
    )
  );

create policy space_members_self_select
  on public.space_members
  for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.finalize_capture(
  p_owner_user_id uuid,
  p_capture_id uuid,
  p_idempotency_key text,
  p_capture_status public.capture_completeness,
  p_missing_elements text[],
  p_raw_text text,
  p_content_fingerprint text,
  p_messages jsonb,
  p_attachments jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_session public.capture_sessions%rowtype;
  v_existing_version public.source_versions%rowtype;
  v_source_item_id uuid;
  v_source_item_version integer;
  v_source_version_id uuid;
  v_processing_status public.processing_state;
  v_saved_message_count integer;
  v_saved_attachment_count integer;
begin
  if p_owner_user_id is null or p_capture_id is null then
    raise invalid_parameter_value using
      message = 'capture owner and session are required';
  end if;

  if
    p_idempotency_key is null
    or char_length(p_idempotency_key) not between 8 and 200
  then
    raise invalid_parameter_value using
      message = 'invalid capture idempotency key';
  end if;

  if p_capture_status is null or p_capture_status = 'failed' then
    raise invalid_parameter_value using
      message = 'only complete or partial captures can be finalized';
  end if;

  if
    p_missing_elements is null
    or not public.is_valid_missing_elements(p_missing_elements)
    or (
      p_capture_status = 'complete'
      and cardinality(p_missing_elements) <> 0
    )
    or (
      p_capture_status = 'partial'
      and cardinality(p_missing_elements) = 0
    )
  then
    raise invalid_parameter_value using
      message = 'capture completeness does not match missing elements';
  end if;

  if p_raw_text is null or octet_length(p_raw_text) > 2097152 then
    raise invalid_parameter_value using
      message = 'raw text exceeds the 2 MiB limit';
  end if;

  if
    p_content_fingerprint is null
    or p_content_fingerprint !~ '^[a-f0-9]{64}$'
  then
    raise invalid_parameter_value using
      message = 'content fingerprint must be a lowercase SHA-256 hex digest';
  end if;

  if
    jsonb_typeof(p_messages) is distinct from 'array'
    or jsonb_array_length(p_messages) > 5000
  then
    raise invalid_parameter_value using
      message = 'messages must be an array with at most 5000 entries';
  end if;

  if
    jsonb_typeof(p_attachments) is distinct from 'array'
    or jsonb_array_length(p_attachments) > 50
  then
    raise invalid_parameter_value using
      message = 'attachments must be an array with at most 50 entries';
  end if;

  select capture.*
  into v_capture_session
  from public.capture_sessions as capture
  where capture.id = p_capture_id
    and capture.owner_user_id = p_owner_user_id
  for update;

  if not found then
    raise no_data_found using
      message = 'capture session not found';
  end if;

  if v_capture_session.idempotency_key <> p_idempotency_key then
    raise unique_violation using
      message = 'capture idempotency conflict';
  end if;

  if v_capture_session.status = 'finalized' then
    select version.*
    into v_existing_version
    from public.source_versions as version
    where (
      v_capture_session.result_source_version_id is not null
      and version.id = v_capture_session.result_source_version_id
    )
    or (
      v_capture_session.result_source_version_id is null
      and version.capture_session_id = v_capture_session.id
    )
    order by version.created_at desc
    limit 1;

    if not found then
      raise data_exception using
        message = 'finalized capture has no committed source version';
    end if;

    if
      v_existing_version.content_fingerprint <> p_content_fingerprint
      or v_existing_version.capture_status <> p_capture_status
      or v_existing_version.missing_elements is distinct from p_missing_elements
      or v_existing_version.raw_text <> p_raw_text
    then
      raise unique_violation using
        message = 'capture idempotency conflict';
    end if;

    select job.status
    into v_processing_status
    from public.processing_jobs as job
    where job.source_version_id = v_existing_version.id
      and job.job_type = 'normalize_source';

    if not found then
      raise data_exception using
        message = 'finalized capture has no processing job';
    end if;

    select count(*)::integer
    into v_saved_message_count
    from public.source_messages as message
    where message.source_version_id = v_existing_version.id;

    select count(*)::integer
    into v_saved_attachment_count
    from public.source_attachments as attachment
    where attachment.source_version_id = v_existing_version.id;

    return jsonb_build_object(
      'captureId',
      v_capture_session.id,
      'sourceItemId',
      v_existing_version.source_item_id,
      'captureStatus',
      v_existing_version.capture_status,
      'processingStatus',
      v_processing_status,
      'savedMessageCount',
      v_saved_message_count,
      'savedAttachmentCount',
      v_saved_attachment_count,
      'missingElements',
      to_jsonb(v_existing_version.missing_elements)
    );
  end if;

  if v_capture_session.status = 'failed' then
    raise invalid_parameter_value using
      message = 'failed capture sessions cannot be finalized';
  end if;

  if v_capture_session.expires_at <= statement_timestamp() then
    raise invalid_parameter_value using
      message = 'capture session expired';
  end if;

  if
    jsonb_array_length(v_capture_session.expected_attachments)
      <> jsonb_array_length(p_attachments)
    or exists (
      select 1
      from jsonb_array_elements(
        v_capture_session.expected_attachments
      ) as expected
      where not exists (
        select 1
        from jsonb_array_elements(p_attachments) as uploaded
        where uploaded->>'clientId' = expected->>'clientId'
          and uploaded->>'fileName' = expected->>'fileName'
          and uploaded->>'mimeType' = expected->>'mimeType'
          and uploaded->>'byteSize' = expected->>'byteSize'
          and uploaded->>'sha256' = expected->>'sha256'
      )
    )
  then
    raise invalid_parameter_value using
      message = 'uploaded attachments do not match the capture manifest';
  end if;

  if v_capture_session.external_ref is null then
    insert into public.source_items (
      owner_user_id,
      source,
      external_ref,
      title,
      sensitivity
    )
    values (
      p_owner_user_id,
      v_capture_session.source,
      null,
      v_capture_session.title,
      v_capture_session.sensitivity
    )
    returning id, current_version
    into v_source_item_id, v_source_item_version;
  else
    insert into public.source_items (
      owner_user_id,
      source,
      external_ref,
      title,
      sensitivity
    )
    values (
      p_owner_user_id,
      v_capture_session.source,
      v_capture_session.external_ref,
      v_capture_session.title,
      v_capture_session.sensitivity
    )
    on conflict (owner_user_id, source, external_ref)
    do update set updated_at = excluded.updated_at
    returning id, current_version
    into v_source_item_id, v_source_item_version;
  end if;

  select version.*
  into v_existing_version
  from public.source_versions as version
  where version.owner_user_id = p_owner_user_id
    and version.source_item_id = v_source_item_id
    and version.content_fingerprint = p_content_fingerprint
    and version.capture_status = p_capture_status
    and version.missing_elements is not distinct from p_missing_elements
    and version.raw_text = p_raw_text
  order by version.version desc
  limit 1;

  if found then
    update public.source_items
    set
      title = v_capture_session.title,
      sensitivity = v_capture_session.sensitivity,
      updated_at = statement_timestamp()
    where id = v_source_item_id
      and owner_user_id = p_owner_user_id;

    update public.capture_sessions
    set
      source_item_id = v_source_item_id,
      result_source_version_id = v_existing_version.id,
      status = 'finalized',
      finalized_at = statement_timestamp()
    where id = v_capture_session.id
      and owner_user_id = p_owner_user_id;

    select job.status
    into v_processing_status
    from public.processing_jobs as job
    where job.source_version_id = v_existing_version.id
      and job.job_type = 'normalize_source';

    if not found then
      raise data_exception using
        message = 'duplicate capture source version has no processing job';
    end if;

    select count(*)::integer
    into v_saved_message_count
    from public.source_messages as message
    where message.source_version_id = v_existing_version.id;

    select count(*)::integer
    into v_saved_attachment_count
    from public.source_attachments as attachment
    where attachment.source_version_id = v_existing_version.id;

    return jsonb_build_object(
      'captureId',
      v_capture_session.id,
      'sourceItemId',
      v_source_item_id,
      'captureStatus',
      v_existing_version.capture_status,
      'processingStatus',
      v_processing_status,
      'savedMessageCount',
      v_saved_message_count,
      'savedAttachmentCount',
      v_saved_attachment_count,
      'missingElements',
      to_jsonb(v_existing_version.missing_elements)
    );
  end if;

  v_source_item_version := v_source_item_version + 1;

  update public.capture_sessions
  set source_item_id = v_source_item_id
  where id = v_capture_session.id
    and owner_user_id = p_owner_user_id;

  insert into public.source_versions (
    owner_user_id,
    source_item_id,
    version,
    capture_session_id,
    capture_status,
    missing_elements,
    raw_text,
    content_fingerprint
  )
  values (
    p_owner_user_id,
    v_source_item_id,
    v_source_item_version,
    v_capture_session.id,
    p_capture_status,
    p_missing_elements,
    p_raw_text,
    p_content_fingerprint
  )
  returning id into v_source_version_id;

  insert into public.source_messages (
    owner_user_id,
    source_item_id,
    source_version_id,
    external_message_id,
    role,
    body,
    ordinal
  )
  select
    p_owner_user_id,
    v_source_item_id,
    v_source_version_id,
    message->>'externalMessageId',
    message->>'role',
    message->>'text',
    (message->>'ordinal')::integer
  from jsonb_array_elements(p_messages) as message;

  insert into public.source_attachments (
    owner_user_id,
    source_version_id,
    client_id,
    storage_path,
    file_name,
    mime_type,
    byte_size,
    sha256,
    etag
  )
  select
    p_owner_user_id,
    v_source_version_id,
    attachment->>'clientId',
    attachment->>'storagePath',
    attachment->>'fileName',
    attachment->>'mimeType',
    (attachment->>'byteSize')::bigint,
    attachment->>'sha256',
    attachment->>'etag'
  from jsonb_array_elements(p_attachments) as attachment;

  insert into public.processing_jobs (
    owner_user_id,
    source_version_id,
    job_type,
    status
  )
  values (
    p_owner_user_id,
    v_source_version_id,
    'normalize_source',
    'queued'
  )
  returning status into v_processing_status;

  update public.source_items
  set
    current_version = v_source_item_version,
    title = v_capture_session.title,
    sensitivity = v_capture_session.sensitivity,
    updated_at = statement_timestamp()
  where id = v_source_item_id
    and owner_user_id = p_owner_user_id;

  update public.capture_sessions
  set
    result_source_version_id = v_source_version_id,
    status = 'finalized',
    finalized_at = statement_timestamp()
  where id = v_capture_session.id
    and owner_user_id = p_owner_user_id;

  select count(*)::integer
  into v_saved_message_count
  from public.source_messages as message
  where message.source_version_id = v_source_version_id;

  select count(*)::integer
  into v_saved_attachment_count
  from public.source_attachments as attachment
  where attachment.source_version_id = v_source_version_id;

  return jsonb_build_object(
    'captureId',
    v_capture_session.id,
    'sourceItemId',
    v_source_item_id,
    'captureStatus',
    p_capture_status,
    'processingStatus',
    v_processing_status,
    'savedMessageCount',
    v_saved_message_count,
    'savedAttachmentCount',
    v_saved_attachment_count,
    'missingElements',
    to_jsonb(p_missing_elements)
  );
end;
$$;
