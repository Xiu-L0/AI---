begin;

select plan(13);

insert into auth.users (id, email)
values
  (
    '00000000-0000-0000-0000-000000000051',
    'recovery-single-winner@example.test'
  ),
  (
    '00000000-0000-0000-0000-000000000052',
    'recovery-cousin-winner@example.test'
  );

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
  failure_reason,
  expires_at,
  recovery_of_capture_session_id
)
values
  (
    '20000000-0000-0000-0000-000000000051',
    '00000000-0000-0000-0000-000000000051',
    'recovery-parent-51',
    'manual_text',
    'upload',
    'Original failed capture',
    'normal',
    null,
    '[]'::jsonb,
    'failed',
    'capture session expired',
    now() + interval '2 hours',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000052',
    '00000000-0000-0000-0000-000000000051',
    'recovery-sibling-52',
    'manual_text',
    'upload',
    'First sibling recovery',
    'normal',
    null,
    '[]'::jsonb,
    'awaiting_upload',
    null,
    now() + interval '2 hours',
    '20000000-0000-0000-0000-000000000051'
  ),
  (
    '20000000-0000-0000-0000-000000000053',
    '00000000-0000-0000-0000-000000000051',
    'recovery-sibling-53',
    'manual_text',
    'upload',
    'Second sibling recovery',
    'normal',
    null,
    '[]'::jsonb,
    'awaiting_upload',
    null,
    now() + interval '2 hours',
    '20000000-0000-0000-0000-000000000051'
  );

set local role service_role;

select lives_ok(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000051',
      '20000000-0000-0000-0000-000000000052',
      'recovery-sibling-52',
      'complete',
      '{}',
      'first durable recovery',
      repeat('a', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'the first sibling recovery can finalize'
);

select is(
  (
    select resolved_by_capture_session_id
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000051'
  ),
  '20000000-0000-0000-0000-000000000052'::uuid,
  'the first durable sibling becomes the parent recovery winner'
);

select throws_like(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000051',
      '20000000-0000-0000-0000-000000000053',
      'recovery-sibling-53',
      'partial',
      array['late partial recovery'],
      'second recovery must not replace the winner',
      repeat('b', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  '%capture recovery target is already resolved%',
  'a later sibling cannot finalize after the parent has a durable winner'
);

select is(
  (
    select status
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000053'
  ),
  'awaiting_upload',
  'the losing sibling remains unfinalized after its transaction rolls back'
);

select is(
  (
    select count(*)::integer
    from public.source_versions
    where owner_user_id = '00000000-0000-0000-0000-000000000051'
  ),
  1,
  'the losing sibling cannot leave a second durable source version'
);

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
  failure_reason,
  expires_at,
  recovery_of_capture_session_id
)
values
  (
    '20000000-0000-0000-0000-000000000061',
    '00000000-0000-0000-0000-000000000052',
    'recovery-root-61',
    'manual_text',
    'upload',
    'Shared failed root',
    'normal',
    null,
    '[]'::jsonb,
    'failed',
    'capture session expired',
    now() + interval '2 hours',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000062',
    '00000000-0000-0000-0000-000000000052',
    'recovery-left-parent-62',
    'manual_text',
    'upload',
    'Left failed recovery parent',
    'normal',
    null,
    '[]'::jsonb,
    'failed',
    'capture session expired',
    now() + interval '2 hours',
    '20000000-0000-0000-0000-000000000061'
  ),
  (
    '20000000-0000-0000-0000-000000000063',
    '00000000-0000-0000-0000-000000000052',
    'recovery-right-parent-63',
    'manual_text',
    'upload',
    'Right failed recovery parent',
    'normal',
    null,
    '[]'::jsonb,
    'failed',
    'capture session expired',
    now() + interval '2 hours',
    '20000000-0000-0000-0000-000000000061'
  ),
  (
    '20000000-0000-0000-0000-000000000064',
    '00000000-0000-0000-0000-000000000052',
    'recovery-left-leaf-64',
    'manual_text',
    'upload',
    'Left cousin leaf',
    'normal',
    null,
    '[]'::jsonb,
    'awaiting_upload',
    null,
    now() + interval '2 hours',
    '20000000-0000-0000-0000-000000000062'
  ),
  (
    '20000000-0000-0000-0000-000000000065',
    '00000000-0000-0000-0000-000000000052',
    'recovery-right-leaf-65',
    'manual_text',
    'upload',
    'Right cousin leaf',
    'normal',
    null,
    '[]'::jsonb,
    'awaiting_upload',
    null,
    now() + interval '2 hours',
    '20000000-0000-0000-0000-000000000063'
  );

select lives_ok(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000052',
      '20000000-0000-0000-0000-000000000064',
      'recovery-left-leaf-64',
      'complete',
      '{}',
      'left cousin durable recovery',
      repeat('c', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'the first cousin branch can finalize'
);

select is(
  (
    select count(*)::integer
    from public.capture_sessions
    where id in (
      '20000000-0000-0000-0000-000000000061',
      '20000000-0000-0000-0000-000000000062'
    )
      and resolved_by_capture_session_id =
        '20000000-0000-0000-0000-000000000064'
  ),
  2,
  'the first cousin winner resolves its complete ancestor path'
);

select ok(
  (
    select resolved_at is null
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000063'
  ),
  'the other cousin parent remains locally unresolved before its leaf finalizes'
);

select throws_like(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-000000000052',
      '20000000-0000-0000-0000-000000000065',
      'recovery-right-leaf-65',
      'partial',
      array['late cousin partial'],
      'right cousin must not replace the root winner',
      repeat('d', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  '%capture recovery ancestor is already resolved%',
  'a cousin branch cannot finalize after the shared root has a durable winner'
);

select is(
  (
    select status
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000065'
  ),
  'awaiting_upload',
  'the losing cousin leaf remains unfinalized after rollback'
);

select ok(
  (
    select result_source_version_id is null
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000065'
  ),
  'the losing cousin leaf does not retain a durable receipt pointer'
);

select is(
  (
    select count(*)::integer
    from public.source_versions
    where owner_user_id = '00000000-0000-0000-0000-000000000052'
  ),
  1,
  'the losing cousin branch cannot leave a second source version'
);

select is(
  (
    select count(*)::integer
    from public.processing_jobs
    where owner_user_id = '00000000-0000-0000-0000-000000000052'
  ),
  1,
  'the losing cousin branch cannot leave a second processing job'
);

select * from finish();
rollback;
