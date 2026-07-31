begin;

select plan(12);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000061', 'failure-owner@example.test'),
  ('00000000-0000-0000-0000-000000000062', 'failure-other@example.test');

insert into public.source_items (
  id,
  owner_user_id,
  source,
  title,
  sensitivity
)
values (
  '10000000-0000-0000-0000-000000000062',
  '00000000-0000-0000-0000-000000000061',
  'manual_text',
  'Finalized capture source',
  'normal'
);

insert into public.capture_sessions (
  id,
  owner_user_id,
  idempotency_key,
  source,
  scope,
  title,
  sensitivity,
  expected_attachments,
  status,
  failure_reason,
  expires_at,
  source_item_id,
  finalized_at,
  resolved_at,
  resolved_by_capture_session_id
)
values
  (
    '20000000-0000-0000-0000-000000000061',
    '00000000-0000-0000-0000-000000000061',
    'failure-awaiting-61',
    'manual_text',
    'upload',
    'Awaiting capture',
    'normal',
    '[]'::jsonb,
    'awaiting_upload',
    null,
    now() + interval '2 hours',
    null,
    null,
    null,
    null
  ),
  (
    '20000000-0000-0000-0000-000000000062',
    '00000000-0000-0000-0000-000000000061',
    'failure-finalized-62',
    'manual_text',
    'upload',
    'Finalized capture',
    'normal',
    '[]'::jsonb,
    'finalized',
    null,
    now() + interval '2 hours',
    '10000000-0000-0000-0000-000000000062',
    now(),
    null,
    null
  ),
  (
    '20000000-0000-0000-0000-000000000063',
    '00000000-0000-0000-0000-000000000061',
    'failure-failed-63',
    'manual_text',
    'upload',
    'Already failed capture',
    'normal',
    '[]'::jsonb,
    'failed',
    'original reason',
    now() + interval '2 hours',
    null,
    null,
    null,
    null
  ),
  (
    '20000000-0000-0000-0000-000000000064',
    '00000000-0000-0000-0000-000000000062',
    'failure-other-owner-64',
    'manual_text',
    'upload',
    'Other owner capture',
    'normal',
    '[]'::jsonb,
    'awaiting_upload',
    null,
    now() + interval '2 hours',
    null,
    null,
    null,
    null
  ),
  (
    '20000000-0000-0000-0000-000000000065',
    '00000000-0000-0000-0000-000000000061',
    'failure-resolved-65',
    'manual_text',
    'upload',
    'Resolved capture',
    'normal',
    '[]'::jsonb,
    'awaiting_upload',
    null,
    now() + interval '2 hours',
    null,
    null,
    now(),
    '20000000-0000-0000-0000-000000000066'
  ),
  (
    '20000000-0000-0000-0000-000000000066',
    '00000000-0000-0000-0000-000000000061',
    'failure-resolver-66',
    'manual_text',
    'upload',
    'Durable recovery winner',
    'normal',
    '[]'::jsonb,
    'finalized',
    null,
    now() + interval '2 hours',
    '10000000-0000-0000-0000-000000000062',
    now(),
    null,
    null
  );

set local role service_role;

select lives_ok(
  $$
    select public.report_capture_failure(
      '00000000-0000-0000-0000-000000000061',
      '20000000-0000-0000-0000-000000000061',
      '  Upload targets did not match the frozen manifest  '
    )
  $$,
  'an owner can report an awaiting upload session as failed'
);

select is(
  (
    select status::text
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000061'
  ),
  'failed',
  'the awaiting session becomes failed'
);

select is(
  (
    select failure_reason
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000061'
  ),
  'Upload targets did not match the frozen manifest',
  'the bounded user-safe reason is trimmed and stored'
);

select throws_like(
  $$
    select public.report_capture_failure(
      '00000000-0000-0000-0000-000000000061',
      '20000000-0000-0000-0000-000000000062',
      'must not replace finalized state'
    )
  $$,
  '%capture session cannot be reported as failed%',
  'a finalized session cannot be overwritten'
);

select is(
  (
    select status::text
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000062'
  ),
  'finalized',
  'the finalized session remains finalized'
);

select throws_like(
  $$
    select public.report_capture_failure(
      '00000000-0000-0000-0000-000000000061',
      '20000000-0000-0000-0000-000000000063',
      'must not replace the first failure'
    )
  $$,
  '%capture session cannot be reported as failed%',
  'an already failed session cannot be overwritten'
);

select is(
  (
    select failure_reason
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000063'
  ),
  'original reason',
  'the original failure reason remains intact'
);

select throws_like(
  $$
    select public.report_capture_failure(
      '00000000-0000-0000-0000-000000000061',
      '20000000-0000-0000-0000-000000000064',
      'must not expose or mutate another owner'
    )
  $$,
  '%capture session was not found%',
  'another owner session is indistinguishable from a missing session'
);

select is(
  (
    select status::text
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000064'
  ),
  'awaiting_upload',
  'another owner session remains unchanged'
);

select throws_like(
  $$
    select public.report_capture_failure(
      '00000000-0000-0000-0000-000000000061',
      '20000000-0000-0000-0000-000000000065',
      'must not reopen resolved recovery state'
    )
  $$,
  '%capture session cannot be reported as failed%',
  'a resolved session cannot be overwritten'
);

select is(
  (
    select status::text
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000065'
  ),
  'awaiting_upload',
  'the resolved session state remains unchanged'
);

select throws_like(
  $$
    select public.report_capture_failure(
      '00000000-0000-0000-0000-000000000061',
      '20000000-0000-0000-0000-000000000099',
      'missing session'
    )
  $$,
  '%capture session was not found%',
  'a missing session is rejected'
);

select * from finish();
rollback;
