begin;

select plan(13);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000071', 'space-owner-a@example.test'),
  ('00000000-0000-0000-0000-000000000072', 'space-owner-b@example.test');

insert into public.source_items (
  id,
  owner_user_id,
  source,
  title,
  sensitivity,
  current_version
)
values
  (
    '10000000-0000-0000-0000-000000000071',
    '00000000-0000-0000-0000-000000000071',
    'manual_text',
    'Owner A item',
    'normal',
    1
  ),
  (
    '10000000-0000-0000-0000-000000000072',
    '00000000-0000-0000-0000-000000000072',
    'manual_text',
    'Owner B item',
    'normal',
    1
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
)
values
  (
    '20000000-0000-0000-0000-000000000071',
    '00000000-0000-0000-0000-000000000071',
    '10000000-0000-0000-0000-000000000071',
    'space-key-71xxxx',
    'manual_text',
    'selection',
    'Owner A item',
    'normal',
    'finalized',
    now() + interval '2 hours',
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000072',
    '00000000-0000-0000-0000-000000000072',
    '10000000-0000-0000-0000-000000000072',
    'space-key-72xxxx',
    'manual_text',
    'selection',
    'Owner B item',
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
values
  (
    '30000000-0000-0000-0000-000000000071',
    '00000000-0000-0000-0000-000000000071',
    '10000000-0000-0000-0000-000000000071',
    1,
    '20000000-0000-0000-0000-000000000071',
    'complete',
    '{}'::text[],
    'owner a',
    repeat('a', 64)
  ),
  (
    '30000000-0000-0000-0000-000000000072',
    '00000000-0000-0000-0000-000000000072',
    '10000000-0000-0000-0000-000000000072',
    1,
    '20000000-0000-0000-0000-000000000072',
    'complete',
    '{}'::text[],
    'owner b',
    repeat('b', 64)
  );

insert into public.processing_jobs (
  owner_user_id,
  source_version_id,
  job_type
)
values
  (
    '00000000-0000-0000-0000-000000000071',
    '30000000-0000-0000-0000-000000000071',
    'normalize_source'
  ),
  (
    '00000000-0000-0000-0000-000000000072',
    '30000000-0000-0000-0000-000000000072',
    'normalize_source'
  );

select is(
  (
    select count(*)::integer
    from public.spaces
    where owner_user_id = '00000000-0000-0000-0000-000000000071'
      and type = 'private'
  ),
  1,
  'owner A has exactly one private space'
);

select is(
  (
    select count(*)::integer
    from public.spaces
    where owner_user_id = '00000000-0000-0000-0000-000000000072'
      and type = 'private'
  ),
  1,
  'owner B has exactly one private space'
);

select is(
  (
    select count(*)::integer
    from public.space_members as membership
    join public.spaces as space
      on space.id = membership.space_id
    where space.owner_user_id = '00000000-0000-0000-0000-000000000071'
      and membership.user_id = '00000000-0000-0000-0000-000000000071'
      and membership.role = 'owner'
  ),
  1,
  'owner A has exactly one owner membership'
);

select is(
  (
    select item.space_id = space.id
      and space.owner_user_id = item.owner_user_id
    from public.source_items as item
    join public.spaces as space
      on space.id = item.space_id
    where item.id = '10000000-0000-0000-0000-000000000071'
  ),
  true,
  'owner A source item space_id belongs to the same owner'
);

select is(
  (
    select job.space_id = item.space_id
    from public.processing_jobs as job
    join public.source_versions as version
      on version.id = job.source_version_id
    join public.source_items as item
      on item.id = version.source_item_id
    where job.source_version_id = '30000000-0000-0000-0000-000000000071'
  ),
  true,
  'owner A processing job space_id matches its source item'
);

select is(
  public.ensure_private_space('00000000-0000-0000-0000-000000000071'),
  public.ensure_private_space('00000000-0000-0000-0000-000000000071'),
  'ensure_private_space is idempotent for the same owner'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000071","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::integer
    from public.spaces
    where owner_user_id = '00000000-0000-0000-0000-000000000072'
  ),
  0,
  'owner A cannot select owner B space'
);

select is(
  (
    select count(*)::integer
    from public.space_members
    where user_id = '00000000-0000-0000-0000-000000000072'
  ),
  0,
  'owner A cannot select owner B membership'
);

select is(
  (
    select count(*)::integer
    from public.source_items
    where owner_user_id = '00000000-0000-0000-0000-000000000072'
  ),
  0,
  'owner A cannot select owner B source item'
);

select is(
  (
    select count(*)::integer
    from public.processing_jobs
    where owner_user_id = '00000000-0000-0000-0000-000000000072'
  ),
  0,
  'owner A cannot select owner B processing job'
);

select throws_like(
  $$insert into public.spaces (type, name, owner_user_id, created_by_user_id)
    values (
      'shared',
      'Should fail',
      '00000000-0000-0000-0000-000000000071',
      '00000000-0000-0000-0000-000000000071'
    )$$,
  '%permission denied%',
  'authenticated users cannot create a shared space'
);

reset role;

select throws_like(
  $$insert into public.source_items (
      id,
      owner_user_id,
      space_id,
      source,
      title,
      sensitivity
    )
    values (
      '10000000-0000-0000-0000-000000000079',
      '00000000-0000-0000-0000-000000000072',
      (
        select id
        from public.spaces
        where owner_user_id = '00000000-0000-0000-0000-000000000071'
          and type = 'private'
      ),
      'manual_text',
      'Mismatched ownership',
      'normal'
    )$$,
  '%source_items_space_owner_fk%',
  'mismatched owner and space fail even as service role'
);

select is(
  (
    select job_type
    from public.processing_jobs
    where source_version_id = '30000000-0000-0000-0000-000000000071'
  ),
  'normalize_source',
  'placeholder job type is normalize_source'
);

select * from finish();

rollback;
