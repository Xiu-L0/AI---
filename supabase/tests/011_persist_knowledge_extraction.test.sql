begin;

select plan(16);

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
    'Extract fixture ' || item_id::text,
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
    'extract-key-' || session_id::text,
    'manual_text',
    'selection',
    'Extract fixture',
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
    'input_scope', jsonb_build_object(
      'mode', 'all',
      'start_ordinal', 0,
      'end_ordinal', 0,
      'block_count', 1,
      'character_count', 24,
      'locator_keys', jsonb_build_array(locator_key)
    ),
    'drafts', jsonb_build_array(
      jsonb_build_object(
        'extraction_key', extraction_key,
        'knowledge_type', 'concept',
        'title', title,
        'l0_summary', 'A cited draft summary',
        'l1_content', 'A cited draft body',
        'l2_content', '',
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
  ('00000000-0000-0000-0000-0000000000c1', 'extract-owner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'extract-owner-b@example.test');

update public.processing_jobs
set
  next_attempt_at = now() + interval '7 days',
  lease_expires_at = case
    when status = 'processing' then now() + interval '7 days'
    else lease_expires_at
  end
where status in ('queued', 'processing');

select pg_temp.seed_extract_source(
  '00000000-0000-0000-0000-0000000000c1',
  '10000000-0000-0000-0000-0000000000c1',
  '20000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-0000000000c1',
  '40000000-0000-0000-0000-0000000000c1',
  '60000000-0000-0000-0000-0000000000c1',
  'msg-a',
  'owner a extract message'
);

select pg_temp.seed_extract_source(
  '00000000-0000-0000-0000-0000000000c2',
  '10000000-0000-0000-0000-0000000000c2',
  '20000000-0000-0000-0000-0000000000c2',
  '30000000-0000-0000-0000-0000000000c2',
  '40000000-0000-0000-0000-0000000000c2',
  '60000000-0000-0000-0000-0000000000c2',
  'msg-b',
  'owner b extract message'
);

select pg_temp.seed_extract_source(
  '00000000-0000-0000-0000-0000000000c1',
  '10000000-0000-0000-0000-0000000000c3',
  '20000000-0000-0000-0000-0000000000c3',
  '30000000-0000-0000-0000-0000000000c3',
  '40000000-0000-0000-0000-0000000000c3',
  '60000000-0000-0000-0000-0000000000c3',
  'msg-c',
  'owner a invalid locator source'
);

select pg_temp.seed_extract_source(
  '00000000-0000-0000-0000-0000000000c1',
  '10000000-0000-0000-0000-0000000000c4',
  '20000000-0000-0000-0000-0000000000c4',
  '30000000-0000-0000-0000-0000000000c4',
  '40000000-0000-0000-0000-0000000000c4',
  '60000000-0000-0000-0000-0000000000c4',
  'msg-d',
  'owner a wrong version source'
);

set local role service_role;

create temporary table claimed_extract on commit drop as
select *
from public.claim_processing_jobs('extract-worker', 4, 60);

select is(
  (select count(*)::integer from claimed_extract),
  4,
  'extract fixtures are claimed for persistence tests'
);

create temporary table persist_valid on commit drop as
select public.persist_knowledge_extraction(
  (
    select job_id
    from claimed_extract
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  (
    select run_id
    from claimed_extract
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  'extract-worker',
  'knowledge-extraction.2026-08-11.v1',
  pg_temp.valid_payload(
    '30000000-0000-0000-0000-0000000000c1',
    'message:msg-a/body',
    repeat('a', 64),
    'Stable cited concept'
  )
) as payload;

select is(
  (
    select count(*)::integer
    from public.knowledge_items
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  1,
  'valid drafts create one knowledge item'
);

select is(
  (
    select count(*)::integer
    from public.knowledge_versions as version
    join public.knowledge_items as item
      on item.id = version.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
      and version.version = 1
      and version.change_origin = 'ai'
      and version.processor_run_id = (
        select run_id
        from claimed_extract
        where source_version_id = '30000000-0000-0000-0000-0000000000c1'
      )
  )
  + (
    select count(*)::integer
    from public.citations as citation
    join public.knowledge_items as item
      on item.id = citation.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
      and citation.origin_type = 'ai'
      and citation.review_status = 'pending'
      and citation.source_block_id = '60000000-0000-0000-0000-0000000000c1'
  )
  + (
    select count(*)::integer
    from public.review_tasks as task
    join public.knowledge_items as item
      on item.id = task.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
      and task.task_type = 'knowledge_draft'
      and task.status = 'open'
  ),
  3,
  'valid drafts create matching version, citation and review rows'
);

select is(
  (
    select run.prompt_or_pipeline_version
    from public.processing_runs as run
    where run.id = (
      select run_id
      from claimed_extract
      where source_version_id = '30000000-0000-0000-0000-0000000000c1'
    )
  ),
  'knowledge-extraction.2026-08-11.v1',
  'processor run ancestry records the prompt version'
);

select is(
  (
    select count(*)::integer
    from public.processing_jobs
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
      and job_type in ('suggest_topics', 'suggest_relations', 'generate_embeddings')
  ),
  0,
  'persist does not enqueue graph or vector jobs'
);

create temporary table persist_replay on commit drop as
select public.persist_knowledge_extraction(
  (
    select job_id
    from claimed_extract
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  (
    select run_id
    from claimed_extract
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  'extract-worker',
  'knowledge-extraction.2026-08-11.v1',
  pg_temp.valid_payload(
    '30000000-0000-0000-0000-0000000000c1',
    'message:msg-a/body',
    repeat('a', 64),
    'Changed title must not fork the draft'
  )
) as payload;

select is(
  persist_replay.payload -> 'items' -> 0 ->> 'knowledge_item_id',
  persist_valid.payload -> 'items' -> 0 ->> 'knowledge_item_id',
  'replay returns the original draft id'
)
from persist_replay, persist_valid;

select is(
  (
    select count(*)::integer
    from public.knowledge_items
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  )
  + (
    select count(*)::integer
    from public.knowledge_versions as version
    join public.knowledge_items as item
      on item.id = version.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
  )
  + (
    select count(*)::integer
    from public.citations as citation
    join public.knowledge_items as item
      on item.id = citation.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
  )
  + (
    select count(*)::integer
    from public.review_tasks as task
    join public.knowledge_items as item
      on item.id = task.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  4,
  'replay does not duplicate drafts, versions, citations or review tasks'
);

select throws_like(
  $$
    select public.persist_knowledge_extraction(
      (
        select job_id
        from claimed_extract
        where source_version_id = '30000000-0000-0000-0000-0000000000c3'
      ),
      (
        select run_id
        from claimed_extract
        where source_version_id = '30000000-0000-0000-0000-0000000000c3'
      ),
      'extract-worker',
      'knowledge-extraction.2026-08-11.v1',
      pg_temp.valid_payload(
        '30000000-0000-0000-0000-0000000000c3',
        'message:missing/body',
        repeat('c', 64),
        'Invalid locator draft'
      )
    )
  $$,
  '%locator%',
  'an invalid locator rejects the whole payload'
);

select is(
  (
    select count(*)::integer
    from public.knowledge_items
    where source_version_id = '30000000-0000-0000-0000-0000000000c3'
  )
  + (
    select count(*)::integer
    from public.knowledge_versions as version
    join public.knowledge_items as item
      on item.id = version.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c3'
  )
  + (
    select count(*)::integer
    from public.citations as citation
    join public.knowledge_items as item
      on item.id = citation.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c3'
  )
  + (
    select count(*)::integer
    from public.review_tasks as task
    join public.knowledge_items as item
      on item.id = task.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c3'
  ),
  0,
  'an invalid locator writes zero rows'
);

select throws_like(
  $$
    select public.persist_knowledge_extraction(
      (
        select job_id
        from claimed_extract
        where source_version_id = '30000000-0000-0000-0000-0000000000c4'
      ),
      (
        select run_id
        from claimed_extract
        where source_version_id = '30000000-0000-0000-0000-0000000000c4'
      ),
      'extract-worker',
      'knowledge-extraction.2026-08-11.v1',
      pg_temp.valid_payload(
        '30000000-0000-0000-0000-0000000000c2',
        'message:msg-b/body',
        repeat('d', 64),
        'Wrong version draft'
      )
    )
  $$,
  '%source version%',
  'a payload for another source version is rejected'
);

select is(
  (
    select count(*)::integer
    from public.knowledge_items
    where source_version_id in (
      '30000000-0000-0000-0000-0000000000c2',
      '30000000-0000-0000-0000-0000000000c4'
    )
  ),
  0,
  'wrong owner or source version writes zero rows'
);

update public.citations
set review_status = 'approved'
where knowledge_item_id = (
  select (persist_valid.payload -> 'items' -> 0 ->> 'knowledge_item_id')::uuid
  from persist_valid
);

update public.review_tasks
set
  status = 'completed',
  resolved_at = now(),
  resolved_by_user_id = '00000000-0000-0000-0000-0000000000c1'
where knowledge_item_id = (
  select (persist_valid.payload -> 'items' -> 0 ->> 'knowledge_item_id')::uuid
  from persist_valid
)
  and status = 'open';

update public.knowledge_items
set
  title = 'Human confirmed title',
  human_locked_fields = array['title'],
  status = 'confirmed',
  current_version = 2
where id = (
  select (persist_valid.payload -> 'items' -> 0 ->> 'knowledge_item_id')::uuid
  from persist_valid
);

insert into public.knowledge_versions (
  owner_user_id,
  space_id,
  knowledge_item_id,
  version,
  snapshot_json,
  change_origin,
  changed_by_user_id
)
select
  item.owner_user_id,
  item.space_id,
  item.id,
  2,
  jsonb_build_object('title', 'Human confirmed title'),
  'user',
  item.owner_user_id
from public.knowledge_items as item
where item.id = (
  select (persist_valid.payload -> 'items' -> 0 ->> 'knowledge_item_id')::uuid
  from persist_valid
);

select public.persist_knowledge_extraction(
  (
    select job_id
    from claimed_extract
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  (
    select run_id
    from claimed_extract
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  'extract-worker',
  'knowledge-extraction.2026-08-11.v1',
  pg_temp.valid_payload(
    '30000000-0000-0000-0000-0000000000c1',
    'message:msg-a/body',
    repeat('a', 64),
    'AI must not overwrite the human title'
  )
);

select is(
  (
    select item.title
    from public.knowledge_items as item
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  'Human confirmed title',
  'reprocess leaves a user-confirmed item untouched'
);

select is(
  (
    select count(*)::integer
    from public.knowledge_versions as version
    join public.knowledge_items as item
      on item.id = version.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  2,
  'reprocess does not append a version onto confirmed knowledge'
);

select is(
  (
    select count(*)::integer
    from public.review_tasks as task
    join public.knowledge_items as item
      on item.id = task.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
      and task.task_type = 'conflict'
      and task.status = 'open'
  ),
  1,
  'reprocess creates at most one suggestion review task'
);

select public.persist_knowledge_extraction(
  (
    select job_id
    from claimed_extract
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  (
    select run_id
    from claimed_extract
    where source_version_id = '30000000-0000-0000-0000-0000000000c1'
  ),
  'extract-worker',
  'knowledge-extraction.2026-08-11.v1',
  pg_temp.valid_payload(
    '30000000-0000-0000-0000-0000000000c1',
    'message:msg-a/body',
    repeat('a', 64),
    'AI must not overwrite the human title'
  )
);

select is(
  (
    select count(*)::integer
    from public.review_tasks as task
    join public.knowledge_items as item
      on item.id = task.knowledge_item_id
    where item.source_version_id = '30000000-0000-0000-0000-0000000000c1'
      and task.task_type = 'conflict'
  ),
  1,
  'a second reprocess does not duplicate the suggestion review task'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}',
  true
);

select throws_like(
  $$
    select public.persist_knowledge_extraction(
      '30000000-0000-0000-0000-0000000000c1',
      '30000000-0000-0000-0000-0000000000c1',
      'user',
      'knowledge-extraction.2026-08-11.v1',
      '{}'::jsonb
    )
  $$,
  '%permission denied%',
  'authenticated users cannot persist knowledge extraction'
);

reset role;

select * from finish();

rollback;
