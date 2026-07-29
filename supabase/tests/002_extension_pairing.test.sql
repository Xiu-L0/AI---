begin;

select plan(8);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000011', 'pairing-owner@example.test'),
  ('00000000-0000-0000-0000-000000000012', 'pairing-other@example.test');

insert into public.extension_pairing_codes (
  owner_user_id,
  code_hash,
  expires_at
)
values (
  '00000000-0000-0000-0000-000000000011',
  repeat('a', 64),
  now() + interval '10 minutes'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.extension_pairing_codes),
  1,
  'owner can see the active pairing code metadata'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated"}',
  true
);

select is(
  (select count(*)::integer from public.extension_pairing_codes),
  0,
  'other user cannot see pairing code metadata'
);

select throws_like(
  $$
    select public.exchange_extension_pairing_code(
      repeat('a', 64),
      repeat('b', 64),
      'Synthetic browser',
      now() + interval '29 days'
    )
  $$,
  '%permission denied%',
  'authenticated clients cannot execute the pairing exchange RPC'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    select public.exchange_extension_pairing_code(
      repeat('a', 64),
      repeat('b', 64),
      '  Synthetic browser  ',
      now() + interval '29 days'
    )
  $$,
  'service role can atomically exchange an active pairing code'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.extension_pairing_codes
    where code_hash = repeat('a', 64)
      and used_at is not null
  ),
  1,
  'successful exchange marks the pairing code used'
);

select is(
  (
    select count(*)::integer
    from public.extension_tokens
    where owner_user_id = '00000000-0000-0000-0000-000000000011'
      and token_hash = repeat('b', 64)
      and label = 'Synthetic browser'
      and revoked_at is null
  ),
  1,
  'successful exchange stores one normalized revocable token'
);

set local role service_role;

select throws_like(
  $$
    select public.exchange_extension_pairing_code(
      repeat('a', 64),
      repeat('c', 64),
      'Second browser',
      now() + interval '29 days'
    )
  $$,
  '%pairing code is invalid or expired%',
  'a pairing code cannot be exchanged twice'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.extension_tokens
    where owner_user_id = '00000000-0000-0000-0000-000000000011'
  ),
  1,
  'failed repeated exchange does not insert another token'
);

select * from finish();
rollback;
