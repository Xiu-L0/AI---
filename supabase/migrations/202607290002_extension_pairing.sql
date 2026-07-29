create table public.extension_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint extension_pairing_codes_hash_format
    check (code_hash ~ '^[a-f0-9]{64}$'),
  constraint extension_pairing_codes_expiry_after_creation
    check (expires_at > created_at),
  constraint extension_pairing_codes_hash_key unique (code_hash),
  constraint extension_pairing_codes_id_owner_key
    unique (id, owner_user_id)
);

create index extension_pairing_codes_owner_created_idx
on public.extension_pairing_codes (owner_user_id, created_at desc);

create index extension_pairing_codes_unused_expiry_idx
on public.extension_pairing_codes (expires_at)
where used_at is null;

alter table public.extension_pairing_codes enable row level security;

revoke all on table public.extension_pairing_codes
from anon, authenticated;

grant select on table public.extension_pairing_codes
to authenticated;

grant insert on table public.extension_pairing_codes to service_role;
grant select, update on table public.extension_tokens to service_role;

create policy extension_pairing_codes_owner_select
on public.extension_pairing_codes
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = owner_user_id
);

create or replace function public.exchange_extension_pairing_code(
  p_code_hash text,
  p_token_hash text,
  p_label text,
  p_token_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairing_code public.extension_pairing_codes%rowtype;
  normalized_label text;
begin
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    raise invalid_parameter_value using
      message = 'pairing code hash must be a lowercase SHA-256 hex digest';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise invalid_parameter_value using
      message = 'token hash must be a lowercase SHA-256 hex digest';
  end if;

  normalized_label := btrim(p_label);
  if
    normalized_label is null
    or char_length(normalized_label) not between 1 and 100
  then
    raise invalid_parameter_value using
      message = 'extension label must contain between 1 and 100 characters';
  end if;

  if
    p_token_expires_at is null
    or p_token_expires_at <= statement_timestamp()
    or p_token_expires_at > statement_timestamp() + interval '30 days'
  then
    raise invalid_parameter_value using
      message = 'extension token expiry must be within the next 30 days';
  end if;

  select pairing.*
  into pairing_code
  from public.extension_pairing_codes as pairing
  where pairing.code_hash = p_code_hash
    and pairing.used_at is null
    and pairing.expires_at > statement_timestamp()
  for update;

  if not found then
    raise no_data_found using
      message = 'pairing code is invalid or expired';
  end if;

  update public.extension_pairing_codes
  set used_at = statement_timestamp()
  where id = pairing_code.id;

  insert into public.extension_tokens (
    owner_user_id,
    token_hash,
    label,
    expires_at
  )
  values (
    pairing_code.owner_user_id,
    p_token_hash,
    normalized_label,
    p_token_expires_at
  );

  return jsonb_build_object(
    'ownerUserId',
    pairing_code.owner_user_id,
    'tokenExpiresAt',
    p_token_expires_at
  );
end;
$$;

revoke all on function public.exchange_extension_pairing_code(
  text,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute on function public.exchange_extension_pairing_code(
  text,
  text,
  text,
  timestamptz
)
to service_role;
