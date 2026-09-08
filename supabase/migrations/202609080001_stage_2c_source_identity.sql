create type public.source_kind as enum (
  'ai_conversation',
  'web_article',
  'social_post',
  'code_repository',
  'manual_text',
  'manual_file',
  'screenshot'
);

create type public.source_platform as enum (
  'chatgpt',
  'doubao',
  'deepseek',
  'wechat',
  'xiaohongshu',
  'github',
  'generic_web',
  'manual'
);

alter table public.source_items
  add column source_kind public.source_kind,
  add column source_platform public.source_platform;

alter table public.capture_sessions
  add column source_kind public.source_kind,
  add column source_platform public.source_platform,
  add column metadata_json jsonb not null default '{}'::jsonb,
  add constraint capture_sessions_metadata_size
    check (octet_length(metadata_json::text) <= 65536);

alter table public.source_versions
  add column metadata_json jsonb not null default '{}'::jsonb,
  add constraint source_versions_metadata_size
    check (octet_length(metadata_json::text) <= 65536);

update public.source_items
set
  source_kind = case source
    when 'chatgpt_web' then 'ai_conversation'::public.source_kind
    when 'manual_text' then 'manual_text'::public.source_kind
    when 'manual_file' then 'manual_file'::public.source_kind
    when 'manual_screenshot' then 'screenshot'::public.source_kind
  end,
  source_platform = case source
    when 'chatgpt_web' then 'chatgpt'::public.source_platform
    when 'manual_text' then 'manual'::public.source_platform
    when 'manual_file' then 'manual'::public.source_platform
    when 'manual_screenshot' then 'manual'::public.source_platform
  end
where source_kind is null or source_platform is null;

update public.capture_sessions
set
  source_kind = case source
    when 'chatgpt_web' then 'ai_conversation'::public.source_kind
    when 'manual_text' then 'manual_text'::public.source_kind
    when 'manual_file' then 'manual_file'::public.source_kind
    when 'manual_screenshot' then 'screenshot'::public.source_kind
  end,
  source_platform = case source
    when 'chatgpt_web' then 'chatgpt'::public.source_platform
    when 'manual_text' then 'manual'::public.source_platform
    when 'manual_file' then 'manual'::public.source_platform
    when 'manual_screenshot' then 'manual'::public.source_platform
  end
where source_kind is null or source_platform is null;

create or replace function public.apply_source_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_kind is null or new.source_platform is null then
    if new.source is null then
      raise exception using
        errcode = '23514',
        message = 'typed source identity is required';
    end if;

    case new.source
      when 'chatgpt_web' then
        new.source_kind := 'ai_conversation';
        new.source_platform := 'chatgpt';
      when 'manual_text' then
        new.source_kind := 'manual_text';
        new.source_platform := 'manual';
      when 'manual_file' then
        new.source_kind := 'manual_file';
        new.source_platform := 'manual';
      when 'manual_screenshot' then
        new.source_kind := 'screenshot';
        new.source_platform := 'manual';
      else
        raise exception using
          errcode = '23514',
          message = 'unknown legacy source';
    end case;
  end if;

  return new;
end;
$$;

create trigger source_items_apply_source_identity
before insert or update of source, source_kind, source_platform
on public.source_items
for each row
execute function public.apply_source_identity();

create trigger capture_sessions_apply_source_identity
before insert or update of source, source_kind, source_platform
on public.capture_sessions
for each row
execute function public.apply_source_identity();

alter table public.source_items
  alter column source_kind set not null,
  alter column source_platform set not null;

alter table public.capture_sessions
  alter column source_kind set not null,
  alter column source_platform set not null;

alter table public.source_items
  drop constraint source_items_chatgpt_ref_required,
  drop constraint source_items_owner_source_external_ref_key;

alter table public.capture_sessions
  drop constraint capture_sessions_chatgpt_ref_required,
  drop constraint capture_sessions_scope_matches_source;

alter table public.source_items
  alter column source drop not null;

alter table public.capture_sessions
  alter column source drop not null;

alter table public.source_items
  add constraint source_items_typed_pair
    check (
      (source_platform = 'chatgpt' and source_kind = 'ai_conversation')
      or (source_platform = 'xiaohongshu' and source_kind = 'social_post')
      or (
        source_platform = 'manual'
        and source_kind in ('manual_text', 'manual_file', 'screenshot')
      )
      or (
        source_platform in ('doubao', 'deepseek')
        and source_kind = 'ai_conversation'
      )
      or (
        source_platform in ('wechat', 'generic_web')
        and source_kind = 'web_article'
      )
      or (source_platform = 'github' and source_kind = 'code_repository')
    ),
  add constraint source_items_typed_ref_required
    check (
      source_platform not in ('chatgpt', 'xiaohongshu')
      or (external_ref is not null and char_length(btrim(external_ref)) > 0)
    ),
  add constraint source_items_legacy_consistency
    check (
      source is null
      or (
        source = 'chatgpt_web'
        and source_platform = 'chatgpt'
        and source_kind = 'ai_conversation'
      )
      or (
        source = 'manual_text'
        and source_platform = 'manual'
        and source_kind = 'manual_text'
      )
      or (
        source = 'manual_file'
        and source_platform = 'manual'
        and source_kind = 'manual_file'
      )
      or (
        source = 'manual_screenshot'
        and source_platform = 'manual'
        and source_kind = 'screenshot'
      )
    );

alter table public.capture_sessions
  add constraint capture_sessions_typed_pair
    check (
      (source_platform = 'chatgpt' and source_kind = 'ai_conversation')
      or (source_platform = 'xiaohongshu' and source_kind = 'social_post')
      or (
        source_platform = 'manual'
        and source_kind in ('manual_text', 'manual_file', 'screenshot')
      )
      or (
        source_platform in ('doubao', 'deepseek')
        and source_kind = 'ai_conversation'
      )
      or (
        source_platform in ('wechat', 'generic_web')
        and source_kind = 'web_article'
      )
      or (source_platform = 'github' and source_kind = 'code_repository')
    ),
  add constraint capture_sessions_typed_ref_required
    check (
      source_platform not in ('chatgpt', 'xiaohongshu')
      or (external_ref is not null and char_length(btrim(external_ref)) > 0)
    ),
  add constraint capture_sessions_legacy_consistency
    check (
      source is null
      or (
        source = 'chatgpt_web'
        and source_platform = 'chatgpt'
        and source_kind = 'ai_conversation'
      )
      or (
        source = 'manual_text'
        and source_platform = 'manual'
        and source_kind = 'manual_text'
      )
      or (
        source = 'manual_file'
        and source_platform = 'manual'
        and source_kind = 'manual_file'
      )
      or (
        source = 'manual_screenshot'
        and source_platform = 'manual'
        and source_kind = 'screenshot'
      )
    ),
  add constraint capture_sessions_scope_matches_typed_source
    check (
      (
        source_platform = 'chatgpt'
        and scope in ('full_conversation', 'qa_pair', 'selection')
      )
      or (source_platform = 'xiaohongshu' and scope = 'web_page')
      or (
        source_kind = 'manual_text'
        and scope in ('selection', 'web_page', 'upload')
      )
      or (source_kind in ('manual_file', 'screenshot') and scope = 'upload')
      or (
        source_platform in ('doubao', 'deepseek')
        and scope in ('full_conversation', 'qa_pair', 'selection')
      )
      or (
        source_platform in ('wechat', 'generic_web')
        and scope = 'web_page'
      )
      or (source_platform = 'github' and scope in ('web_page', 'upload'))
    );

create unique index source_items_owner_typed_external_ref_key
on public.source_items (
  owner_user_id,
  source_platform,
  source_kind,
  external_ref
)
where external_ref is not null;

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
  v_space_id uuid;
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

  v_space_id := public.ensure_private_space(p_owner_user_id);

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
      and job.owner_user_id = p_owner_user_id
      and job.space_id = v_space_id
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
      space_id,
      source,
      source_kind,
      source_platform,
      external_ref,
      title,
      sensitivity
    )
    values (
      p_owner_user_id,
      v_space_id,
      v_capture_session.source,
      v_capture_session.source_kind,
      v_capture_session.source_platform,
      null,
      v_capture_session.title,
      v_capture_session.sensitivity
    )
    returning id, current_version
    into v_source_item_id, v_source_item_version;
  else
    insert into public.source_items (
      owner_user_id,
      space_id,
      source,
      source_kind,
      source_platform,
      external_ref,
      title,
      sensitivity
    )
    values (
      p_owner_user_id,
      v_space_id,
      v_capture_session.source,
      v_capture_session.source_kind,
      v_capture_session.source_platform,
      v_capture_session.external_ref,
      v_capture_session.title,
      v_capture_session.sensitivity
    )
    on conflict (owner_user_id, source_platform, source_kind, external_ref)
    where external_ref is not null
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
      and owner_user_id = p_owner_user_id
      and space_id = v_space_id;

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
      and job.owner_user_id = p_owner_user_id
      and job.space_id = v_space_id
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
    content_fingerprint,
    metadata_json
  )
  values (
    p_owner_user_id,
    v_source_item_id,
    v_source_item_version,
    v_capture_session.id,
    p_capture_status,
    p_missing_elements,
    p_raw_text,
    p_content_fingerprint,
    coalesce(v_capture_session.metadata_json, '{}'::jsonb)
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
    space_id,
    source_version_id,
    job_type,
    status
  )
  values (
    p_owner_user_id,
    v_space_id,
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
    and owner_user_id = p_owner_user_id
    and space_id = v_space_id;

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
