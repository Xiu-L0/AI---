begin;

select plan(10);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000081', 'evidence-owner-a@example.test'),
  ('00000000-0000-0000-0000-000000000082', 'evidence-owner-b@example.test');

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
    '10000000-0000-0000-0000-000000000081',
    '00000000-0000-0000-0000-000000000081',
    'manual_text',
    'Owner A evidence',
    'normal',
    1
  ),
  (
    '10000000-0000-0000-0000-000000000082',
    '00000000-0000-0000-0000-000000000082',
    'manual_text',
    'Owner B evidence',
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
    '20000000-0000-0000-0000-000000000081',
    '00000000-0000-0000-0000-000000000081',
    '10000000-0000-0000-0000-000000000081',
    'evidence-key-81xxx',
    'manual_text',
    'selection',
    'Owner A evidence',
    'normal',
    'finalized',
    now() + interval '2 hours',
    now()
  ),
  (
    '20000000-0000-0000-0000-000000000082',
    '00000000-0000-0000-0000-000000000082',
    '10000000-0000-0000-0000-000000000082',
    'evidence-key-82xxx',
    'manual_text',
    'selection',
    'Owner B evidence',
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
    '30000000-0000-0000-0000-000000000081',
    '00000000-0000-0000-0000-000000000081',
    '10000000-0000-0000-0000-000000000081',
    1,
    '20000000-0000-0000-0000-000000000081',
    'complete',
    '{}'::text[],
    'owner a evidence',
    repeat('a', 64)
  ),
  (
    '30000000-0000-0000-0000-000000000082',
    '00000000-0000-0000-0000-000000000082',
    '10000000-0000-0000-0000-000000000082',
    1,
    '20000000-0000-0000-0000-000000000082',
    'complete',
    '{}'::text[],
    'owner b evidence',
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
    '40000000-0000-0000-0000-000000000081',
    '00000000-0000-0000-0000-000000000081',
    '10000000-0000-0000-0000-000000000081',
    '30000000-0000-0000-0000-000000000081',
    'message-a',
    'user',
    'owner a message',
    0
  ),
  (
    '40000000-0000-0000-0000-000000000082',
    '00000000-0000-0000-0000-000000000082',
    '10000000-0000-0000-0000-000000000082',
    '30000000-0000-0000-0000-000000000082',
    'message-b',
    'user',
    'owner b message',
    0
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
values
  (
    '50000000-0000-0000-0000-000000000081',
    '00000000-0000-0000-0000-000000000081',
    '30000000-0000-0000-0000-000000000081',
    'attachment-a',
    '00000000-0000-0000-0000-000000000081/fixture/a.txt',
    'a.txt',
    'text/plain',
    1,
    repeat('c', 64),
    'etag-a'
  ),
  (
    '50000000-0000-0000-0000-000000000082',
    '00000000-0000-0000-0000-000000000082',
    '30000000-0000-0000-0000-000000000082',
    'attachment-b',
    '00000000-0000-0000-0000-000000000082/fixture/b.txt',
    'b.txt',
    'text/plain',
    1,
    repeat('d', 64),
    'etag-b'
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
  '60000000-0000-0000-0000-000000000081',
  item.owner_user_id,
  item.space_id,
  item.id,
  '30000000-0000-0000-0000-000000000081',
  '40000000-0000-0000-0000-000000000081',
  'message',
  0,
  'message:0/body',
  '{"messageOrdinal":0}'::jsonb,
  repeat('e', 64),
  'owner a message'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000081';

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
  '60000000-0000-0000-0000-000000000082',
  item.owner_user_id,
  item.space_id,
  item.id,
  '30000000-0000-0000-0000-000000000082',
  '40000000-0000-0000-0000-000000000082',
  'message',
  0,
  'message:0/body',
  '{"messageOrdinal":0}'::jsonb,
  repeat('f', 64),
  'owner b message'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000082';

insert into public.source_asset_links (
  owner_user_id,
  space_id,
  source_attachment_id,
  source_message_id,
  source_block_id,
  relation_type
)
select
  item.owner_user_id,
  item.space_id,
  '50000000-0000-0000-0000-000000000081',
  '40000000-0000-0000-0000-000000000081',
  '60000000-0000-0000-0000-000000000081',
  'attachment'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000081';

insert into public.source_asset_links (
  owner_user_id,
  space_id,
  source_attachment_id,
  source_message_id,
  source_block_id,
  relation_type
)
select
  item.owner_user_id,
  item.space_id,
  '50000000-0000-0000-0000-000000000082',
  '40000000-0000-0000-0000-000000000082',
  '60000000-0000-0000-0000-000000000082',
  'attachment'
from public.source_items as item
where item.id = '10000000-0000-0000-0000-000000000082';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000081","role":"authenticated"}',
  true
);

select is(
  (
    select count(*)::integer
    from public.source_blocks
    where owner_user_id = '00000000-0000-0000-0000-000000000081'
  ),
  1,
  'owner A can select their evidence block'
);

select is(
  (
    select count(*)::integer
    from public.source_blocks
    where owner_user_id = '00000000-0000-0000-0000-000000000082'
  ),
  0,
  'owner A cannot select owner B evidence block'
);

select is(
  (
    select count(*)::integer
    from public.source_asset_links
    where owner_user_id = '00000000-0000-0000-0000-000000000082'
  ),
  0,
  'owner A cannot select owner B asset link'
);

select throws_like(
  $$insert into public.source_blocks (
      owner_user_id,
      space_id,
      source_item_id,
      source_version_id,
      block_type,
      ordinal,
      locator_key,
      locator_json,
      content_hash,
      text_content
    )
    values (
      '00000000-0000-0000-0000-000000000081',
      (
        select space_id
        from public.source_items
        where id = '10000000-0000-0000-0000-000000000081'
      ),
      '10000000-0000-0000-0000-000000000081',
      '30000000-0000-0000-0000-000000000081',
      'message',
      1,
      'message:1/body',
      '{}'::jsonb,
      repeat('1', 64),
      'client write'
    )$$,
  '%permission denied%',
  'authenticated users cannot insert evidence blocks'
);

reset role;

select throws_like(
  $$insert into public.source_blocks (
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
    values (
      '00000000-0000-0000-0000-000000000081',
      (
        select space_id
        from public.source_items
        where id = '10000000-0000-0000-0000-000000000081'
      ),
      '10000000-0000-0000-0000-000000000081',
      '30000000-0000-0000-0000-000000000081',
      '40000000-0000-0000-0000-000000000082',
      'message',
      1,
      'message:1/body',
      '{}'::jsonb,
      repeat('2', 64),
      'mismatched message'
    )$$,
  '%foreign key%',
  'service role cannot attach a block to another owner message'
);

select throws_like(
  $$insert into public.source_blocks (
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
    values (
      '00000000-0000-0000-0000-000000000081',
      (
        select space_id
        from public.source_items
        where id = '10000000-0000-0000-0000-000000000081'
      ),
      '10000000-0000-0000-0000-000000000081',
      '30000000-0000-0000-0000-000000000081',
      '40000000-0000-0000-0000-000000000081',
      'message',
      0,
      'message:1/body',
      '{}'::jsonb,
      repeat('3', 64),
      'duplicate ordinal'
    )$$,
  '%source_blocks_version_ordinal_key%',
  'ordinal is unique per source version'
);

select throws_like(
  $$insert into public.source_blocks (
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
    values (
      '00000000-0000-0000-0000-000000000081',
      (
        select space_id
        from public.source_items
        where id = '10000000-0000-0000-0000-000000000081'
      ),
      '10000000-0000-0000-0000-000000000081',
      '30000000-0000-0000-0000-000000000081',
      '40000000-0000-0000-0000-000000000081',
      'message',
      1,
      'message:0/body',
      '{}'::jsonb,
      repeat('e', 64),
      'duplicate locator hash'
    )$$,
  '%source_blocks_version_locator_hash_key%',
  'rebuild identity is unique per version locator and hash'
);

select throws_like(
  $$insert into public.source_asset_links (
      owner_user_id,
      space_id,
      source_attachment_id,
      source_message_id,
      relation_type
    )
    values (
      '00000000-0000-0000-0000-000000000081',
      (
        select space_id
        from public.source_items
        where id = '10000000-0000-0000-0000-000000000081'
      ),
      '50000000-0000-0000-0000-000000000081',
      '40000000-0000-0000-0000-000000000082',
      'attachment'
    )$$,
  '%foreign key%',
  'asset links cannot connect owner A attachment to owner B message'
);

select throws_like(
  $$insert into public.source_blocks (
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
    values (
      '00000000-0000-0000-0000-000000000081',
      (
        select space_id
        from public.source_items
        where id = '10000000-0000-0000-0000-000000000081'
      ),
      '10000000-0000-0000-0000-000000000081',
      '30000000-0000-0000-0000-000000000081',
      '40000000-0000-0000-0000-000000000081',
      'message',
      2,
      'message:2/body',
      '{}'::jsonb,
      repeat('4', 64),
      repeat('x', 1048577)
    )$$,
  '%source_blocks_text_content_size%',
  'text_content cannot exceed 1 MiB'
);

select throws_like(
  $$insert into public.source_blocks (
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
    values (
      '00000000-0000-0000-0000-000000000081',
      (
        select space_id
        from public.source_items
        where id = '10000000-0000-0000-0000-000000000081'
      ),
      '10000000-0000-0000-0000-000000000081',
      '30000000-0000-0000-0000-000000000081',
      '40000000-0000-0000-0000-000000000081',
      'message',
      3,
      'message:3/body',
      jsonb_build_object('pad', repeat('y', 65536)),
      repeat('5', 64),
      'locator too large'
    )$$,
  '%source_blocks_locator_json_size%',
  'locator_json cannot exceed 64 KiB'
);

select * from finish();

rollback;
