create extension if not exists pgcrypto with schema extensions;

create type public.capture_source as enum (
  'chatgpt_web',
  'manual_text',
  'manual_file',
  'manual_screenshot'
);

create type public.capture_scope as enum (
  'full_conversation',
  'qa_pair',
  'selection',
  'web_page',
  'upload'
);

create type public.sensitivity_level as enum (
  'normal',
  'sensitive',
  'strictly_sensitive'
);

create type public.capture_completeness as enum (
  'complete',
  'partial',
  'failed'
);

create type public.processing_state as enum (
  'queued',
  'processing',
  'complete',
  'failed',
  'paused'
);

create type public.capture_session_state as enum (
  'awaiting_upload',
  'finalized',
  'failed'
);

create or replace function public.is_valid_attachment_manifest(
  manifest jsonb
) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  attachment jsonb;
  attachment_count integer;
  byte_size numeric;
  client_ids text[] := '{}';
  total_bytes numeric := 0;
begin
  if jsonb_typeof(manifest) <> 'array' then
    return false;
  end if;

  attachment_count := jsonb_array_length(manifest);
  if attachment_count > 50 then
    return false;
  end if;

  for attachment in
    select value from jsonb_array_elements(manifest)
  loop
    if
      jsonb_typeof(attachment) <> 'object'
      or coalesce(attachment->>'clientId', '') = ''
      or char_length(attachment->>'clientId') > 100
      or coalesce(attachment->>'fileName', '') = ''
      or char_length(attachment->>'fileName') > 255
      or coalesce(attachment->>'mimeType', '') not in (
        'image/png',
        'image/jpeg',
        'image/webp',
        'text/plain',
        'text/markdown',
        'application/pdf'
      )
      or coalesce(attachment->>'byteSize', '') !~ '^[0-9]+$'
      or coalesce(attachment->>'sha256', '') !~ '^[a-f0-9]{64}$'
    then
      return false;
    end if;

    byte_size := (attachment->>'byteSize')::numeric;
    if byte_size not between 1 and 10485760 then
      return false;
    end if;

    client_ids := array_append(client_ids, attachment->>'clientId');
    total_bytes := total_bytes + byte_size;
  end loop;

  return
    total_bytes <= 104857600
    and cardinality(client_ids) = (
      select count(distinct client_id)
      from unnest(client_ids) as client_id
    );
exception
  when others then
    return false;
end;
$$;

revoke all on function public.is_valid_attachment_manifest(jsonb)
from public, anon, authenticated;
grant execute on function public.is_valid_attachment_manifest(jsonb)
to service_role;

create or replace function public.is_valid_missing_elements(
  missing_elements text[]
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    cardinality(missing_elements) <= 50
    and array_position(missing_elements, null) is null
    and coalesce(
      (
        select bool_and(
          char_length(btrim(missing_element)) between 1 and 500
        )
        from unnest(missing_elements) as missing_element
      ),
      true
    )
    and cardinality(missing_elements) = (
      select count(distinct missing_element)
      from unnest(missing_elements) as missing_element
    );
$$;

revoke all on function public.is_valid_missing_elements(text[])
from public, anon, authenticated;
grant execute on function public.is_valid_missing_elements(text[])
to service_role;

create table public.source_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source public.capture_source not null,
  external_ref text,
  title text not null,
  sensitivity public.sensitivity_level not null,
  current_version integer not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_items_title_length
    check (char_length(btrim(title)) between 1 and 500),
  constraint source_items_external_ref_length
    check (external_ref is null or char_length(external_ref) <= 1000),
  constraint source_items_chatgpt_ref_required
    check (
      source <> 'chatgpt_web'
      or (external_ref is not null and char_length(btrim(external_ref)) > 0)
    ),
  constraint source_items_current_version_nonnegative
    check (current_version >= 0),
  constraint source_items_owner_source_external_ref_key
    unique (owner_user_id, source, external_ref),
  constraint source_items_id_owner_key unique (id, owner_user_id)
);

create table public.capture_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid,
  idempotency_key text not null,
  source public.capture_source not null,
  scope public.capture_scope not null,
  title text not null,
  sensitivity public.sensitivity_level not null,
  external_ref text,
  expected_attachments jsonb not null default '[]'::jsonb,
  status public.capture_session_state not null default 'awaiting_upload',
  failure_reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  constraint capture_sessions_source_item_owner_fk
    foreign key (source_item_id, owner_user_id)
    references public.source_items(id, owner_user_id)
    on delete cascade,
  constraint capture_sessions_idempotency_length
    check (char_length(idempotency_key) between 8 and 200),
  constraint capture_sessions_title_length
    check (char_length(btrim(title)) between 1 and 500),
  constraint capture_sessions_external_ref_length
    check (external_ref is null or char_length(external_ref) <= 1000),
  constraint capture_sessions_chatgpt_ref_required
    check (
      source <> 'chatgpt_web'
      or (external_ref is not null and char_length(btrim(external_ref)) > 0)
    ),
  constraint capture_sessions_scope_matches_source
    check (
      (source = 'chatgpt_web' and scope in (
        'full_conversation',
        'qa_pair',
        'selection'
      ))
      or (source = 'manual_text' and scope in (
        'selection',
        'web_page',
        'upload'
      ))
      or (source in ('manual_file', 'manual_screenshot') and scope = 'upload')
    ),
  constraint capture_sessions_expected_attachments_valid
    check (public.is_valid_attachment_manifest(expected_attachments)),
  constraint capture_sessions_status_fields_consistent
    check (
      (
        status = 'awaiting_upload'
        and failure_reason is null
        and finalized_at is null
      )
      or (
        status = 'finalized'
        and failure_reason is null
        and finalized_at is not null
        and source_item_id is not null
      )
      or (
        status = 'failed'
        and char_length(btrim(failure_reason)) between 1 and 2000
        and finalized_at is null
      )
    ),
  constraint capture_sessions_owner_idempotency_key
    unique (owner_user_id, idempotency_key),
  constraint capture_sessions_id_owner_key unique (id, owner_user_id),
  constraint capture_sessions_id_item_owner_key
    unique (id, source_item_id, owner_user_id)
);

create table public.source_versions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null,
  version integer not null,
  capture_session_id uuid not null,
  capture_status public.capture_completeness not null,
  missing_elements text[] not null default '{}',
  raw_text text not null,
  content_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint source_versions_source_item_owner_fk
    foreign key (source_item_id, owner_user_id)
    references public.source_items(id, owner_user_id)
    on delete cascade,
  constraint source_versions_capture_session_item_owner_fk
    foreign key (capture_session_id, source_item_id, owner_user_id)
    references public.capture_sessions(id, source_item_id, owner_user_id),
  constraint source_versions_number_positive check (version > 0),
  constraint source_versions_finalizable_status
    check (capture_status in ('complete', 'partial')),
  constraint source_versions_completeness_consistent
    check (
      (capture_status = 'complete' and cardinality(missing_elements) = 0)
      or (
        capture_status = 'partial'
        and cardinality(missing_elements) between 1 and 50
      )
    ),
  constraint source_versions_missing_elements_valid
    check (public.is_valid_missing_elements(missing_elements)),
  constraint source_versions_raw_text_size
    check (octet_length(raw_text) <= 2097152),
  constraint source_versions_fingerprint_format
    check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint source_versions_item_version_key
    unique (source_item_id, version),
  constraint source_versions_capture_session_key unique (capture_session_id),
  constraint source_versions_id_owner_key unique (id, owner_user_id),
  constraint source_versions_id_item_owner_key
    unique (id, source_item_id, owner_user_id)
);

create table public.source_messages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null,
  source_version_id uuid not null,
  external_message_id text not null,
  role text not null,
  body text not null,
  ordinal integer not null,
  constraint source_messages_version_item_owner_fk
    foreign key (source_version_id, source_item_id, owner_user_id)
    references public.source_versions(id, source_item_id, owner_user_id)
    on delete cascade,
  constraint source_messages_external_id_length
    check (char_length(external_message_id) between 1 and 500),
  constraint source_messages_role_valid
    check (role in ('user', 'assistant', 'system', 'tool')),
  constraint source_messages_body_size
    check (octet_length(body) <= 2097152),
  constraint source_messages_ordinal_nonnegative check (ordinal >= 0),
  constraint source_messages_version_external_id_key
    unique (source_version_id, external_message_id),
  constraint source_messages_version_ordinal_key
    unique (source_version_id, ordinal),
  constraint source_messages_id_owner_key unique (id, owner_user_id)
);

create table public.source_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_version_id uuid not null,
  client_id text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  sha256 text not null,
  etag text not null,
  constraint source_attachments_version_owner_fk
    foreign key (source_version_id, owner_user_id)
    references public.source_versions(id, owner_user_id)
    on delete cascade,
  constraint source_attachments_client_id_length
    check (char_length(client_id) between 1 and 100),
  constraint source_attachments_storage_path_length
    check (char_length(storage_path) between 1 and 2000),
  constraint source_attachments_storage_path_owned
    check (split_part(storage_path, '/', 1) = owner_user_id::text),
  constraint source_attachments_file_name_length
    check (char_length(file_name) between 1 and 255),
  constraint source_attachments_mime_type_valid
    check (mime_type in (
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
      'text/markdown',
      'application/pdf'
    )),
  constraint source_attachments_byte_size
    check (byte_size between 1 and 10485760),
  constraint source_attachments_sha256_format
    check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint source_attachments_etag_length
    check (char_length(etag) between 1 and 1000),
  constraint source_attachments_storage_path_key unique (storage_path),
  constraint source_attachments_version_client_id_key
    unique (source_version_id, client_id),
  constraint source_attachments_id_owner_key unique (id, owner_user_id)
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_version_id uuid not null,
  job_type text not null,
  status public.processing_state not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processing_jobs_version_owner_fk
    foreign key (source_version_id, owner_user_id)
    references public.source_versions(id, owner_user_id)
    on delete cascade,
  constraint processing_jobs_type_valid
    check (job_type = 'prepare_for_milestone_b'),
  constraint processing_jobs_attempt_count_nonnegative
    check (attempt_count >= 0),
  constraint processing_jobs_failure_reason_length
    check (
      failure_reason is null
      or char_length(btrim(failure_reason)) between 1 and 2000
    ),
  constraint processing_jobs_version_type_key
    unique (source_version_id, job_type),
  constraint processing_jobs_id_owner_key unique (id, owner_user_id)
);

create table public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  label text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint extension_tokens_hash_length
    check (char_length(token_hash) between 32 and 256),
  constraint extension_tokens_label_length
    check (char_length(btrim(label)) between 1 and 100),
  constraint extension_tokens_hash_key unique (token_hash),
  constraint extension_tokens_id_owner_key unique (id, owner_user_id)
);

create or replace function public.assert_source_version_capture_limits(
  checked_source_version_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment_count bigint;
  attachment_bytes numeric;
  plain_text_bytes numeric;
begin
  perform 1
  from public.source_versions
  where id = checked_source_version_id
  for update;

  if not found then
    return;
  end if;

  select
    octet_length(source_version.raw_text)
      + coalesce(sum(octet_length(source_message.body)), 0)
  into plain_text_bytes
  from public.source_versions as source_version
  left join public.source_messages as source_message
    on source_message.source_version_id = source_version.id
  where source_version.id = checked_source_version_id
  group by source_version.raw_text;

  if plain_text_bytes > 2097152 then
    raise check_violation using
      constraint = 'source_version_plain_text_total_size',
      message = 'plain text exceeds 2 MiB in total';
  end if;

  select count(*), coalesce(sum(byte_size), 0)
  into attachment_count, attachment_bytes
  from public.source_attachments
  where source_version_id = checked_source_version_id;

  if attachment_count > 50 then
    raise check_violation using
      constraint = 'source_version_attachment_count',
      message = 'capture contains more than 50 attachments';
  end if;

  if attachment_bytes > 104857600 then
    raise check_violation using
      constraint = 'source_version_attachment_total_size',
      message = 'capture attachments exceed 100 MiB in total';
  end if;
end;
$$;

revoke all on function public.assert_source_version_capture_limits(uuid)
from public, anon, authenticated;

create or replace function public.enforce_source_versions_inserted_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_source_version_id uuid;
begin
  for affected_source_version_id in
    select distinct id from new_rows
  loop
    perform public.assert_source_version_capture_limits(
      affected_source_version_id
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.enforce_source_versions_inserted_limits()
from public, anon, authenticated;

create or replace function public.enforce_source_versions_updated_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_source_version_id uuid;
begin
  for affected_source_version_id in
    select id from new_rows
    union
    select id from old_rows
  loop
    perform public.assert_source_version_capture_limits(
      affected_source_version_id
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.enforce_source_versions_updated_limits()
from public, anon, authenticated;

create or replace function public.enforce_child_rows_inserted_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_source_version_id uuid;
begin
  for affected_source_version_id in
    select distinct source_version_id from new_rows
  loop
    perform public.assert_source_version_capture_limits(
      affected_source_version_id
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.enforce_child_rows_inserted_limits()
from public, anon, authenticated;

create or replace function public.enforce_child_rows_updated_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_source_version_id uuid;
begin
  for affected_source_version_id in
    select source_version_id from new_rows
    union
    select source_version_id from old_rows
  loop
    perform public.assert_source_version_capture_limits(
      affected_source_version_id
    );
  end loop;

  return null;
end;
$$;

revoke all on function public.enforce_child_rows_updated_limits()
from public, anon, authenticated;

create trigger source_versions_capture_limits_insert
after insert on public.source_versions
referencing new table as new_rows
for each statement
execute function public.enforce_source_versions_inserted_limits();

create trigger source_versions_capture_limits_update
after update on public.source_versions
referencing old table as old_rows new table as new_rows
for each statement
execute function public.enforce_source_versions_updated_limits();

create trigger source_messages_capture_limits_insert
after insert on public.source_messages
referencing new table as new_rows
for each statement
execute function public.enforce_child_rows_inserted_limits();

create trigger source_messages_capture_limits_update
after update on public.source_messages
referencing old table as old_rows new table as new_rows
for each statement
execute function public.enforce_child_rows_updated_limits();

create trigger source_attachments_capture_limits_insert
after insert on public.source_attachments
referencing new table as new_rows
for each statement
execute function public.enforce_child_rows_inserted_limits();

create trigger source_attachments_capture_limits_update
after update on public.source_attachments
referencing old table as old_rows new table as new_rows
for each statement
execute function public.enforce_child_rows_updated_limits();

create index source_items_owner_updated_idx
  on public.source_items (owner_user_id, updated_at desc);
create index capture_sessions_owner_status_created_idx
  on public.capture_sessions (owner_user_id, status, created_at desc);
create index capture_sessions_source_item_idx
  on public.capture_sessions (source_item_id);
create index source_versions_owner_created_idx
  on public.source_versions (owner_user_id, created_at desc);
create index source_versions_owner_fingerprint_idx
  on public.source_versions (owner_user_id, content_fingerprint);
create index source_versions_source_item_created_idx
  on public.source_versions (source_item_id, created_at desc);
create index source_messages_owner_idx
  on public.source_messages (owner_user_id);
create index source_messages_source_item_ordinal_idx
  on public.source_messages (source_item_id, ordinal);
create index source_attachments_owner_idx
  on public.source_attachments (owner_user_id);
create index processing_jobs_owner_status_attempt_idx
  on public.processing_jobs (owner_user_id, status, next_attempt_at);
create index extension_tokens_owner_expiry_idx
  on public.extension_tokens (owner_user_id, expires_at);

alter table public.source_items enable row level security;
alter table public.capture_sessions enable row level security;
alter table public.source_versions enable row level security;
alter table public.source_messages enable row level security;
alter table public.source_attachments enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.extension_tokens enable row level security;

revoke insert, update, delete on table
  public.source_items,
  public.capture_sessions,
  public.source_versions,
  public.source_messages,
  public.source_attachments,
  public.processing_jobs,
  public.extension_tokens
from anon, authenticated;

grant select on table
  public.source_items,
  public.capture_sessions,
  public.source_versions,
  public.source_messages,
  public.source_attachments,
  public.processing_jobs,
  public.extension_tokens
to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_items',
    'capture_sessions',
    'source_versions',
    'source_messages',
    'source_attachments',
    'processing_jobs',
    'extension_tokens'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using ((select auth.uid()) is not null '
      || 'and (select auth.uid()) = owner_user_id)',
      table_name || '_owner_select',
      table_name
    );
  end loop;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'raw-captures',
  'raw-captures',
  false,
  10485760,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/markdown',
    'application/pdf'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy raw_captures_owner_select
on storage.objects
for select
to authenticated
using (
  (select auth.uid()) is not null
  and bucket_id = 'raw-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy raw_captures_owner_insert
on storage.objects
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and bucket_id = 'raw-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
