begin;

select plan(18);

create function pg_temp.seed_queue_version(
  owner_id uuid,
  item_id uuid,
  session_id uuid,
  version_id uuid,
  next_attempt timestamptz,
  created timestamptz
) returns uuid
language plpgsql
as $$
declare
  job_id uuid;
begin
  insert into public.source_items (
    id,
    owner_user_id,
    source,
    title,
    sensitivity,
    current_version
  )
  values (
    item_id,
    owner_id,
    'manual_text',
    'Queue fixture ' || item_id::text,
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
  values (
    session_id,
    owner_id,
    item_id,
    'queue-key-' || session_id::text,
    'manual_text',
    'selection',
    'Queue fixture',
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
    1,
    session_id,
    'complete',
    '{}'::text[],
    'queue fixture',
    repeat(substr(replace(version_id::text, '-', ''), 1, 1), 64)
  );

  insert into public.processing_jobs (
    owner_user_id,
    source_version_id,
    job_type,
    next_attempt_at,
    created_at
  )
  values (
    owner_id,
    version_id,
    'normalize_source',
    next_attempt,
    created
  )
  returning id into job_id;

  return job_id;
end;
$$;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000b1', 'queue-owner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'queue-owner-b@example.test');

update public.processing_jobs
set next_attempt_at = now() + interval '7 days'
where status in ('queued', 'processing');

select pg_temp.seed_queue_version(
  '00000000-0000-0000-0000-0000000000b1',
  '10000000-0000-0000-0000-0000000000b1',
  '20000000-0000-0000-0000-0000000000b1',
  '30000000-0000-0000-0000-0000000000b1',
  now() - interval '50 seconds',
  now() - interval '50 seconds'
);
select pg_temp.seed_queue_version(
  '00000000-0000-0000-0000-0000000000b1',
  '10000000-0000-0000-0000-0000000000b2',
  '20000000-0000-0000-0000-0000000000b2',
  '30000000-0000-0000-0000-0000000000b2',
  now() - interval '40 seconds',
  now() - interval '40 seconds'
);
select pg_temp.seed_queue_version(
  '00000000-0000-0000-0000-0000000000b1',
  '10000000-0000-0000-0000-0000000000b3',
  '20000000-0000-0000-0000-0000000000b3',
  '30000000-0000-0000-0000-0000000000b3',
  now() - interval '30 seconds',
  now() - interval '30 seconds'
);
select pg_temp.seed_queue_version(
  '00000000-0000-0000-0000-0000000000b1',
  '10000000-0000-0000-0000-0000000000b4',
  '20000000-0000-0000-0000-0000000000b4',
  '30000000-0000-0000-0000-0000000000b4',
  now() - interval '20 seconds',
  now() - interval '20 seconds'
);
select pg_temp.seed_queue_version(
  '00000000-0000-0000-0000-0000000000b1',
  '10000000-0000-0000-0000-0000000000b5',
  '20000000-0000-0000-0000-0000000000b5',
  '30000000-0000-0000-0000-0000000000b5',
  now() - interval '10 seconds',
  now() - interval '10 seconds'
);
select pg_temp.seed_queue_version(
  '00000000-0000-0000-0000-0000000000b2',
  '10000000-0000-0000-0000-0000000000b6',
  '20000000-0000-0000-0000-0000000000b6',
  '30000000-0000-0000-0000-0000000000b6',
  now() - interval '5 seconds',
  now() - interval '5 seconds'
);
select pg_temp.seed_queue_version(
  '00000000-0000-0000-0000-0000000000b1',
  '10000000-0000-0000-0000-0000000000b7',
  '20000000-0000-0000-0000-0000000000b7',
  '30000000-0000-0000-0000-0000000000b7',
  now() + interval '1 day',
  now() - interval '1 second'
);

set local role service_role;

create temporary table claimed_a on commit drop as
select *
from public.claim_processing_jobs('worker-a', 2, 60);

select is(
  (select count(*)::integer from claimed_a),
  2,
  'worker-a claims at most two due jobs'
);

select is(
  array(
    select claimed_a.source_version_id::text
    from claimed_a
    join public.processing_jobs as job
      on job.id = claimed_a.job_id
    order by job.next_attempt_at, job.created_at
  ),
  array[
    '30000000-0000-0000-0000-0000000000b1',
    '30000000-0000-0000-0000-0000000000b2'
  ],
  'claims are ordered by next_attempt_at then created_at'
);

select is(
  (
    select bool_and(attempt = 1 and job.attempt_count = 1)
    from claimed_a
    join public.processing_jobs as job
      on job.id = claimed_a.job_id
  ),
  true,
  'first claim increments attempt_count once and opens attempt 1'
);

create temporary table claimed_b on commit drop as
select *
from public.claim_processing_jobs('worker-b', 10, 60);

select is(
  (select count(*)::integer from claimed_b),
  4,
  'worker-b receives only remaining due jobs'
);

select is(
  (
    select count(*)::integer
    from claimed_b
    where job_id in (select job_id from claimed_a)
  ),
  0,
  'a second worker cannot claim an unexpired lease'
);

select throws_like(
  format(
    $$select public.complete_processing_job(
      %L::uuid,
      %L::uuid,
      'worker-b',
      '{}'::jsonb,
      'stolen lease'
    )$$,
    (select job_id from claimed_a order by source_version_id limit 1),
    (select run_id from claimed_a order by source_version_id limit 1)
  ),
  '%lease%',
  'completing cannot close another worker lease'
);

select public.complete_processing_job(
  (select job_id from claimed_a where source_version_id = '30000000-0000-0000-0000-0000000000b1'),
  (select run_id from claimed_a where source_version_id = '30000000-0000-0000-0000-0000000000b1'),
  'worker-a',
  '{"inputTokens":1}'::jsonb,
  'normalized'
);

select is(
  (
    select job.status = 'complete'
      and job.locked_by is null
      and job.lease_expires_at is null
      and job.completed_at is not null
      and run.status = 'complete'
      and run.finished_at is not null
      and run.result_summary = 'normalized'
    from public.processing_jobs as job
    join public.processing_runs as run
      on run.processing_job_id = job.id
     and run.id = (
       select run_id
       from claimed_a
       where source_version_id = '30000000-0000-0000-0000-0000000000b1'
     )
    where job.source_version_id = '30000000-0000-0000-0000-0000000000b1'
  ),
  true,
  'complete closes the matching job and run'
);

reset role;
update public.processing_jobs
set lease_expires_at = now() - interval '1 second'
where id = (
  select job_id
  from claimed_a
  where source_version_id = '30000000-0000-0000-0000-0000000000b2'
);
set local role service_role;

create temporary table claimed_expired on commit drop as
select *
from public.claim_processing_jobs('worker-c', 1, 60);

select is(
  (
    select claimed_expired.job_id = (
        select job_id
        from claimed_a
        where source_version_id = '30000000-0000-0000-0000-0000000000b2'
      )
      and claimed_expired.run_id <> (
        select run_id
        from claimed_a
        where source_version_id = '30000000-0000-0000-0000-0000000000b2'
      )
      and claimed_expired.attempt = 2
      and job.attempt_count = 2
    from claimed_expired
    join public.processing_jobs as job
      on job.id = claimed_expired.job_id
  ),
  true,
  'an expired lease is reclaimable and opens a new run'
);

select is(
  (
    select count(*)::integer
    from public.claim_processing_jobs('worker-c', 10, 60)
  ),
  0,
  'a poll with no due jobs claims nothing'
);

select is(
  (
    select attempt_count
    from public.processing_jobs
    where source_version_id = '30000000-0000-0000-0000-0000000000b2'
  ),
  2,
  'attempt_count increments once per claim, not once per poll'
);

select public.fail_processing_job(
  (select job_id from claimed_b where source_version_id = '30000000-0000-0000-0000-0000000000b3'),
  (select run_id from claimed_b where source_version_id = '30000000-0000-0000-0000-0000000000b3'),
  'worker-b',
  'source_unavailable',
  'retry later',
  true
);

select is(
  (
    select job.status = 'queued'
      and job.locked_by is null
      and job.next_attempt_at > now()
      and run.status = 'failed'
      and run.error_code = 'source_unavailable'
    from public.processing_jobs as job
    join public.processing_runs as run
      on run.id = (
        select run_id
        from claimed_b
        where source_version_id = '30000000-0000-0000-0000-0000000000b3'
      )
    where job.source_version_id = '30000000-0000-0000-0000-0000000000b3'
  ),
  true,
  'retryable failure returns the job to queued with a future next_attempt_at'
);

reset role;
update public.processing_jobs
set next_attempt_at = now() - interval '1 second'
where source_version_id = '30000000-0000-0000-0000-0000000000b7';

create temporary table max_fail_job on commit drop as
select id as job_id
from public.processing_jobs
where source_version_id = '30000000-0000-0000-0000-0000000000b7';

do $$
declare
  claimed record;
  attempt integer;
begin
  for attempt in 1..5 loop
    update public.processing_jobs
    set next_attempt_at = now() - interval '1 second'
    where id = (select job_id from max_fail_job)
      and status = 'queued';

    select * into claimed
    from public.claim_processing_jobs('worker-fail', 1, 60);

    perform public.fail_processing_job(
      claimed.job_id,
      claimed.run_id,
      'worker-fail',
      'model_timeout',
      'retry',
      true
    );
  end loop;
end;
$$;

select is(
  (
    select job.status = 'failed'
      and job.attempt_count = 5
      and job.locked_by is null
    from public.processing_jobs as job
    where job.source_version_id = '30000000-0000-0000-0000-0000000000b7'
  ),
  true,
  'the fifth retryable failure marks the job failed'
);

select is(
  (
    select count(*)::integer
    from public.claim_processing_jobs('worker-fail', 5, 60)
    where source_version_id = '30000000-0000-0000-0000-0000000000b7'
  ),
  0,
  'a failed job at max attempts cannot be claimed again'
);

select throws_like(
  format(
    $$select public.complete_processing_job(
      %L::uuid,
      %L::uuid,
      'worker-b',
      '{}'::jsonb,
      'mismatched run'
    )$$,
    (select job_id from claimed_b where source_version_id = '30000000-0000-0000-0000-0000000000b4'),
    (select run_id from claimed_b where source_version_id = '30000000-0000-0000-0000-0000000000b5')
  ),
  '%mismatch%',
  'owner/space/source-version or run mismatch is rejected'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}',
  true
);

select throws_like(
  $$select * from public.claim_processing_jobs('worker-user', 1, 60)$$,
  '%permission denied%',
  'authenticated users cannot execute claim_processing_jobs'
);

select throws_like(
  $$insert into public.processing_runs (
      processing_job_id,
      owner_user_id,
      space_id,
      attempt,
      processor_type
    )
    values (
      (select id from public.processing_jobs limit 1),
      '00000000-0000-0000-0000-0000000000b1',
      (select space_id from public.processing_jobs limit 1),
      99,
      'normalize_source'
    )$$,
  '%permission denied%',
  'authenticated users cannot write processing_runs'
);

select is(
  (
    select count(*)::integer
    from public.processing_runs
    where owner_user_id = '00000000-0000-0000-0000-0000000000b1'
  ) > 0
  and (
    select count(*)::integer
    from public.processing_runs
    where owner_user_id = '00000000-0000-0000-0000-0000000000b2'
  ) = 0,
  true,
  'an owner can select only their own processing runs'
);

reset role;
set local role anon;

select throws_like(
  $$select * from public.complete_processing_job(
    '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000b1',
    'anon',
    '{}'::jsonb,
    'nope'
  )$$,
  '%permission denied%',
  'anon cannot execute queue completion'
);

reset role;

select * from finish();

rollback;
