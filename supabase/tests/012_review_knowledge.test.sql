begin;

select plan(13);

create function pg_temp.seed_extract_source(
  owner_id uuid,
  item_id uuid,
  session_id uuid,
  version_id uuid,
  message_id uuid,
  block_id uuid,
  external_id text,
  body text
) returns uuid
language plpgsql
as $$
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
    'Review fixture ' || item_id::text,
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
    'review-key-' || session_id::text,
    'manual_text',
    'selection',
    'Review fixture',
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
    body,
    repeat(substr(replace(version_id::text, '-', ''), 1, 1), 64)
  );

  insert into public.source_messages (
    id,
    owner_user_id,
    source_item_id,
    source_version_id,
    external_message_id,
    role,
    body,
    ordinal
  )
  values (
    message_id,
    owner_id,
    item_id,
    version_id,
    external_id,
    'user',
    body,
    0
  );

  insert into public.source_blocks (
    id,
    owner_user_id,
    space_id,
    source_item_id,
    source_version_id,
    source_message_id,
    block_type,
    ordinal,
    locator_key,
    locator_json,
    content_hash,
    text_content
  )
  select
    block_id,
    item.owner_user_id,
    item.space_id,
    item.id,
    version_id,
    message_id,
    'message',
    0,
    'message:' || external_id || '/body',
    jsonb_build_object('role', 'user', 'ordinal', 0),
    repeat(substr(replace(block_id::text, '-', ''), 1, 1), 64),
    body
  from public.source_items as item
  where item.id = item_id;

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
    'extract_knowledge',
    now() - interval '10 seconds',
    now() - interval '10 seconds'
  );

  return version_id;
end;
$$;

create function pg_temp.valid_payload(
  version_id uuid,
  locator_key text,
  extraction_key text,
  title text
) returns jsonb
language sql
as $$
  select jsonb_build_object(
    'source_version_id', version_id,
    'provider', 'deepseek',
    'model', 'deepseek-v4-flash',
    'input_scope', jsonb_build_object('mode', 'all', 'locator_keys', jsonb_build_array(locator_key)),
    'drafts', jsonb_build_array(
      jsonb_build_object(
        'extraction_key', extraction_key,
        'knowledge_type', 'concept',
        'title', title,
        'l0_summary', 'A cited draft summary',
        'l1_content', 'A cited draft body',
        'l2_content', 'A cited draft detail',
        'conditions', jsonb_build_array('ChatGPT text only'),
        'limitations', jsonb_build_array('No invented locators'),
        'confidence', 0.72,
        'evidence_mode', 'cited',
        'citations', jsonb_build_array(
          jsonb_build_object(
            'locator_key', locator_key,
            'claim_path', 'l0_summary',
            'quote_excerpt', 'A cited draft summary'
          )
        )
      )
    )
  );
$$;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000d1', 'review-owner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'review-owner-b@example.test');

update public.processing_jobs
set
  next_attempt_at = now() + interval '7 days',
  lease_expires_at = case
    when status = 'processing' then now() + interval '7 days'
    else lease_expires_at
  end
where status in ('queued', 'processing');

select pg_temp.seed_extract_source(
  '00000000-0000-0000-0000-0000000000d1',
  '10000000-0000-0000-0000-0000000000d1',
  '20000000-0000-0000-0000-0000000000d1',
  '30000000-0000-0000-0000-0000000000d1',
  '40000000-0000-0000-0000-0000000000d1',
  '60000000-0000-0000-0000-0000000000d1',
  'msg-confirm',
  'confirm review message'
);
select pg_temp.seed_extract_source(
  '00000000-0000-0000-0000-0000000000d1',
  '10000000-0000-0000-0000-0000000000d3',
  '20000000-0000-0000-0000-0000000000d3',
  '30000000-0000-0000-0000-0000000000d3',
  '40000000-0000-0000-0000-0000000000d3',
  '60000000-0000-0000-0000-0000000000d3',
  'msg-reject',
  'reject review message'
);
select pg_temp.seed_extract_source(
  '00000000-0000-0000-0000-0000000000d1',
  '10000000-0000-0000-0000-0000000000d4',
  '20000000-0000-0000-0000-0000000000d4',
  '30000000-0000-0000-0000-0000000000d4',
  '40000000-0000-0000-0000-0000000000d4',
  '60000000-0000-0000-0000-0000000000d4',
  'msg-uncited',
  'uncited confirm message'
);

set local role service_role;

create temporary table claimed_review on commit drop as
select *
from public.claim_processing_jobs('review-worker', 3, 60);

create temporary table persist_confirm on commit drop as
select public.persist_knowledge_extraction(
  (select job_id from claimed_review where source_version_id = '30000000-0000-0000-0000-0000000000d1'),
  (select run_id from claimed_review where source_version_id = '30000000-0000-0000-0000-0000000000d1'),
  'review-worker',
  'knowledge-extraction.2026-08-11.v1',
  pg_temp.valid_payload(
    '30000000-0000-0000-0000-0000000000d1',
    'message:msg-confirm/body',
    repeat('a', 64),
    'AI confirm draft'
  )
) as payload;

create temporary table persist_reject on commit drop as
select public.persist_knowledge_extraction(
  (select job_id from claimed_review where source_version_id = '30000000-0000-0000-0000-0000000000d3'),
  (select run_id from claimed_review where source_version_id = '30000000-0000-0000-0000-0000000000d3'),
  'review-worker',
  'knowledge-extraction.2026-08-11.v1',
  pg_temp.valid_payload(
    '30000000-0000-0000-0000-0000000000d3',
    'message:msg-reject/body',
    repeat('c', 64),
    'AI reject draft'
  )
) as payload;

create temporary table persist_uncited on commit drop as
select public.persist_knowledge_extraction(
  (select job_id from claimed_review where source_version_id = '30000000-0000-0000-0000-0000000000d4'),
  (select run_id from claimed_review where source_version_id = '30000000-0000-0000-0000-0000000000d4'),
  'review-worker',
  'knowledge-extraction.2026-08-11.v1',
  pg_temp.valid_payload(
    '30000000-0000-0000-0000-0000000000d4',
    'message:msg-uncited/body',
    repeat('d', 64),
    'AI uncited draft'
  )
) as payload;

reset role;

create temporary table review_ids on commit drop as
select
  (select (persist_confirm.payload -> 'items' -> 0 ->> 'knowledge_item_id')::uuid from persist_confirm) as confirm_id,
  (select (persist_reject.payload -> 'items' -> 0 ->> 'knowledge_item_id')::uuid from persist_reject) as reject_id,
  (select (persist_uncited.payload -> 'items' -> 0 ->> 'knowledge_item_id')::uuid from persist_uncited) as uncited_id;

grant select on review_ids to authenticated, service_role;

insert into public.knowledge_items (
  id,
  owner_user_id,
  space_id,
  created_by_user_id,
  knowledge_type,
  title,
  l0_summary,
  l1_content,
  confidence,
  status,
  evidence_mode
)
select
  '80000000-0000-0000-0000-0000000000d5',
  item.owner_user_id,
  item.space_id,
  item.owner_user_id,
  'opinion',
  'Personal inference',
  'This is my inference',
  'L1',
  0.500,
  'pending_review',
  'personal_inference'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-0000000000d1';

insert into public.knowledge_versions (
  owner_user_id,
  space_id,
  knowledge_item_id,
  version,
  snapshot_json,
  change_origin
)
select
  item.owner_user_id,
  item.space_id,
  '80000000-0000-0000-0000-0000000000d5',
  1,
  '{"title":"Personal inference"}'::jsonb,
  'ai'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-0000000000d1';

insert into public.review_tasks (
  owner_user_id,
  space_id,
  knowledge_item_id,
  task_type,
  status,
  priority,
  reason
)
select
  item.owner_user_id,
  item.space_id,
  '80000000-0000-0000-0000-0000000000d5',
  'knowledge_draft',
  'open',
  10,
  'Inference needs review'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-0000000000d1';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}',
  true
);

select lives_ok(
  format(
    $$
      select public.review_knowledge_item(
        %L::uuid,
        1,
        'confirm',
        '{"title":"Human confirmed title","l0_summary":"Edited L0","l1_content":"Edited L1","l2_content":"Edited L2"}'::jsonb,
        array[
          (
            select citation.id
            from public.citations as citation
            where citation.knowledge_item_id = %L::uuid
          )
        ],
        array['title', 'l0_summary'],
        null
      )
    $$,
    (select confirm_id::text from review_ids),
    (select confirm_id::text from review_ids)
  ),
  'owner can confirm an edited cited draft'
);

select is(
  (
    select jsonb_build_object(
      'title', item.title,
      'l0', item.l0_summary,
      'l1', item.l1_content,
      'l2', item.l2_content,
      'status', item.status,
      'locked', item.human_locked_fields,
      'version', item.current_version
    )
    from public.knowledge_items as item
    where item.id = (
      select confirm_id from review_ids
    )
  ),
  jsonb_build_object(
    'title', 'Human confirmed title',
    'l0', 'Edited L0',
    'l1', 'Edited L1',
    'l2', 'Edited L2',
    'status', 'confirmed',
    'locked', array['title', 'l0_summary'],
    'version', 2
  ),
  'confirm writes edited fields, locked fields and confirmed status'
);

select is(
  (
    select count(*)::integer
    from public.citations as citation
    where citation.knowledge_item_id = (
      select confirm_id from review_ids
    )
      and citation.review_status = 'approved'
  )
  + (
    select count(*)::integer
    from public.knowledge_versions as version
    where version.knowledge_item_id = (
      select confirm_id from review_ids
    )
      and version.version = 2
      and version.change_origin = 'user'
      and version.changed_by_user_id = '00000000-0000-0000-0000-0000000000d1'
  )
  + (
    select count(*)::integer
    from public.review_tasks as task
    where task.knowledge_item_id = (
      select confirm_id from review_ids
    )
      and task.status = 'completed'
      and task.resolved_by_user_id = '00000000-0000-0000-0000-0000000000d1'
  ),
  3,
  'confirm approves citations, appends one version and resolves the review task'
);

select lives_ok(
  format(
    $$
      select public.review_knowledge_item(
        %L::uuid,
        1,
        'reject',
        '{}'::jsonb,
        '{}'::uuid[],
        '{}'::text[],
        'Not supported by the source'
      )
    $$,
    (select reject_id::text from review_ids)
  ),
  'owner can reject a draft with a reason'
);

select is(
  (
    select item.status
    from public.knowledge_items as item
    where item.id = (
      select reject_id from review_ids
    )
  ),
  'rejected',
  'reject marks the item rejected'
);

select is(
  (
    select count(*)::integer
    from public.knowledge_versions as version
    where version.knowledge_item_id = (
      select reject_id from review_ids
    )
      and version.change_origin = 'user'
  )
  + (
    select count(*)::integer
    from public.review_tasks as task
    where task.knowledge_item_id = (
      select reject_id from review_ids
    )
      and task.status = 'completed'
  ),
  2,
  'reject appends one user version and resolves the open review task'
);

select throws_like(
  format(
    $$
      select public.review_knowledge_item(
        %L::uuid,
        1,
        'confirm',
        '{}'::jsonb,
        '{}'::uuid[],
        '{}'::text[],
        null
      )
    $$,
    (select confirm_id::text from review_ids)
  ),
  '%version%',
  'a stale expectedVersion is rejected'
);

select throws_like(
  format(
    $$
      select public.review_knowledge_item(
        %L::uuid,
        1,
        'confirm',
        '{}'::jsonb,
        '{}'::uuid[],
        '{}'::text[],
        null
      )
    $$,
    (select uncited_id::text from review_ids)
  ),
  '%approved citation%',
  'confirm fails without an approved citation unless it is a personal inference'
);

select lives_ok(
  $$
    select public.review_knowledge_item(
      '80000000-0000-0000-0000-0000000000d5',
      1,
      'confirm',
      '{}'::jsonb,
      '{}'::uuid[],
      '{}'::text[],
      null
    )
  $$,
  'personal inference opinions can be confirmed without citations'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}',
  true
);

select throws_like(
  format(
    $$
      select public.review_knowledge_item(
        %L::uuid,
        2,
        'confirm',
        '{}'::jsonb,
        '{}'::uuid[],
        '{}'::text[],
        null
      )
    $$,
    (select confirm_id::text from review_ids)
  ),
  '%not owned%',
  'owner B cannot review owner A knowledge'
);

reset role;
set local role service_role;

select public.persist_knowledge_extraction(
  (select job_id from claimed_review where source_version_id = '30000000-0000-0000-0000-0000000000d1'),
  (select run_id from claimed_review where source_version_id = '30000000-0000-0000-0000-0000000000d1'),
  'review-worker',
  'knowledge-extraction.2026-08-11.v1',
  pg_temp.valid_payload(
    '30000000-0000-0000-0000-0000000000d1',
    'message:msg-confirm/body',
    repeat('a', 64),
    'AI must not overwrite confirmed knowledge'
  )
);

select is(
  (
    select jsonb_build_object('title', item.title, 'status', item.status, 'version', item.current_version)
    from public.knowledge_items as item
    where item.id = (
      select confirm_id from review_ids
    )
  ),
  jsonb_build_object(
    'title', 'Human confirmed title',
    'status', 'confirmed',
    'version', 2
  ),
  'later AI persistence cannot overwrite locked fields or confirmed status'
);

reset role;
set local role anon;

select throws_like(
  $$
    select public.review_knowledge_item(
      '80000000-0000-0000-0000-0000000000d5',
      1,
      'confirm',
      '{}'::jsonb,
      '{}'::uuid[],
      '{}'::text[],
      null
    )
  $$,
  '%permission denied%',
  'anon cannot review knowledge'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.knowledge_versions
    where knowledge_item_id in (
      (select confirm_id from review_ids),
      (select reject_id from review_ids)
    )
      and change_origin = 'user'
  ),
  2,
  'each review decision appends exactly one immutable user version'
);

select * from finish();

rollback;
