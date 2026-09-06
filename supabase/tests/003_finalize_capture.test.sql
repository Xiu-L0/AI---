begin;

select plan(19);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000021', 'finalize-owner@example.test'),
  ('00000000-0000-0000-0000-000000000022', 'finalize-other@example.test');

insert into public.capture_sessions (
  id,
  owner_user_id,
  idempotency_key,
  source,
  scope,
  title,
  sensitivity,
  external_ref,
  expected_attachments,
  status,
  expires_at
)
values
  (
    '20000000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000021',
    'finalize-key-21',
    'chatgpt_web',
    'full_conversation',
    'Synthetic conversation',
    'normal',
    'synthetic-conversation',
    '[]'::jsonb,
    'awaiting_upload',
    now() + interval '2 hours'
  ),
  (
    '20000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000021',
    'rollback-key-22',
    'manual_text',
    'selection',
    'Rollback fixture',
    'normal',
    null,
    '[]'::jsonb,
    'awaiting_upload',
    now() + interval '2 hours'
  ),
  (
    '20000000-0000-0000-0000-000000000023',
    '00000000-0000-0000-0000-000000000021',
    'duplicate-key-23',
    'chatgpt_web',
    'full_conversation',
    'Synthetic conversation again',
    'normal',
    'synthetic-conversation',
    '[]'::jsonb,
    'awaiting_upload',
    now() + interval '2 hours'
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}',
  true
);

select throws_like(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000021',
      '20000000-0000-0000-0000-000000000021',
      'finalize-key-21',
      'complete',
      '{}',
      'Q A',
      repeat('a', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  '%permission denied%',
  'authenticated clients cannot execute the finalization RPC'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000021',
      '20000000-0000-0000-0000-000000000021',
      'finalize-key-21',
      'complete',
      '{}',
      'Q A',
      repeat('a', 64),
      jsonb_build_array(
        jsonb_build_object(
          'externalMessageId', 'message-1',
          'role', 'user',
          'text', 'Q',
          'ordinal', 0
        ),
        jsonb_build_object(
          'externalMessageId', 'message-2',
          'role', 'assistant',
          'text', 'A',
          'ordinal', 1
        )
      ),
      '[]'::jsonb
    )
  $$,
  'service role atomically finalizes a valid capture'
);

reset role;

select is(
  (
    select status::text
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000021'
  ),
  'finalized',
  'successful finalization marks the session finalized'
);

select is(
  (
    select count(*)::integer
    from public.source_versions
    where capture_session_id = '20000000-0000-0000-0000-000000000021'
  ),
  1,
  'successful finalization creates one source version'
);

select is(
  (
    select count(*)::integer
    from public.source_messages
    where source_version_id = (
      select id
      from public.source_versions
      where capture_session_id = '20000000-0000-0000-0000-000000000021'
    )
  ),
  2,
  'receipt counts are backed by committed message rows'
);

select is(
  (
    select count(*)::integer
    from public.processing_jobs
    where source_version_id = (
      select id
      from public.source_versions
      where capture_session_id = '20000000-0000-0000-0000-000000000021'
    )
      and status = 'queued'
      and job_type = 'normalize_source'
  ),
  1,
  'successful finalization queues one processing job'
);

select is(
  (
    select item.space_id = public.ensure_private_space(item.owner_user_id)
    from public.source_items as item
    join public.capture_sessions as capture
      on capture.source_item_id = item.id
    where capture.id = '20000000-0000-0000-0000-000000000021'
  ),
  true,
  'finalization assigns the owner private space without a client spaceId'
);

select is(
  (
    select job.space_id = item.space_id
    from public.processing_jobs as job
    join public.source_versions as version
      on version.id = job.source_version_id
    join public.source_items as item
      on item.id = version.source_item_id
    where version.capture_session_id = '20000000-0000-0000-0000-000000000021'
      and job.job_type = 'normalize_source'
  ),
  true,
  'the queued normalize_source job stays in the same private space'
);

set local role service_role;

select lives_ok(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000021',
      '20000000-0000-0000-0000-000000000021',
      'finalize-key-21',
      'complete',
      '{}',
      'Q A',
      repeat('a', 64),
      jsonb_build_array(
        jsonb_build_object(
          'externalMessageId', 'message-1',
          'role', 'user',
          'text', 'Q',
          'ordinal', 0
        ),
        jsonb_build_object(
          'externalMessageId', 'message-2',
          'role', 'assistant',
          'text', 'A',
          'ordinal', 1
        )
      ),
      '[]'::jsonb
    )
  $$,
  'an identical finalization retry returns the committed receipt'
);

select lives_ok(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000021',
      '20000000-0000-0000-0000-000000000023',
      'duplicate-key-23',
      'complete',
      '{}',
      'Q A',
      repeat('a', 64),
      jsonb_build_array(
        jsonb_build_object(
          'externalMessageId', 'message-1',
          'role', 'user',
          'text', 'Q',
          'ordinal', 0
        ),
        jsonb_build_object(
          'externalMessageId', 'message-2',
          'role', 'assistant',
          'text', 'A',
          'ordinal', 1
        )
      ),
      '[]'::jsonb
    )
  $$,
  'the same source content with a new idempotency key is deduplicated'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.source_versions
    where source_item_id = (
      select source_item_id
      from public.capture_sessions
      where id = '20000000-0000-0000-0000-000000000021'
    )
  ),
  1,
  'deduplication does not create a duplicate source version'
);

select is(
  (
    select result_source_version_id
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000023'
  ),
  (
    select result_source_version_id
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000021'
  ),
  'the duplicate capture points to the existing durable source version'
);

select is(
  (
    select count(*)::integer
    from public.processing_jobs
    where source_version_id = (
      select result_source_version_id
      from public.capture_sessions
      where id = '20000000-0000-0000-0000-000000000021'
    )
      and job_type = 'normalize_source'
  ),
  1,
  'idempotent finalization reuses the same normalize_source job'
);

select is(
  (
    select item.space_id
    from public.source_items as item
    join public.capture_sessions as capture
      on capture.source_item_id = item.id
    where capture.id = '20000000-0000-0000-0000-000000000021'
  )
  is distinct from public.ensure_private_space(
    '00000000-0000-0000-0000-000000000022'
  ),
  true,
  'owner A capture cannot land in owner B private space'
);

set local role service_role;

select throws_like(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000021',
      '20000000-0000-0000-0000-000000000021',
      'finalize-key-21',
      'complete',
      '{}',
      'different content',
      repeat('b', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  '%idempotency conflict%',
  'an idempotency retry with different content is rejected'
);

select throws_like(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000022',
      '20000000-0000-0000-0000-000000000021',
      'finalize-key-21',
      'complete',
      '{}',
      'Q A',
      repeat('a', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  '%capture session not found%',
  'a different owner cannot finalize the session'
);

select throws_like(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000021',
      '20000000-0000-0000-0000-000000000022',
      'rollback-key-22',
      'complete',
      '{}',
      'rollback',
      repeat('c', 64),
      jsonb_build_array(
        jsonb_build_object(
          'externalMessageId', 'invalid-message',
          'role', 'invalid-role',
          'text', 'rollback',
          'ordinal', 0
        )
      ),
      '[]'::jsonb
    )
  $$,
  '%source_messages_role_valid%',
  'a failed child write aborts finalization'
);

reset role;

select is(
  (
    select status::text
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000022'
  ),
  'awaiting_upload',
  'a failed finalization leaves the capture session retryable'
);

select is(
  (
    select count(*)::integer
    from public.source_versions
    where capture_session_id = '20000000-0000-0000-0000-000000000022'
  ),
  0,
  'a failed finalization leaves no source version'
);

select * from finish();
rollback;
