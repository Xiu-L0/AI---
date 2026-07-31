begin;

select plan(5);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000041', 'recovery-owner@example.test'),
  ('00000000-0000-0000-0000-000000000042', 'recovery-other@example.test');

insert into public.source_items (
  id,
  owner_user_id,
  source,
  external_ref,
  title,
  sensitivity
)
values (
  '10000000-0000-0000-0000-000000000041',
  '00000000-0000-0000-0000-000000000041',
  'manual_text',
  null,
  'Recovered manual capture',
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
  recovery_of_capture_session_id
)
values
  (
    '20000000-0000-0000-0000-000000000041',
    '00000000-0000-0000-0000-000000000041',
    'recovery-root-41',
    'manual_text',
    'upload',
    'Original failed capture',
    'normal',
    '[]'::jsonb,
    'failed',
    'capture session expired',
    now() + interval '2 hours',
    null
  ),
  (
    '20000000-0000-0000-0000-000000000042',
    '00000000-0000-0000-0000-000000000041',
    'recovery-parent-42',
    'manual_text',
    'upload',
    'First recovery failed',
    'normal',
    '[]'::jsonb,
    'failed',
    'capture session expired',
    now() + interval '2 hours',
    '20000000-0000-0000-0000-000000000041'
  ),
  (
    '20000000-0000-0000-0000-000000000043',
    '00000000-0000-0000-0000-000000000041',
    'recovery-success-43',
    'manual_text',
    'upload',
    'Successful recovery',
    'normal',
    '[]'::jsonb,
    'awaiting_upload',
    null,
    now() + interval '2 hours',
    '20000000-0000-0000-0000-000000000042'
  ),
  (
    '20000000-0000-0000-0000-000000000044',
    '00000000-0000-0000-0000-000000000041',
    'unrelated-failed-44',
    'manual_text',
    'upload',
    'Unrelated failure',
    'normal',
    '[]'::jsonb,
    'failed',
    'capture session expired',
    now() + interval '2 hours',
    null
  );

select throws_like(
  $$
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
      expires_at,
      recovery_of_capture_session_id
    ) values (
      '20000000-0000-0000-0000-000000000045',
      '00000000-0000-0000-0000-000000000042',
      'cross-owner-recovery-45',
      'manual_text',
      'upload',
      'Cross-owner recovery',
      'normal',
      '[]'::jsonb,
      'awaiting_upload',
      now() + interval '2 hours',
      '20000000-0000-0000-0000-000000000041'
    )
  $$,
  '%recovery target was not found for this owner%',
  'recovery links cannot cross owner boundaries'
);

update public.capture_sessions
set
  source_item_id = '10000000-0000-0000-0000-000000000041',
  status = 'finalized',
  finalized_at = now()
where id = '20000000-0000-0000-0000-000000000043';

select is(
  (
    select count(*)::integer
    from public.capture_sessions
    where id in (
      '20000000-0000-0000-0000-000000000041',
      '20000000-0000-0000-0000-000000000042'
    )
      and resolved_at is not null
      and resolved_by_capture_session_id =
        '20000000-0000-0000-0000-000000000043'
  ),
  2,
  'a durable recovery resolves the entire explicit ancestor chain'
);

select is(
  (
    select count(*)::integer
    from public.capture_sessions
    where id = '20000000-0000-0000-0000-000000000044'
      and resolved_at is null
      and resolved_by_capture_session_id is null
  ),
  1,
  'an unrelated failed session remains unresolved'
);

select is(
  (
    select count(*)::integer
    from public.capture_sessions
    where owner_user_id = '00000000-0000-0000-0000-000000000041'
      and status = 'failed'
      and resolved_at is null
  ),
  1,
  'only unresolved failures remain in the Web exception query scope'
);

select throws_like(
  $$
    update public.capture_sessions
    set
      source_item_id = '10000000-0000-0000-0000-000000000041',
      failure_reason = null,
      status = 'finalized',
      finalized_at = now()
    where id = '20000000-0000-0000-0000-000000000041'
  $$,
  '%resolved capture sessions cannot be finalized%',
  'a superseded session cannot commit after its recovery receipt'
);

select * from finish();
rollback;
