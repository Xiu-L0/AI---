begin;

select plan(16);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000c1', 'stage2c-owner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'stage2c-owner-b@example.test');

select throws_ok(
  $$ select 'claude'::public.source_platform $$,
  '22P02',
  null,
  'Claude is not a source platform'
);

insert into public.source_items (
  owner_user_id,
  source,
  external_ref,
  title,
  sensitivity
)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'chatgpt_web',
  'synthetic-chatgpt-2c',
  'Synthetic ChatGPT fixture',
  'normal'
);

select is(
  (
    select source_platform::text
    from public.source_items
    where owner_user_id = '00000000-0000-0000-0000-0000000000c1'
      and external_ref = 'synthetic-chatgpt-2c'
  ),
  'chatgpt',
  'legacy ChatGPT rows are backfilled'
);

select is(
  (
    select count(*)::integer
    from public.source_items
    where source_kind is null
       or source_platform is null
  ),
  0,
  'every source item has typed identity'
);

select throws_ok(
  $$ insert into public.source_items
     (owner_user_id, source_platform, source_kind, external_ref, title, sensitivity)
     values (
       '00000000-0000-0000-0000-0000000000c1',
       'xiaohongshu',
       'ai_conversation',
       'note-bad-kind',
       'bad',
       'normal'
     ) $$,
  '23514',
  null,
  'Xiaohongshu must be a social post'
);

insert into public.source_items (
  owner_user_id,
  source_platform,
  source_kind,
  external_ref,
  title,
  sensitivity
)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'xiaohongshu',
  'social_post',
  'note-shared-id',
  'Owner A note',
  'normal'
);

select lives_ok(
  $$ insert into public.source_items (
       owner_user_id,
       source_platform,
       source_kind,
       external_ref,
       title,
       sensitivity
     )
     values (
       '00000000-0000-0000-0000-0000000000c2',
       'xiaohongshu',
       'social_post',
       'note-shared-id',
       'Owner B note',
       'normal'
     ) $$,
  'two owners may save the same Xiaohongshu note id'
);

select throws_ok(
  $$ insert into public.source_items (
       owner_user_id,
       source_platform,
       source_kind,
       external_ref,
       title,
       sensitivity
     )
     values (
       '00000000-0000-0000-0000-0000000000c1',
       'xiaohongshu',
       'social_post',
       'note-shared-id',
       'Owner A duplicate',
       'normal'
     ) $$,
  '23505',
  null,
  'one owner cannot create two current items for the same typed external ref'
);

select throws_ok(
  $$ insert into public.source_items (
       owner_user_id,
       source_platform,
       source_kind,
       title,
       sensitivity
     )
     values (
       '00000000-0000-0000-0000-0000000000c1',
       'xiaohongshu',
       'social_post',
       'Missing note id',
       'normal'
     ) $$,
  '23514',
  null,
  'Xiaohongshu requires an external ref'
);

insert into public.capture_sessions (
  owner_user_id,
  idempotency_key,
  source_platform,
  source_kind,
  scope,
  title,
  sensitivity,
  external_ref,
  metadata_json,
  status,
  expires_at
)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'xhs-finalize-2cxxxx',
  'xiaohongshu',
  'social_post',
  'web_page',
  'Synthetic Xiaohongshu note',
  'normal',
  'note-finalize-2c',
  jsonb_build_object(
    'adapterName', 'xiaohongshu',
    'adapterVersion', '2026-09-08.v1',
    'canonicalUrl', 'https://www.xiaohongshu.com/explore/note-finalize-2c',
    'author', '合成作者',
    'capturedAt', '2026-09-08T01:00:00.000Z',
    'assets', '[]'::jsonb
  ),
  'awaiting_upload',
  now() + interval '2 hours'
);

select throws_ok(
  $$ insert into public.capture_sessions (
       owner_user_id,
       idempotency_key,
       source_platform,
       source_kind,
       scope,
       title,
       sensitivity,
       external_ref,
       status,
       expires_at
     )
     values (
       '00000000-0000-0000-0000-0000000000c1',
       'xhs-bad-scope-2cxxx',
       'xiaohongshu',
       'social_post',
       'full_conversation',
       'Bad scope',
       'normal',
       'note-bad-scope',
       'awaiting_upload',
       now() + interval '2 hours'
     ) $$,
  '23514',
  null,
  'Xiaohongshu sessions must use web_page scope'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::integer
    from public.source_items
    where owner_user_id = '00000000-0000-0000-0000-0000000000c1'
  ),
  0,
  'the second account cannot select the first account source items'
);

select is(
  (
    select count(*)::integer
    from public.capture_sessions
    where owner_user_id = '00000000-0000-0000-0000-0000000000c1'
  ),
  0,
  'the second account cannot select the first account capture sessions'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-0000000000c1',
      (
        select id
        from public.capture_sessions
        where idempotency_key = 'xhs-finalize-2cxxxx'
      ),
      'xhs-finalize-2cxxxx',
      'complete',
      '{}',
      '合成正文',
      repeat('b', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'typed Xiaohongshu sessions can be finalized'
);

select is(
  (
    select version.metadata_json ->> 'author'
    from public.source_versions as version
    join public.capture_sessions as capture
      on capture.id = version.capture_session_id
    where capture.idempotency_key = 'xhs-finalize-2cxxxx'
  ),
  '合成作者',
  'finalize persists session metadata onto the source version'
);

select is(
  (
    select item.source_platform::text
    from public.source_items as item
    join public.capture_sessions as capture
      on capture.source_item_id = item.id
    where capture.idempotency_key = 'xhs-finalize-2cxxxx'
  ),
  'xiaohongshu',
  'finalize stores typed platform on the source item'
);

select is(
  (
    select item.source
    from public.source_items as item
    join public.capture_sessions as capture
      on capture.source_item_id = item.id
    where capture.idempotency_key = 'xhs-finalize-2cxxxx'
  ),
  null,
  'Xiaohongshu items do not invent a legacy source value'
);

insert into public.capture_sessions (
  owner_user_id,
  idempotency_key,
  source_platform,
  source_kind,
  scope,
  title,
  sensitivity,
  external_ref,
  status,
  expires_at
)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'xhs-dedupe-2cxxxxx',
  'xiaohongshu',
  'social_post',
  'web_page',
  'Synthetic Xiaohongshu note again',
  'normal',
  'note-finalize-2c',
  'awaiting_upload',
  now() + interval '2 hours'
);

select lives_ok(
  $$
    select public.finalize_capture(
      '00000000-0000-0000-0000-0000000000c1',
      (
        select id
        from public.capture_sessions
        where idempotency_key = 'xhs-dedupe-2cxxxxx'
      ),
      'xhs-dedupe-2cxxxxx',
      'complete',
      '{}',
      '合成正文更新',
      repeat('c', 64),
      '[]'::jsonb,
      '[]'::jsonb
    )
  $$,
  'a second finalize for the same typed ref reuses the source item'
);

select is(
  (
    select count(*)::integer
    from public.source_items
    where owner_user_id = '00000000-0000-0000-0000-0000000000c1'
      and source_platform = 'xiaohongshu'
      and external_ref = 'note-finalize-2c'
  ),
  1,
  'typed external refs stay unique per owner'
);

select * from finish();

rollback;
