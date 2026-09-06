begin;

select plan(11);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000091', 'knowledge-owner-a@example.test'),
  ('00000000-0000-0000-0000-000000000092', 'knowledge-owner-b@example.test');

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
    '10000000-0000-0000-0000-000000000091',
    '00000000-0000-0000-0000-000000000091',
    'manual_text',
    'Owner A knowledge source',
    'normal',
    1
  ),
  (
    '10000000-0000-0000-0000-000000000092',
    '00000000-0000-0000-0000-000000000092',
    'manual_text',
    'Owner B knowledge source',
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
    '20000000-0000-0000-0000-000000000091',
    '00000000-0000-0000-0000-000000000091',
    '10000000-0000-0000-0000-000000000091',
    'knowledge-key-91xx',
    'manual_text',
    'selection',
    'Owner A knowledge source',
    'normal',
    'finalized',
    now() + interval '2 hours',
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000092',
    '00000000-0000-0000-0000-000000000092',
    '10000000-0000-0000-0000-000000000092',
    'knowledge-key-92xx',
    'manual_text',
    'selection',
    'Owner B knowledge source',
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
    '30000000-0000-0000-0000-000000000091',
    '00000000-0000-0000-0000-000000000091',
    '10000000-0000-0000-0000-000000000091',
    1,
    '20000000-0000-0000-0000-000000000091',
    'complete',
    '{}'::text[],
    'owner a knowledge',
    repeat('a', 64)
  ),
  (
    '30000000-0000-0000-0000-000000000092',
    '00000000-0000-0000-0000-000000000092',
    '10000000-0000-0000-0000-000000000092',
    1,
    '20000000-0000-0000-0000-000000000092',
    'complete',
    '{}'::text[],
    'owner b knowledge',
    repeat('b', 64)
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
values
  (
    '40000000-0000-0000-0000-000000000091',
    '00000000-0000-0000-0000-000000000091',
    '10000000-0000-0000-0000-000000000091',
    '30000000-0000-0000-0000-000000000091',
    'message-a',
    'user',
    'owner a knowledge message',
    0
  ),
  (
    '40000000-0000-0000-0000-000000000092',
    '00000000-0000-0000-0000-000000000092',
    '10000000-0000-0000-0000-000000000092',
    '30000000-0000-0000-0000-000000000092',
    'message-b',
    'user',
    'owner b knowledge message',
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
  '60000000-0000-0000-0000-000000000091',
  item.owner_user_id,
  item.space_id,
  item.id,
  '30000000-0000-0000-0000-000000000091',
  '40000000-0000-0000-0000-000000000091',
  'message',
  0,
  'message:0/body',
  '{"messageOrdinal":0}'::jsonb,
  repeat('e', 64),
  'owner a knowledge message'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000091';

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
  '60000000-0000-0000-0000-000000000092',
  item.owner_user_id,
  item.space_id,
  item.id,
  '30000000-0000-0000-0000-000000000092',
  '40000000-0000-0000-0000-000000000092',
  'message',
  0,
  'message:0/body',
  '{"messageOrdinal":0}'::jsonb,
  repeat('f', 64),
  'owner b knowledge message'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000092';

insert into public.knowledge_items (
  id,
  owner_user_id,
  space_id,
  created_by_user_id,
  knowledge_type,
  title,
  l0_summary,
  l1_content,
  l2_content,
  confidence,
  status,
  evidence_mode
)
select
  '80000000-0000-0000-0000-000000000091',
  item.owner_user_id,
  item.space_id,
  item.owner_user_id,
  'concept',
  'Draft concept',
  'A one-line summary',
  'L1 explanation',
  'L2 explanation',
  0.640,
  'ai_draft',
  'cited'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000091';

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
  '80000000-0000-0000-0000-000000000091',
  1,
  '{"title":"Draft concept"}'::jsonb,
  'ai'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000091';

insert into public.citations (
  owner_user_id,
  space_id,
  knowledge_item_id,
  source_block_id,
  claim_path,
  quote_excerpt,
  origin_type,
  review_status
)
select
  item.owner_user_id,
  item.space_id,
  '80000000-0000-0000-0000-000000000091',
  '60000000-0000-0000-0000-000000000091',
  'l0_summary',
  'owner a knowledge message',
  'ai',
  'pending'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000091';

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
  '80000000-0000-0000-0000-000000000091',
  'knowledge_draft',
  'open',
  10,
  'AI draft needs review'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000091';

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
  '80000000-0000-0000-0000-000000000092',
  item.owner_user_id,
  item.space_id,
  item.owner_user_id,
  'concept',
  'Owner B draft',
  'Hidden from A',
  'L1',
  0.300,
  'ai_draft',
  'cited'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000092';

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
  '80000000-0000-0000-0000-000000000092',
  'knowledge_draft',
  'open',
  20,
  'Owner B review'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000092';

select lives_ok(
  $$set constraints all immediate$$,
  'valid AI draft, version, citation and review task can be inserted together'
);

select throws_like(
  $$
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
      '80000000-0000-0000-0000-000000000093',
      item.owner_user_id,
      item.space_id,
      item.owner_user_id,
      'fact',
      'Uncited fact',
      'Needs a citation',
      'L1',
      0.800,
      'confirmed',
      'cited'
    from public.source_items as item
    where item.id = '10000000-0000-0000-0000-000000000091';
    set constraints all immediate;
  $$,
  '%approved citation%',
  'confirmed knowledge without an approved citation fails'
);

select lives_ok(
  $$
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
      '80000000-0000-0000-0000-000000000094',
      item.owner_user_id,
      item.space_id,
      item.owner_user_id,
      'opinion',
      'Personal viewpoint',
      'This is my inference',
      'L1',
      0.500,
      'confirmed',
      'personal_inference'
    from public.source_items as item
    where item.id = '10000000-0000-0000-0000-000000000091';
    set constraints all immediate;
  $$,
  'personal inference opinions can be confirmed without citations'
);

select throws_like(
  $$
    insert into public.knowledge_items (
      owner_user_id,
      space_id,
      created_by_user_id,
      knowledge_type,
      title,
      l0_summary,
      l1_content,
      human_locked_fields,
      confidence,
      status,
      evidence_mode
    )
    select
      item.owner_user_id,
      item.space_id,
      item.owner_user_id,
      'concept',
      'Bad lock',
      'Summary',
      'L1',
      array['title', 'title', 'not_a_field'],
      0.400,
      'ai_draft',
      'cited'
    from public.source_items as item
    where item.id = '10000000-0000-0000-0000-000000000091';
  $$,
  '%knowledge_items_locked_fields_valid%',
  'human_locked_fields must be unique editable field names'
);

select throws_like(
  $$
    insert into public.knowledge_items (
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
      item.owner_user_id,
      item.space_id,
      item.owner_user_id,
      'concept',
      'Bad confidence',
      'Summary',
      'L1',
      1.200,
      'ai_draft',
      'cited'
    from public.source_items as item
    where item.id = '10000000-0000-0000-0000-000000000091';
  $$,
  '%knowledge_items_confidence_range%',
  'confidence must stay within 0 and 1'
);

select throws_like(
  $$
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
      '80000000-0000-0000-0000-000000000091',
      3,
      '{"title":"skip"}'::jsonb,
      'ai'
    from public.source_items as item
    where item.id = '10000000-0000-0000-0000-000000000091';
  $$,
  '%strictly sequential%',
  'knowledge versions must be strictly numbered'
);

select throws_like(
  $$
    update public.knowledge_versions
    set snapshot_json = '{"mutated":true}'::jsonb
    where knowledge_item_id = '80000000-0000-0000-0000-000000000091';
  $$,
  '%immutable%',
  'knowledge versions cannot be updated'
);

select throws_like(
  $$
    insert into public.citations (
      owner_user_id,
      space_id,
      knowledge_item_id,
      source_block_id,
      claim_path,
      quote_excerpt,
      origin_type,
      review_status
    )
    values (
      '00000000-0000-0000-0000-000000000091',
      (
        select space_id
        from public.source_items
        where id = '10000000-0000-0000-0000-000000000091'
      ),
      '80000000-0000-0000-0000-000000000091',
      '60000000-0000-0000-0000-000000000092',
      'l1_content',
      'cross space',
      'ai',
      'pending'
    );
  $$,
  '%foreign key%',
  'cross-space citations fail'
);

select throws_like(
  $$
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
      '80000000-0000-0000-0000-000000000095',
      item.owner_user_id,
      item.space_id,
      item.owner_user_id,
      'fact',
      'Rejected fact',
      'Rejected',
      'L1',
      0.200,
      'rejected',
      'cited'
    from public.source_items as item
    where item.id = '10000000-0000-0000-0000-000000000091';

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
      '80000000-0000-0000-0000-000000000095',
      'knowledge_draft',
      'open',
      5,
      'should not stay open'
    from public.source_items as item
    where item.id = '10000000-0000-0000-0000-000000000091';

    set constraints all immediate;
  $$,
  '%open review task%',
  'rejected knowledge cannot have an open review task'
);

select throws_like(
  $$select public.assert_ai_knowledge_update(array['title'], array['title', 'l0_summary'])$$,
  '%locked field%',
  'direct AI updates cannot overwrite a locked field'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000091","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::integer
    from public.knowledge_items
    where owner_user_id = '00000000-0000-0000-0000-000000000092'
  )
  + (
    select count(*)::integer
    from public.review_tasks
    where owner_user_id = '00000000-0000-0000-0000-000000000092'
  ),
  0,
  'owner A cannot view another owner knowledge or review task'
);

select * from finish();

rollback;
