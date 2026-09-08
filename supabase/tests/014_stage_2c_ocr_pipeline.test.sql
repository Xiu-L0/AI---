begin;

select plan(15);

create function pg_temp.seed_ocr_source(
  owner_id uuid,
  item_id uuid,
  session_id uuid,
  version_id uuid,
  attachment_id uuid,
  note_id text,
  job_type text,
  client_id text
) returns void
language plpgsql
as $$
begin
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
    item_id,
    owner_id,
    'xiaohongshu',
    'social_post',
    note_id,
    'OCR fixture ' || note_id,
    'normal',
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
    session_id,
    owner_id,
    item_id,
    'ocr-key-' || session_id::text,
    'xiaohongshu',
    'social_post',
    'web_page',
    'OCR fixture',
    'normal',
    note_id,
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
    'synthetic xiaohongshu body',
    repeat(substr(replace(version_id::text, '-', ''), 1, 1), 64)
  );

  insert into public.source_attachments (
    id,
    owner_user_id,
    source_version_id,
    client_id,
    storage_path,
    file_name,
    mime_type,
    byte_size,
    sha256,
    etag
  )
  values (
    attachment_id,
    owner_id,
    version_id,
    client_id,
    owner_id::text || '/fixture/' || client_id || '.png',
    client_id || '.png',
    'image/png',
    12,
    repeat(substr(replace(attachment_id::text, '-', ''), 1, 1), 64),
    'etag-' || client_id
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
    job_type,
    now() - interval '10 seconds',
    now() - interval '10 seconds'
  );
end;
$$;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000e1', 'ocr-owner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'ocr-owner-b@example.test');

update public.processing_jobs
set
  next_attempt_at = now() + interval '7 days',
  lease_expires_at = case
    when status = 'processing' then now() + interval '7 days'
    else lease_expires_at
  end
where status in ('queued', 'processing');

select pg_temp.seed_ocr_source(
  '00000000-0000-0000-0000-0000000000e1',
  '10000000-0000-0000-0000-0000000000e1',
  '20000000-0000-0000-0000-0000000000e1',
  '30000000-0000-0000-0000-0000000000e1',
  '50000000-0000-0000-0000-0000000000e1',
  'note-ocr-a',
  'ocr_assets',
  'xhs-image-1'
);

insert into public.source_attachments (
  id,
  owner_user_id,
  source_version_id,
  client_id,
  storage_path,
  file_name,
  mime_type,
  byte_size,
  sha256,
  etag
)
values (
  '50000000-0000-0000-0000-0000000000ea',
  '00000000-0000-0000-0000-0000000000e1',
  '30000000-0000-0000-0000-0000000000e1',
  'xhs-image-2',
  '00000000-0000-0000-0000-0000000000e1/fixture/xhs-image-2.png',
  'xhs-image-2.png',
  'image/png',
  12,
  repeat('2', 64),
  'etag-xhs-image-2'
);

select pg_temp.seed_ocr_source(
  '00000000-0000-0000-0000-0000000000e2',
  '10000000-0000-0000-0000-0000000000e2',
  '20000000-0000-0000-0000-0000000000e2',
  '30000000-0000-0000-0000-0000000000e2',
  '50000000-0000-0000-0000-0000000000e2',
  'note-ocr-b',
  'ocr_assets',
  'xhs-image-b'
);

select pg_temp.seed_ocr_source(
  '00000000-0000-0000-0000-0000000000e1',
  '10000000-0000-0000-0000-0000000000e3',
  '20000000-0000-0000-0000-0000000000e3',
  '30000000-0000-0000-0000-0000000000e3',
  '50000000-0000-0000-0000-0000000000e3',
  'note-ocr-foreign',
  'ocr_assets',
  'xhs-image-foreign'
);

insert into public.source_items (
  id,
  owner_user_id,
  source,
  external_ref,
  title,
  sensitivity,
  current_version
)
values (
  '10000000-0000-0000-0000-0000000000e4',
  '00000000-0000-0000-0000-0000000000e1',
  'chatgpt_web',
  'chatgpt-ocr-regression',
  'ChatGPT OCR regression',
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
  external_ref,
  status,
  expires_at,
  finalized_at
)
values (
  '20000000-0000-0000-0000-0000000000e4',
  '00000000-0000-0000-0000-0000000000e1',
  '10000000-0000-0000-0000-0000000000e4',
  'ocr-key-chatgpt-e4xxxx',
  'chatgpt_web',
  'full_conversation',
  'ChatGPT OCR regression',
  'normal',
  'chatgpt-ocr-regression',
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
  '30000000-0000-0000-0000-0000000000e4',
  '00000000-0000-0000-0000-0000000000e1',
  '10000000-0000-0000-0000-0000000000e4',
  1,
  '20000000-0000-0000-0000-0000000000e4',
  'complete',
  '{}'::text[],
  'chatgpt regression body',
  repeat('4', 64)
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
  '40000000-0000-0000-0000-0000000000e4',
  '00000000-0000-0000-0000-0000000000e1',
  '10000000-0000-0000-0000-0000000000e4',
  '30000000-0000-0000-0000-0000000000e4',
  'msg-ocr-regression',
  'user',
  'chatgpt regression body',
  0
);

insert into public.processing_jobs (
  owner_user_id,
  source_version_id,
  job_type,
  next_attempt_at,
  created_at
)
values (
  '00000000-0000-0000-0000-0000000000e1',
  '30000000-0000-0000-0000-0000000000e4',
  'build_source_blocks',
  now() - interval '10 seconds',
  now() - interval '10 seconds'
);

select is(
  (
    select count(*)::integer
    from information_schema.check_constraints
    where constraint_name = 'processing_jobs_type_valid'
      and check_clause ilike '%ocr_assets%'
  ),
  1,
  'ocr_assets remains an allowed processing job type'
);

set local role service_role;

create temporary table claimed_ocr on commit drop as
select *
from public.claim_processing_jobs('ocr-worker', 4, 60);

select is(
  (select count(*)::integer from claimed_ocr),
  4,
  'ocr fixtures are claimed'
);

create temporary table persist_first on commit drop as
select public.persist_asset_ocr_result(
  (
    select job_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  (
    select run_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  'ocr-worker',
  '50000000-0000-0000-0000-0000000000e1',
  repeat('a', 64),
  'zhipu',
  'glm-ocr',
  'req-ocr-1xxxxx',
  'Synthetic OCR markdown one.',
  jsonb_build_array(jsonb_build_array(jsonb_build_object(
    'index', 0,
    'label', 'text',
    'bbox_2d', jsonb_build_array(0.1, 0.1, 0.5, 0.3)
  ))),
  jsonb_build_object('num_pages', 1, 'pages', jsonb_build_array(jsonb_build_object('width', 600, 'height', 800))),
  jsonb_build_object('inputTokens', 10, 'outputTokens', 20, 'totalTokens', 30)
) as result_id;

select is(
  persist_first.result_id is not null
  and (
    select count(*)::integer
    from public.asset_ocr_results
    where source_attachment_id = '50000000-0000-0000-0000-0000000000e1'
      and markdown_text = 'Synthetic OCR markdown one.'
      and owner_user_id = '00000000-0000-0000-0000-0000000000e1'
      and source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ) = 1,
  true,
  'an active OCR job can persist an owner-matched result'
)
from persist_first;

create temporary table persist_replay on commit drop as
select public.persist_asset_ocr_result(
  (
    select job_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  (
    select run_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  'ocr-worker',
  '50000000-0000-0000-0000-0000000000e1',
  repeat('a', 64),
  'zhipu',
  'glm-ocr',
  'req-ocr-1-replay',
  'Changed markdown must not overwrite.',
  jsonb_build_array(jsonb_build_array(jsonb_build_object(
    'index', 0,
    'label', 'text',
    'bbox_2d', jsonb_build_array(0.1, 0.1, 0.5, 0.3)
  ))),
  jsonb_build_object('num_pages', 1),
  null
) as result_id;

select is(
  persist_replay.result_id,
  persist_first.result_id,
  'repeating attachment SHA/provider/model returns the existing result'
)
from persist_replay, persist_first;

select is(
  (
    select markdown_text
    from public.asset_ocr_results
    where id = persist_first.result_id
  ),
  'Synthetic OCR markdown one.',
  'idempotent replay does not overwrite immutable OCR markdown'
)
from persist_first;

select public.persist_asset_ocr_result(
  (
    select job_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  (
    select run_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  'ocr-worker',
  '50000000-0000-0000-0000-0000000000e1',
  repeat('c', 64),
  'zhipu',
  'glm-ocr',
  'req-ocr-1-changed',
  'Synthetic OCR markdown changed sha.',
  jsonb_build_array(jsonb_build_array(jsonb_build_object(
    'index', 0,
    'label', 'text',
    'bbox_2d', jsonb_build_array(0.2, 0.2, 0.6, 0.4)
  ))),
  jsonb_build_object('num_pages', 1),
  null
);

select is(
  (
    select count(*)::integer
    from public.asset_ocr_results
    where source_attachment_id = '50000000-0000-0000-0000-0000000000e1'
  )
  = 2
  and (
    select markdown_text
    from public.asset_ocr_results
    where id = persist_first.result_id
  ) = 'Synthetic OCR markdown one.',
  true,
  'a changed SHA inserts a new row without overwriting the previous result'
)
from persist_first;

select is(
  (
    select status
    from public.processing_jobs
    where id = (
      select job_id from claimed_ocr
      where source_version_id = '30000000-0000-0000-0000-0000000000e1'
    )
  ),
  'processing',
  'persist_asset_ocr_result does not mark the OCR job complete'
);

select public.persist_asset_ocr_result(
  (
    select job_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  (
    select run_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  'ocr-worker',
  '50000000-0000-0000-0000-0000000000ea',
  repeat('2', 64),
  'zhipu',
  'glm-ocr',
  'req-ocr-2xxxxx',
  'Synthetic OCR markdown two.',
  jsonb_build_array(jsonb_build_array(jsonb_build_object(
    'index', 0,
    'label', 'text',
    'bbox_2d', jsonb_build_array(0.1, 0.1, 0.4, 0.2)
  ))),
  jsonb_build_object('num_pages', 1),
  null
);

select public.enqueue_followup_processing_job(
  (
    select job_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  (
    select run_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  'ocr-worker',
  'build_source_blocks'
);

select public.enqueue_followup_processing_job(
  (
    select job_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  (
    select run_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  'ocr-worker',
  'build_source_blocks'
);

select is(
  (
    select count(*)::integer
    from public.processing_jobs
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
      and job_type = 'build_source_blocks'
  ),
  1,
  'completing eligible image OCR enqueues exactly one build_source_blocks job'
);

select throws_ok(
  $$ select public.persist_asset_ocr_result(
       (
         select job_id from claimed_ocr
         where source_version_id = '30000000-0000-0000-0000-0000000000e1'
       ),
       (
         select run_id from claimed_ocr
         where source_version_id = '30000000-0000-0000-0000-0000000000e1'
       ),
       'ocr-worker',
       '50000000-0000-0000-0000-0000000000e3',
       repeat('3', 64),
       'zhipu',
       'glm-ocr',
       'req-ocr-foreign',
       'Should not persist foreign attachment.',
       '[]'::jsonb,
       jsonb_build_object('num_pages', 1),
       null
     ) $$,
  '22023',
  null,
  'OCR persist rejects an attachment from another source version'
);

select throws_ok(
  $$ select public.persist_asset_ocr_result(
       (
         select job_id from claimed_ocr
         where source_version_id = '30000000-0000-0000-0000-0000000000e1'
       ),
       (
         select run_id from claimed_ocr
         where source_version_id = '30000000-0000-0000-0000-0000000000e1'
       ),
       'other-worker',
       '50000000-0000-0000-0000-0000000000e1',
       repeat('a', 64),
       'zhipu',
       'glm-ocr',
       'req-ocr-lease',
       'Should not persist without lease.',
       '[]'::jsonb,
       jsonb_build_object('num_pages', 1),
       null
     ) $$,
  '42501',
  null,
  'only the worker holding the OCR lease may persist results'
);

create temporary table claimed_blocks on commit drop as
select *
from public.claim_processing_jobs('ocr-worker', 2, 60);

select public.replace_source_blocks_and_enqueue_extract(
  (
    select job_id from claimed_blocks
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  (
    select run_id from claimed_blocks
    where source_version_id = '30000000-0000-0000-0000-0000000000e1'
  ),
  'ocr-worker',
  jsonb_build_array(
    jsonb_build_object(
      'source_message_id', null,
      'source_attachment_id', null,
      'block_type', 'paragraph',
      'ordinal', 0,
      'locator_key', 'post:body',
      'locator_json', jsonb_build_object('kind', 'body'),
      'text_content', 'synthetic xiaohongshu body',
      'content_hash', repeat('b', 64)
    ),
    jsonb_build_object(
      'source_message_id', null,
      'source_attachment_id', '50000000-0000-0000-0000-0000000000e1',
      'block_type', 'ocr_region',
      'ordinal', 1,
      'locator_key', 'image:xhs-image-1/page:1/region:0',
      'locator_json', jsonb_build_object('page', 1, 'index', 0),
      'text_content', 'Synthetic OCR markdown one.',
      'content_hash', repeat('d', 64)
    )
  )
);

select is(
  (
    select count(*)::integer
    from public.source_blocks as block
    join public.source_asset_links as link
      on link.source_block_id = block.id
     and link.relation_type = 'ocr_source'
     and link.source_attachment_id = '50000000-0000-0000-0000-0000000000e1'
    where block.source_version_id = '30000000-0000-0000-0000-0000000000e1'
      and block.block_type = 'ocr_region'
  ),
  1,
  'ocr_region blocks are linked to the original attachment'
);

select throws_ok(
  $$ select public.replace_source_blocks_and_enqueue_extract(
       (
         select job_id from claimed_blocks
         where source_version_id = '30000000-0000-0000-0000-0000000000e1'
       ),
       (
         select run_id from claimed_blocks
         where source_version_id = '30000000-0000-0000-0000-0000000000e1'
       ),
       'ocr-worker',
       jsonb_build_array(
         jsonb_build_object(
           'source_message_id', null,
           'source_attachment_id', '50000000-0000-0000-0000-0000000000e3',
           'block_type', 'ocr_region',
           'ordinal', 0,
           'locator_key', 'image:xhs-image-foreign/page:1/region:0',
           'locator_json', jsonb_build_object('page', 1, 'index', 0),
           'text_content', 'foreign',
           'content_hash', repeat('e', 64)
         )
       )
     ) $$,
  '22023',
  null,
  'block persistence rejects an attachment from another version'
);

select public.replace_source_blocks_and_enqueue_extract(
  (
    select job_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e4'
  ),
  (
    select run_id from claimed_ocr
    where source_version_id = '30000000-0000-0000-0000-0000000000e4'
  ),
  'ocr-worker',
  jsonb_build_array(
    jsonb_build_object(
      'source_message_id', '40000000-0000-0000-0000-0000000000e4',
      'block_type', 'message',
      'ordinal', 0,
      'locator_key', 'message:msg-ocr-regression/body',
      'locator_json', jsonb_build_object('role', 'user', 'ordinal', 0),
      'text_content', 'chatgpt regression body',
      'content_hash', repeat('f', 64)
    )
  )
);

select is(
  (
    select count(*)::integer
    from public.source_blocks
    where source_version_id = '30000000-0000-0000-0000-0000000000e4'
      and block_type = 'message'
      and locator_key = 'message:msg-ocr-regression/body'
  ),
  1,
  'ChatGPT message blocks still persist through the shared RPC'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::integer
    from public.asset_ocr_results
    where owner_user_id = '00000000-0000-0000-0000-0000000000e1'
  ),
  0,
  'account B cannot read account A OCR rows'
);

select throws_ok(
  $$ select public.persist_asset_ocr_result(
       '00000000-0000-0000-0000-0000000000e1',
       '00000000-0000-0000-0000-0000000000e1',
       'ocr-worker',
       '50000000-0000-0000-0000-0000000000e1',
       repeat('a', 64),
       'zhipu',
       'glm-ocr',
       'req-auth',
       'no',
       '[]'::jsonb,
       jsonb_build_object('num_pages', 1),
       null
     ) $$,
  '42501',
  null,
  'authenticated users cannot persist OCR results'
);

select * from finish();
rollback;
