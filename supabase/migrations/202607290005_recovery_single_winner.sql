create or replace function public.prevent_resolved_capture_finalization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovery_ancestor public.capture_sessions%rowtype;
  recovery_ancestor_id uuid;
  recovery_ancestor_ids uuid[];
begin
  if
    new.status = 'finalized'
    and old.status is distinct from 'finalized'
  then
    if old.resolved_at is not null then
      raise invalid_parameter_value using
        message = 'resolved capture sessions cannot be finalized';
    end if;

    if new.recovery_of_capture_session_id is not null then
      with recursive recovery_chain(id) as (
        select new.recovery_of_capture_session_id
        union
        select parent.recovery_of_capture_session_id
        from public.capture_sessions as parent
        join recovery_chain as child on child.id = parent.id
        where parent.owner_user_id = new.owner_user_id
          and parent.recovery_of_capture_session_id is not null
      )
      select array_agg(id order by id)
      into recovery_ancestor_ids
      from recovery_chain;

      foreach recovery_ancestor_id in array recovery_ancestor_ids
      loop
        select capture.*
        into recovery_ancestor
        from public.capture_sessions as capture
        where capture.id = recovery_ancestor_id
          and capture.owner_user_id = new.owner_user_id
        for update;

        if not found then
          raise invalid_parameter_value using
            message = 'capture recovery ancestor was not found for this owner';
        end if;

        if
          recovery_ancestor.status = 'finalized'
          or recovery_ancestor.resolved_at is not null
        then
          if recovery_ancestor_id = new.recovery_of_capture_session_id then
            raise invalid_parameter_value using
              message = 'capture recovery target is already resolved';
          end if;
          raise invalid_parameter_value using
            message = 'capture recovery ancestor is already resolved';
        end if;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_resolved_capture_finalization()
from public, anon, authenticated;
grant execute on function public.prevent_resolved_capture_finalization()
to service_role;
