create or replace function public.enqueue_followup_processing_job(
  p_job_id uuid,
  p_run_id uuid,
  p_worker_id text,
  p_job_type text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_type text;
  v_job public.processing_jobs;
begin
  if p_job_type not in ('build_source_blocks', 'extract_knowledge', 'ocr_assets') then
    raise exception 'unsupported followup job type'
      using errcode = '22023';
  end if;

  select job.job_type
  into v_current_type
  from public.processing_jobs as job
  where job.id = p_job_id;

  if v_current_type is null then
    raise exception 'processing job not found'
      using errcode = 'P0002';
  end if;

  if p_job_type = 'build_source_blocks'
    and v_current_type not in ('normalize_source', 'ocr_assets')
  then
    raise exception 'unsupported followup job type'
      using errcode = '22023';
  end if;

  if p_job_type = 'ocr_assets'
    and v_current_type is distinct from 'normalize_source'
  then
    raise exception 'unsupported followup job type'
      using errcode = '22023';
  end if;

  if p_job_type = 'extract_knowledge'
    and v_current_type is distinct from 'normalize_source'
  then
    raise exception 'unsupported followup job type'
      using errcode = '22023';
  end if;

  v_job := public.lock_claimed_processing_job(
    p_job_id,
    p_run_id,
    p_worker_id,
    v_current_type
  );

  insert into public.processing_jobs (
    owner_user_id,
    space_id,
    source_version_id,
    job_type
  )
  values (
    v_job.owner_user_id,
    v_job.space_id,
    v_job.source_version_id,
    p_job_type
  )
  on conflict (source_version_id, job_type) do nothing;
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
  v_paused boolean;
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
  v_paused := v_code = 'paused_sensitive_external_ai';
  v_retry := (not v_paused)
    and coalesce(p_retryable, false)
    and v_job.attempt_count < v_job.max_attempts;

  update public.processing_runs
  set
    status = case
      when v_paused then 'paused'::public.processing_state
      else 'failed'::public.processing_state
    end,
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
      status = case
        when v_paused then 'paused'::public.processing_state
        else 'failed'::public.processing_state
      end,
      locked_by = null,
      lease_expires_at = null,
      completed_at = null,
      failure_reason = coalesce(v_detail, v_code, 'processing_failed'),
      updated_at = v_now
    where id = v_job.id;
  end if;
end;
$$;

revoke all on function public.enqueue_followup_processing_job(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.enqueue_followup_processing_job(uuid, uuid, text, text)
to service_role;

revoke all on function public.fail_processing_job(uuid, uuid, text, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.fail_processing_job(uuid, uuid, text, text, text, boolean)
to service_role;
