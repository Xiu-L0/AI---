create or replace function public.report_capture_failure(
  p_owner_user_id uuid,
  p_capture_id uuid,
  p_failure_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  capture public.capture_sessions%rowtype;
  normalized_reason text := btrim(p_failure_reason);
begin
  if normalized_reason is null or char_length(normalized_reason) not between 1 and 2000 then
    raise invalid_parameter_value using
      message = 'capture failure reason must contain between 1 and 2000 characters';
  end if;

  select session.*
  into capture
  from public.capture_sessions as session
  where session.id = p_capture_id
    and session.owner_user_id = p_owner_user_id
  for update;

  if not found then
    raise no_data_found using
      message = 'capture session was not found';
  end if;

  if capture.status <> 'awaiting_upload' or capture.resolved_at is not null then
    raise invalid_parameter_value using
      message = 'capture session cannot be reported as failed';
  end if;

  update public.capture_sessions
  set
    status = 'failed',
    failure_reason = normalized_reason
  where id = capture.id
    and owner_user_id = capture.owner_user_id
    and status = 'awaiting_upload'
    and resolved_at is null;

  if not found then
    raise invalid_parameter_value using
      message = 'capture session state changed before failure reporting';
  end if;

  return jsonb_build_object(
    'captureId', capture.id,
    'captureStatus', 'failed',
    'failureReason', normalized_reason
  );
end;
$$;

revoke all on function public.report_capture_failure(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.report_capture_failure(uuid, uuid, text)
to service_role;
