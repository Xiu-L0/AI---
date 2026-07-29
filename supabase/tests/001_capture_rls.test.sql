begin;

select plan(27);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

create function pg_temp.create_test_version(
  owner_id uuid,
  item_id uuid,
  session_id uuid,
  version_id uuid,
  version_number integer,
  completeness public.capture_completeness,
  missing_elements text[],
  raw_text text,
  fingerprint text
) returns void
language plpgsql
as $$
begin
  insert into public.capture_sessions (
    id,
    owner_user_id,
    source_item_id,
    idempotency_key,
    source,
    scope,
    title,
    sensitivity,
    status,
    expires_at,
    finalized_at
  )
  values (
    session_id,
    owner_id,
    item_id,
    'test-' || session_id::text,
    'manual_text',
    'selection',
    'Synthetic item',
    'normal',
    'finalized',
    now() + interval '2 hours',
    now()
  );

  insert into public.source_versions (
    id,
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
    version_id,
    owner_id,
    item_id,
    version_number,
    session_id,
    completeness,
    missing_elements,
    raw_text,
    fingerprint
  );
end;
$$;

insert into public.source_items (
  id,
  owner_user_id,
  source,
  title,
  sensitivity,
  current_version
)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'manual_text',
  'Owner item',
  'normal',
  1
);

select pg_temp.create_test_version(
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  1,
  'complete',
  '{}',
  'first version',
  md5('first-version') || md5('first-version')
);

insert into public.source_messages (
  owner_user_id,
  source_item_id,
  source_version_id,
  external_message_id,
  role,
  body,
  ordinal
)
values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'message-1',
  'user',
  'first snapshot',
  0
);

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
values (
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'attachment-1',
  '00000000-0000-0000-0000-000000000001/fixture/attachment.txt',
  'attachment.txt',
  'text/plain',
  1,
  repeat('a', 64),
  'synthetic-etag'
);

insert into public.processing_jobs (
  owner_user_id,
  source_version_id,
  job_type
)
values (
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'prepare_for_milestone_b'
);

insert into public.extension_tokens (
  owner_user_id,
  token_hash,
  label,
  expires_at
)
values (
  '00000000-0000-0000-0000-000000000001',
  repeat('b', 64),
  'Synthetic browser',
  now() + interval '30 days'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'source_items',
        'capture_sessions',
        'source_versions',
        'source_messages',
        'source_attachments',
        'processing_jobs',
        'extension_tokens'
      )
      and column_name = 'owner_user_id'
  ),
  7,
  'every business table has owner_user_id'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'source_items',
        'capture_sessions',
        'source_versions',
        'source_messages',
        'source_attachments',
        'processing_jobs',
        'extension_tokens'
      )
      and relation.relrowsecurity
  ),
  7,
  'RLS is enabled on every business table'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'source_items',
        'capture_sessions',
        'source_versions',
        'source_messages',
        'source_attachments',
        'processing_jobs',
        'extension_tokens'
      )
      and policyname = tablename || '_owner_select'
      and cmd = 'SELECT'
  ),
  7,
  'every business table has an owner-only select policy'
);

select is(
  (select public from storage.buckets where id = 'raw-captures'),
  false,
  'raw-captures is private'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'raw_captures_owner_%'
  ),
  2,
  'raw-captures exposes only owner select and insert policies'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select sum(row_count)::integer
    from (
      select count(*) as row_count from public.source_items
      union all select count(*) from public.capture_sessions
      union all select count(*) from public.source_versions
      union all select count(*) from public.source_messages
      union all select count(*) from public.source_attachments
      union all select count(*) from public.processing_jobs
      union all select count(*) from public.extension_tokens
    ) as visible_rows
  ),
  7,
  'owner can select every seeded business row'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is(
  (
    select sum(row_count)::integer
    from (
      select count(*) as row_count from public.source_items
      union all select count(*) from public.capture_sessions
      union all select count(*) from public.source_versions
      union all select count(*) from public.source_messages
      union all select count(*) from public.source_attachments
      union all select count(*) from public.processing_jobs
      union all select count(*) from public.extension_tokens
    ) as visible_rows
  ),
  0,
  'other user cannot select owner business rows'
);

select throws_like(
  $$
    insert into public.source_items (
      owner_user_id, source, title, sensitivity
    ) values (
      '00000000-0000-0000-0000-000000000002',
      'manual_text',
      'Client forgery',
      'normal'
    )
  $$,
  '%permission denied%',
  'authenticated client cannot insert core rows'
);

select throws_like(
  $$ update public.source_items set title = 'Client update' $$,
  '%permission denied%',
  'authenticated client cannot update core rows'
);

select throws_like(
  $$ delete from public.source_items $$,
  '%permission denied%',
  'authenticated client cannot delete core rows'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'raw-captures',
      '00000000-0000-0000-0000-000000000001/fixture/upload.txt'
    )
  $$,
  'owner can insert into the owner storage path'
);

select is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'raw-captures'
  ),
  1,
  'owner can select the uploaded storage object'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::integer
    from storage.objects
    where bucket_id = 'raw-captures'
  ),
  0,
  'other user cannot select the owner storage object'
);

select throws_like(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'raw-captures',
      '00000000-0000-0000-0000-000000000001/fixture/forged.txt'
    )
  $$,
  '%row-level security%',
  'other user cannot insert into the owner storage path'
);

reset role;

insert into public.source_items (
  id, owner_user_id, source, title, sensitivity, current_version
) values (
  '11000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'manual_text',
  'Fingerprint item',
  'normal',
  2
);

select pg_temp.create_test_version(
  '00000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  1,
  'partial',
  array['missing image'],
  'same content',
  repeat('c', 64)
);

select pg_temp.create_test_version(
  '00000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000002',
  '31000000-0000-0000-0000-000000000002',
  2,
  'complete',
  '{}',
  'same content',
  repeat('c', 64)
);

select is(
  (
    select count(*)::integer
    from public.source_versions
    where owner_user_id = '00000000-0000-0000-0000-000000000001'
      and content_fingerprint = repeat('c', 64)
  ),
  2,
  'partial and complete captures may share a fingerprint'
);

insert into public.source_items (
  id, owner_user_id, source, title, sensitivity
) values (
  '11000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'manual_text',
  'Second owner item',
  'normal'
);

insert into public.capture_sessions (
  id,
  owner_user_id,
  source_item_id,
  idempotency_key,
  source,
  scope,
  title,
  sensitivity,
  status,
  expires_at,
  finalized_at
) values (
  '21000000-0000-0000-0000-000000000099',
  '00000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'same-owner-mismatch',
  'manual_text',
  'selection',
  'Fingerprint item',
  'normal',
  'finalized',
  now() + interval '2 hours',
  now()
);

select throws_like(
  $$
    insert into public.source_versions (
      owner_user_id,
      source_item_id,
      version,
      capture_session_id,
      capture_status,
      raw_text,
      content_fingerprint
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000002',
      1,
      '21000000-0000-0000-0000-000000000099',
      'complete',
      'mismatched item',
      repeat('d', 64)
    )
  $$,
  '%foreign key constraint%',
  'a session cannot finalize a different item owned by the same user'
);

insert into public.source_items (
  id, owner_user_id, source, title, sensitivity
) values (
  '12000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'manual_text',
  'Other item',
  'normal'
);

insert into public.capture_sessions (
  id,
  owner_user_id,
  source_item_id,
  idempotency_key,
  source,
  scope,
  title,
  sensitivity,
  status,
  expires_at,
  finalized_at
) values (
  '22000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '12000000-0000-0000-0000-000000000001',
  'cross-owner-parent',
  'manual_text',
  'selection',
  'Other item',
  'normal',
  'finalized',
  now() + interval '2 hours',
  now()
);

select throws_like(
  $$
    insert into public.source_versions (
      owner_user_id,
      source_item_id,
      version,
      capture_session_id,
      capture_status,
      raw_text,
      content_fingerprint
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '12000000-0000-0000-0000-000000000001',
      1,
      '22000000-0000-0000-0000-000000000001',
      'complete',
      'cross-owner child',
      repeat('e', 64)
    )
  $$,
  '%foreign key constraint%',
  'cross-owner parent-child links are rejected'
);

insert into public.source_items (
  id, owner_user_id, source, title, sensitivity
) values
  (
    '13000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'manual_text',
    'Text limit',
    'normal'
  ),
  (
    '14000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'manual_file',
    'File limit',
    'normal'
  ),
  (
    '15000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'manual_file',
    'Count limit',
    'normal'
  ),
  (
    '16000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'manual_file',
    'Total limit',
    'normal'
  );

select pg_temp.create_test_version(
  '00000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000001',
  1,
  'complete',
  '{}',
  repeat('x', 2097149),
  md5('text-limit') || md5('text-limit')
);

select lives_ok(
  $$
    insert into public.source_messages (
      owner_user_id,
      source_item_id,
      source_version_id,
      external_message_id,
      role,
      body,
      ordinal
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000001',
      '33000000-0000-0000-0000-000000000001',
      'utf8-boundary',
      'user',
      '你',
      0
    )
  $$,
  'UTF-8 plain text totaling exactly 2 MiB is accepted'
);

select throws_like(
  $$
    insert into public.source_messages (
      owner_user_id,
      source_item_id,
      source_version_id,
      external_message_id,
      role,
      body,
      ordinal
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000001',
      '33000000-0000-0000-0000-000000000001',
      'utf8-overflow',
      'user',
      'x',
      1
    )
  $$,
  '%plain text exceeds 2 MiB%',
  'UTF-8 plain text over 2 MiB is rejected'
);

select pg_temp.create_test_version(
  '00000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  '34000000-0000-0000-0000-000000000001',
  1,
  'complete',
  '{}',
  '',
  md5('file-limit') || md5('file-limit')
);

select lives_ok(
  $$
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
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '34000000-0000-0000-0000-000000000001',
      'ten-mib',
      '00000000-0000-0000-0000-000000000001/file-limit/ten.pdf',
      'ten.pdf',
      'application/pdf',
      10485760,
      repeat('1', 64),
      'ten-mib-etag'
    )
  $$,
  'a 10 MiB attachment is accepted'
);

select throws_like(
  $$
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
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '34000000-0000-0000-0000-000000000001',
      'over-ten-mib',
      '00000000-0000-0000-0000-000000000001/file-limit/over.pdf',
      'over.pdf',
      'application/pdf',
      10485761,
      repeat('2', 64),
      'over-ten-mib-etag'
    )
  $$,
  '%source_attachments_byte_size%',
  'an attachment larger than 10 MiB is rejected'
);

select pg_temp.create_test_version(
  '00000000-0000-0000-0000-000000000001',
  '15000000-0000-0000-0000-000000000001',
  '25000000-0000-0000-0000-000000000001',
  '35000000-0000-0000-0000-000000000001',
  1,
  'complete',
  '{}',
  '',
  md5('count-limit') || md5('count-limit')
);

select lives_ok(
  $$
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
      '00000000-0000-0000-0000-000000000001',
      '35000000-0000-0000-0000-000000000001',
      'count-' || attachment_number,
      '00000000-0000-0000-0000-000000000001/count-limit/'
        || attachment_number || '.txt',
      attachment_number || '.txt',
      'text/plain',
      1,
      repeat('3', 64),
      'count-etag-' || attachment_number
    from generate_series(1, 50) as attachment_number
  $$,
  'fifty attachments are accepted'
);

select throws_like(
  $$
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
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '35000000-0000-0000-0000-000000000001',
      'count-51',
      '00000000-0000-0000-0000-000000000001/count-limit/51.txt',
      '51.txt',
      'text/plain',
      1,
      repeat('4', 64),
      'count-etag-51'
    )
  $$,
  '%more than 50 attachments%',
  'a fifty-first attachment is rejected'
);

select pg_temp.create_test_version(
  '00000000-0000-0000-0000-000000000001',
  '16000000-0000-0000-0000-000000000001',
  '26000000-0000-0000-0000-000000000001',
  '36000000-0000-0000-0000-000000000001',
  1,
  'complete',
  '{}',
  '',
  md5('total-limit') || md5('total-limit')
);

select lives_ok(
  $$
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
      '00000000-0000-0000-0000-000000000001',
      '36000000-0000-0000-0000-000000000001',
      'total-' || attachment_number,
      '00000000-0000-0000-0000-000000000001/total-limit/'
        || attachment_number || '.pdf',
      attachment_number || '.pdf',
      'application/pdf',
      10485760,
      repeat('5', 64),
      'total-etag-' || attachment_number
    from generate_series(1, 10) as attachment_number
  $$,
  'attachments totaling exactly 100 MiB are accepted'
);

select throws_like(
  $$
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
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '36000000-0000-0000-0000-000000000001',
      'total-over',
      '00000000-0000-0000-0000-000000000001/total-limit/over.txt',
      'over.txt',
      'text/plain',
      1,
      repeat('6', 64),
      'total-over-etag'
    )
  $$,
  '%attachments exceed 100 MiB%',
  'attachments totaling more than 100 MiB are rejected'
);

select pg_temp.create_test_version(
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '27000000-0000-0000-0000-000000000001',
  '37000000-0000-0000-0000-000000000001',
  2,
  'complete',
  '{}',
  'second version',
  md5('history-version') || md5('history-version')
);

select lives_ok(
  $$
    insert into public.source_messages (
      owner_user_id,
      source_item_id,
      source_version_id,
      external_message_id,
      role,
      body,
      ordinal
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000001',
      'message-1',
      'user',
      'second snapshot',
      0
    )
  $$,
  'an external message id can be stored in a later version'
);

select is(
  (
    select count(*)::integer
    from public.source_messages
    where source_item_id = '10000000-0000-0000-0000-000000000001'
      and external_message_id = 'message-1'
  ),
  2,
  'message history keeps one snapshot per source version'
);

select * from finish();
rollback;
