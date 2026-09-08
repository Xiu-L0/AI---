begin;

select plan(2);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000f1', 'ocr-followup-owner@example.test');

update public.processing_jobs
set next_attempt_at = now() + interval '7 days'
where status in ('queued', 'processing');

insert into public.source_items (
  id,
  owner_user_id,
  source_platform,
  source_kind,
  external_ref,
  title,
  sensitivity,
  current_version
)
values (
  '10000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f1',
  'xiaohongshu',
  'social_post',
  'note-followup-ocr',
  'Followup fixture',
  'sensitive',
  1
);

insert into public.capture_sessions (
  id,
  owner_user_id,
  source_item_id,
  idempotency_key,
  source_platform,
  source_kind,
  scope,
  title,
  sensitivity,
  external_ref,
  status,
  expires_at,
  finalized_at
)
values (
  '20000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f1',
  '10000000-0000-0000-0000-0000000000f1',
  'ocr-followup-key-f1xxxx',
  'xiaohongshu',
  'social_post',
  'web_page',
  'Followup fixture',
  'sensitive',
  'note-followup-ocr',
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
  '30000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f1',
  '10000000-0000-0000-0000-0000000000f1',
  1,
  '20000000-0000-0000-0000-0000000000f1',
  'complete',
  '{}'::text[],
  'followup body',
  repeat('f', 64)
);

insert into public.processing_jobs (
  owner_user_id,
  source_version_id,
  job_type,
  next_attempt_at
)
values (
  '00000000-0000-0000-0000-0000000000f1',
  '30000000-0000-0000-0000-0000000000f1',
  'normalize_source',
  now() - interval '5 seconds'
);

set local role service_role;

create temporary table claimed_followup on commit drop as
select * from public.claim_processing_jobs('followup-worker', 1, 60);

select lives_ok(
  $$ select public.enqueue_followup_processing_job(
       (select job_id from claimed_followup),
       (select run_id from claimed_followup),
       'followup-worker',
       'ocr_assets'
     ) $$,
  'normalize_source may enqueue ocr_assets'
);

select public.fail_processing_job(
  (select job_id from claimed_followup),
  (select run_id from claimed_followup),
  'followup-worker',
  'paused_sensitive_external_ai',
  'Sensitive OCR is paused',
  false
);

select is(
  (
    select job.status = 'paused' and run.status = 'paused'
    from public.processing_jobs as job
    join public.processing_runs as run
      on run.processing_job_id = job.id
    where job.id = (select job_id from claimed_followup)
  ),
  true,
  'sensitive OCR failures pause instead of discarding the job'
);

select * from finish();
rollback;
