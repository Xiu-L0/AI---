alter table public.processing_jobs
  add column max_attempts integer not null default 5,
  add column locked_by text,
  add column lease_expires_at timestamptz,
  add column last_started_at timestamptz,
  add column completed_at timestamptz;

alter table public.processing_jobs
  add constraint processing_jobs_max_attempts_range
    check (max_attempts between 1 and 20),
  add constraint processing_jobs_locked_by_length
    check (
      locked_by is null
      or char_length(btrim(locked_by)) between 1 and 200
    ),
  add constraint processing_jobs_lease_state_consistent
    check (
      (
        status = 'processing'
        and locked_by is not null
        and lease_expires_at is not null
        and last_started_at is not null
        and completed_at is null
      )
      or (
        status = 'complete'
        and locked_by is null
        and lease_expires_at is null
        and completed_at is not null
      )
      or (
        status in ('queued', 'failed', 'paused')
        and locked_by is null
        and lease_expires_at is null
        and completed_at is null
      )
    );

alter table public.processing_jobs
  add constraint processing_jobs_id_owner_space_key
    unique (id, owner_user_id, space_id);

create table public.processing_runs (
  id uuid primary key default gen_random_uuid(),
  processing_job_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  attempt integer not null,
  processor_type text not null,
  provider text,
  model text,
  prompt_or_pipeline_version text,
  input_scope jsonb,
  status public.processing_state not null default 'processing',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  usage_json jsonb,
  estimated_cost numeric(12, 6),
  result_summary text,
  error_code text,
  error_detail text,
  constraint processing_runs_job_owner_space_fk
    foreign key (processing_job_id, owner_user_id, space_id)
    references public.processing_jobs(id, owner_user_id, space_id)
    on delete cascade,
  constraint processing_runs_space_owner_fk
    foreign key (space_id, owner_user_id)
    references public.spaces(id, owner_user_id),
  constraint processing_runs_attempt_positive check (attempt > 0),
  constraint processing_runs_processor_type_length
    check (char_length(btrim(processor_type)) between 1 and 100),
  constraint processing_runs_provider_length
    check (provider is null or char_length(btrim(provider)) between 1 and 100),
  constraint processing_runs_model_length
    check (model is null or char_length(btrim(model)) between 1 and 100),
  constraint processing_runs_prompt_version_length
    check (
      prompt_or_pipeline_version is null
      or char_length(btrim(prompt_or_pipeline_version)) between 1 and 200
    ),
  constraint processing_runs_input_scope_size
    check (
      input_scope is null
      or octet_length(input_scope::text) <= 65536
    ),
  constraint processing_runs_usage_json_size
    check (
      usage_json is null
      or octet_length(usage_json::text) <= 65536
    ),
  constraint processing_runs_result_summary_length
    check (
      result_summary is null
      or char_length(btrim(result_summary)) between 1 and 2000
    ),
  constraint processing_runs_error_code_length
    check (
      error_code is null
      or char_length(btrim(error_code)) between 1 and 100
    ),
  constraint processing_runs_error_detail_length
    check (
      error_detail is null
      or char_length(btrim(error_detail)) between 1 and 2000
    ),
  constraint processing_runs_status_times
    check (
      (
        status = 'processing'
        and finished_at is null
      )
      or (
        status in ('complete', 'failed', 'paused')
        and finished_at is not null
      )
    ),
  constraint processing_runs_job_attempt_key unique (processing_job_id, attempt),
  constraint processing_runs_id_job_owner_space_key
    unique (id, processing_job_id, owner_user_id, space_id)
);

create index processing_jobs_claim_idx
  on public.processing_jobs (status, next_attempt_at, created_at)
  where status = 'queued';

create index processing_jobs_lease_idx
  on public.processing_jobs (lease_expires_at)
  where status = 'processing';

create index processing_runs_job_attempt_idx
  on public.processing_runs (processing_job_id, attempt);

create index processing_runs_space_started_idx
  on public.processing_runs (space_id, started_at desc);

alter table public.processing_runs enable row level security;

revoke all on table public.processing_runs
from public, anon, authenticated;

grant select on table public.processing_runs to authenticated;

grant select, insert, update, delete on table public.processing_runs
to service_role;

create policy processing_runs_owner_member_select
on public.processing_runs
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = owner_user_id
  and exists (
    select 1
    from public.space_members as membership
    where membership.space_id = processing_runs.space_id
      and membership.user_id = (select auth.uid())
  )
);

create or replace function public.processing_job_backoff(
  p_attempt integer
) returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_attempt
    when 1 then interval '30 seconds'
    when 2 then interval '2 minutes'
    when 3 then interval '10 minutes'
    when 4 then interval '1 hour'
    else interval '1 hour'
  end;
$$;

create or replace function public.assert_processing_job_ancestry(
  p_job public.processing_jobs
) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.source_versions as version
    join public.source_items as item
      on item.id = version.source_item_id
     and item.owner_user_id = version.owner_user_id
    where version.id = p_job.source_version_id
      and version.owner_user_id = p_job.owner_user_id
      and item.space_id = p_job.space_id
      and item.owner_user_id = p_job.owner_user_id
  ) then
    raise exception 'processing job ancestry mismatch'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.claim_processing_jobs(
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
returns table (
  job_id uuid,
  run_id uuid,
  owner_user_id uuid,
  space_id uuid,
  source_version_id uuid,
  job_type text,
  attempt integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_run public.processing_runs;
  v_now timestamptz := clock_timestamp();
  v_lease_expires timestamptz;
  v_claimed integer := 0;
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception 'worker id is required'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'claim limit must be between 1 and 50'
      using errcode = '22023';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 10 and 3600'
      using errcode = '22023';
  end if;

  update public.processing_jobs as job
  set
    status = 'failed',
    locked_by = null,
    lease_expires_at = null,
    completed_at = null,
    updated_at = v_now
  where job.status = 'processing'
    and job.lease_expires_at <= v_now
    and job.attempt_count >= job.max_attempts;

  update public.processing_runs as run
  set
    status = 'failed',
    finished_at = v_now,
    error_code = coalesce(run.error_code, 'lease_expired'),
    error_detail = coalesce(run.error_detail, 'lease expired at max attempts')
  from public.processing_jobs as job
  where run.processing_job_id = job.id
    and run.status = 'processing'
    and job.status = 'failed'
    and job.lease_expires_at is null
    and job.updated_at = v_now;

  v_lease_expires := v_now + make_interval(secs => p_lease_seconds);

  for v_job in
    select job.*
    from public.processing_jobs as job
    where (
        (job.status = 'queued' and job.next_attempt_at <= v_now)
        or (
          job.status = 'processing'
          and job.lease_expires_at <= v_now
          and job.attempt_count < job.max_attempts
        )
      )
    order by job.next_attempt_at, job.created_at
    limit p_limit
    for update of job skip locked
  loop
    perform public.assert_processing_job_ancestry(v_job);

    if v_job.status = 'processing' then
      update public.processing_runs as run
      set
        status = 'failed',
        finished_at = v_now,
        error_code = coalesce(run.error_code, 'lease_expired'),
        error_detail = coalesce(run.error_detail, 'lease expired')
      where run.processing_job_id = v_job.id
        and run.status = 'processing';
    end if;

    update public.processing_jobs as job
    set
      status = 'processing',
      attempt_count = job.attempt_count + 1,
      locked_by = btrim(p_worker_id),
      lease_expires_at = v_lease_expires,
      last_started_at = v_now,
      completed_at = null,
      failure_reason = null,
      updated_at = v_now
    where job.id = v_job.id
    returning * into v_job;

    insert into public.processing_runs (
      processing_job_id,
      owner_user_id,
      space_id,
      attempt,
      processor_type,
      status,
      started_at
    )
    values (
      v_job.id,
      v_job.owner_user_id,
      v_job.space_id,
      v_job.attempt_count,
      v_job.job_type,
      'processing',
      v_now
    )
    returning * into v_run;

    job_id := v_job.id;
    run_id := v_run.id;
    owner_user_id := v_job.owner_user_id;
    space_id := v_job.space_id;
    source_version_id := v_job.source_version_id;
    job_type := v_job.job_type;
    attempt := v_run.attempt;
    lease_expires_at := v_job.lease_expires_at;
    return next;

    v_claimed := v_claimed + 1;
  end loop;
end;
$$;

create or replace function public.complete_processing_job(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_usage_json jsonb,
  p_result_summary text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_run public.processing_runs;
  v_now timestamptz := clock_timestamp();
  v_summary text;
begin
  select *
  into v_job
  from public.processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'processing job not found'
      using errcode = 'P0002';
  end if;

  select *
  into v_run
  from public.processing_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'processing run not found'
      using errcode = 'P0002';
  end if;

  if v_run.processing_job_id <> v_job.id
    or v_run.owner_user_id <> v_job.owner_user_id
    or v_run.space_id <> v_job.space_id
  then
    raise exception 'processing job ancestry mismatch'
      using errcode = '22023';
  end if;

  perform public.assert_processing_job_ancestry(v_job);

  if v_job.status <> 'processing'
    or v_job.locked_by is distinct from btrim(p_worker_id)
    or v_run.status <> 'processing'
  then
    raise exception 'processing job lease is not owned by this worker'
      using errcode = '42501';
  end if;

  v_summary := nullif(left(btrim(coalesce(p_result_summary, '')), 2000), '');

  update public.processing_runs
  set
    status = 'complete',
    finished_at = v_now,
    usage_json = p_usage_json,
    result_summary = v_summary,
    error_code = null,
    error_detail = null
  where id = v_run.id;

  update public.processing_jobs
  set
    status = 'complete',
    locked_by = null,
    lease_expires_at = null,
    completed_at = v_now,
    failure_reason = null,
    updated_at = v_now
  where id = v_job.id;
end;
$$;

create or replace function public.fail_processing_job(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_detail text,
  p_retryable boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_run public.processing_runs;
  v_now timestamptz := clock_timestamp();
  v_code text;
  v_detail text;
  v_retry boolean;
begin
  select *
  into v_job
  from public.processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'processing job not found'
      using errcode = 'P0002';
  end if;

  select *
  into v_run
  from public.processing_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'processing run not found'
      using errcode = 'P0002';
  end if;

  if v_run.processing_job_id <> v_job.id
    or v_run.owner_user_id <> v_job.owner_user_id
    or v_run.space_id <> v_job.space_id
  then
    raise exception 'processing job ancestry mismatch'
      using errcode = '22023';
  end if;

  perform public.assert_processing_job_ancestry(v_job);

  if v_job.status <> 'processing'
    or v_job.locked_by is distinct from btrim(p_worker_id)
    or v_run.status <> 'processing'
  then
    raise exception 'processing job lease is not owned by this worker'
      using errcode = '42501';
  end if;

  v_code := nullif(left(btrim(coalesce(p_error_code, '')), 100), '');
  v_detail := nullif(left(btrim(coalesce(p_error_detail, '')), 2000), '');
  v_retry := coalesce(p_retryable, false)
    and v_job.attempt_count < v_job.max_attempts;

  update public.processing_runs
  set
    status = 'failed',
    finished_at = v_now,
    error_code = coalesce(v_code, 'processing_failed'),
    error_detail = v_detail
  where id = v_run.id;

  if v_retry then
    update public.processing_jobs
    set
      status = 'queued',
      locked_by = null,
      lease_expires_at = null,
      completed_at = null,
      next_attempt_at = v_now + public.processing_job_backoff(v_job.attempt_count),
      failure_reason = coalesce(v_detail, v_code, 'processing_failed'),
      updated_at = v_now
    where id = v_job.id;
  else
    update public.processing_jobs
    set
      status = 'failed',
      locked_by = null,
      lease_expires_at = null,
      completed_at = null,
      failure_reason = coalesce(v_detail, v_code, 'processing_failed'),
      updated_at = v_now
    where id = v_job.id;
  end if;
end;
$$;

create or replace function public.heartbeat_processing_job(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_run public.processing_runs;
  v_now timestamptz := clock_timestamp();
begin
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 10 and 3600'
      using errcode = '22023';
  end if;

  select *
  into v_job
  from public.processing_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'processing job not found'
      using errcode = 'P0002';
  end if;

  select *
  into v_run
  from public.processing_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'processing run not found'
      using errcode = 'P0002';
  end if;

  if v_run.processing_job_id <> v_job.id
    or v_run.owner_user_id <> v_job.owner_user_id
    or v_run.space_id <> v_job.space_id
  then
    raise exception 'processing job ancestry mismatch'
      using errcode = '22023';
  end if;

  perform public.assert_processing_job_ancestry(v_job);

  if v_job.status <> 'processing'
    or v_job.locked_by is distinct from btrim(p_worker_id)
    or v_run.status <> 'processing'
  then
    raise exception 'processing job lease is not owned by this worker'
      using errcode = '42501';
  end if;

  update public.processing_jobs
  set
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    updated_at = v_now
  where id = v_job.id;
end;
$$;

revoke all on function public.processing_job_backoff(integer)
from public, anon, authenticated;
grant execute on function public.processing_job_backoff(integer)
to service_role;

revoke all on function public.assert_processing_job_ancestry(public.processing_jobs)
from public, anon, authenticated;
grant execute on function public.assert_processing_job_ancestry(public.processing_jobs)
to service_role;

revoke all on function public.claim_processing_jobs(text, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_processing_jobs(text, integer, integer)
to service_role;

revoke all on function public.complete_processing_job(uuid, uuid, text, jsonb, text)
from public, anon, authenticated;
grant execute on function public.complete_processing_job(uuid, uuid, text, jsonb, text)
to service_role;

revoke all on function public.fail_processing_job(uuid, uuid, text, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.fail_processing_job(uuid, uuid, text, text, text, boolean)
to service_role;

revoke all on function public.heartbeat_processing_job(uuid, uuid, text, integer)
from public, anon, authenticated;
grant execute on function public.heartbeat_processing_job(uuid, uuid, text, integer)
to service_role;
