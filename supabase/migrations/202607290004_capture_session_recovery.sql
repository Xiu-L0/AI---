alter table public.capture_sessions
add column recovery_of_capture_session_id uuid;

alter table public.capture_sessions
add column resolved_at timestamptz;

alter table public.capture_sessions
add column resolved_by_capture_session_id uuid;

alter table public.capture_sessions
add constraint capture_sessions_recovery_owner_fk
foreign key (recovery_of_capture_session_id, owner_user_id)
references public.capture_sessions(id, owner_user_id);

alter table public.capture_sessions
add constraint capture_sessions_resolution_owner_fk
foreign key (resolved_by_capture_session_id, owner_user_id)
references public.capture_sessions(id, owner_user_id);

alter table public.capture_sessions
add constraint capture_sessions_recovery_not_self
check (
  recovery_of_capture_session_id is null
  or recovery_of_capture_session_id <> id
);

alter table public.capture_sessions
add constraint capture_sessions_resolution_fields_consistent
check (
  (resolved_at is null and resolved_by_capture_session_id is null)
  or (resolved_at is not null and resolved_by_capture_session_id is not null)
);

create index capture_sessions_owner_unresolved_failure_idx
on public.capture_sessions (owner_user_id, created_at desc)
where status = 'failed' and resolved_at is null;

create index capture_sessions_recovery_idx
on public.capture_sessions (recovery_of_capture_session_id)
where recovery_of_capture_session_id is not null;

create or replace function public.validate_capture_session_recovery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovery_target public.capture_sessions%rowtype;
begin
  if new.recovery_of_capture_session_id is null then
    return new;
  end if;

  select capture.*
  into recovery_target
  from public.capture_sessions as capture
  where capture.id = new.recovery_of_capture_session_id
    and capture.owner_user_id = new.owner_user_id
  for update;

  if not found then
    raise invalid_parameter_value using
      message = 'capture recovery target was not found for this owner';
  end if;

  if
    recovery_target.status = 'finalized'
    or recovery_target.resolved_at is not null
    or recovery_target.source <> new.source
    or recovery_target.scope <> new.scope
    or recovery_target.external_ref is distinct from new.external_ref
  then
    raise invalid_parameter_value using
      message = 'capture recovery target is not compatible or is already resolved';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_capture_session_recovery()
from public, anon, authenticated;
grant execute on function public.validate_capture_session_recovery()
to service_role;

create trigger capture_sessions_validate_recovery
before insert or update of recovery_of_capture_session_id
on public.capture_sessions
for each row
execute function public.validate_capture_session_recovery();

create or replace function public.prevent_resolved_capture_finalization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if
    new.status = 'finalized'
    and old.status is distinct from 'finalized'
    and old.resolved_at is not null
  then
    raise invalid_parameter_value using
      message = 'resolved capture sessions cannot be finalized';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_resolved_capture_finalization()
from public, anon, authenticated;
grant execute on function public.prevent_resolved_capture_finalization()
to service_role;

create trigger capture_sessions_prevent_resolved_finalization
before update of status on public.capture_sessions
for each row
execute function public.prevent_resolved_capture_finalization();

create or replace function public.resolve_recovered_capture_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if
    new.status = 'finalized'
    and old.status is distinct from 'finalized'
    and new.recovery_of_capture_session_id is not null
  then
    with recursive recovery_chain(id) as (
      select new.recovery_of_capture_session_id
      union
      select parent.recovery_of_capture_session_id
      from public.capture_sessions as parent
      join recovery_chain as child on child.id = parent.id
      where parent.owner_user_id = new.owner_user_id
        and parent.recovery_of_capture_session_id is not null
    )
    update public.capture_sessions as recovered
    set
      resolved_at = statement_timestamp(),
      resolved_by_capture_session_id = new.id
    where recovered.owner_user_id = new.owner_user_id
      and recovered.id in (select id from recovery_chain)
      and recovered.status <> 'finalized'
      and recovered.resolved_at is null;
  end if;

  return new;
end;
$$;

revoke all on function public.resolve_recovered_capture_sessions()
from public, anon, authenticated;
grant execute on function public.resolve_recovered_capture_sessions()
to service_role;

create trigger capture_sessions_resolve_recovery
after update of status on public.capture_sessions
for each row
execute function public.resolve_recovered_capture_sessions();
