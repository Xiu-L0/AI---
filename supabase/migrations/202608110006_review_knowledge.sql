create or replace function public.review_knowledge_item(
  p_knowledge_item_id uuid,
  p_expected_version integer,
  p_decision text,
  p_patch jsonb,
  p_approved_citation_ids uuid[],
  p_locked_fields text[],
  p_rejection_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.knowledge_items;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_approved uuid[] := coalesce(p_approved_citation_ids, '{}'::uuid[]);
  v_locked text[] := coalesce(p_locked_fields, '{}'::text[]);
  v_title text;
  v_l0 text;
  v_l1 text;
  v_l2 text;
  v_conditions text[];
  v_limitations text[];
  v_next_version integer;
  v_source_item_id uuid;
  v_citation_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if p_decision not in ('confirm', 'reject', 'request_changes') then
    raise exception 'invalid review decision'
      using errcode = '22023';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'expected version is invalid'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'knowledge review patch must be an object'
      using errcode = '22023';
  end if;

  select *
  into v_item
  from public.knowledge_items
  where id = p_knowledge_item_id
  for update;

  if not found then
    raise exception 'knowledge item not found'
      using errcode = 'P0002';
  end if;

  if v_item.owner_user_id is distinct from v_user_id then
    raise exception 'knowledge item is not owned by the current user'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.space_members as membership
    where membership.space_id = v_item.space_id
      and membership.user_id = v_user_id
  ) then
    raise exception 'space membership required'
      using errcode = '42501';
  end if;

  if v_item.current_version is distinct from p_expected_version then
    raise exception 'knowledge item version conflict'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(v_approved) as approved_id
    where not exists (
      select 1
      from public.citations as citation
      where citation.id = approved_id
        and citation.knowledge_item_id = v_item.id
        and citation.owner_user_id = v_item.owner_user_id
        and citation.space_id = v_item.space_id
    )
  ) then
    raise exception 'citation does not belong to this knowledge item'
      using errcode = '22023';
  end if;

  v_title := case
    when v_patch ? 'title' then btrim(v_patch->>'title')
    else v_item.title
  end;
  v_l0 := case
    when v_patch ? 'l0_summary' then btrim(v_patch->>'l0_summary')
    else v_item.l0_summary
  end;
  v_l1 := case
    when v_patch ? 'l1_content' then coalesce(v_patch->>'l1_content', '')
    else v_item.l1_content
  end;
  v_l2 := case
    when v_patch ? 'l2_content' then coalesce(v_patch->>'l2_content', '')
    else v_item.l2_content
  end;

  if v_patch ? 'conditions' then
    select coalesce(array_agg(elem order by ord), '{}'::text[])
    into v_conditions
    from jsonb_array_elements_text(coalesce(v_patch->'conditions', '[]'::jsonb))
      with ordinality as entries(elem, ord);
  else
    v_conditions := v_item.conditions;
  end if;

  if v_patch ? 'limitations' then
    select coalesce(array_agg(elem order by ord), '{}'::text[])
    into v_limitations
    from jsonb_array_elements_text(coalesce(v_patch->'limitations', '[]'::jsonb))
      with ordinality as entries(elem, ord);
  else
    v_limitations := v_item.limitations;
  end if;

  if p_decision = 'confirm' then
    foreach v_citation_id in array v_approved
    loop
      update public.citations
      set
        review_status = 'approved',
        updated_at = now()
      where id = v_citation_id
        and knowledge_item_id = v_item.id
        and owner_user_id = v_item.owner_user_id
        and space_id = v_item.space_id;
    end loop;

    if not (
      v_item.knowledge_type = 'opinion'
      and v_item.evidence_mode = 'personal_inference'
    ) and not exists (
      select 1
      from public.citations as citation
      where citation.knowledge_item_id = v_item.id
        and citation.owner_user_id = v_item.owner_user_id
        and citation.space_id = v_item.space_id
        and citation.review_status = 'approved'
    ) then
      raise exception 'confirmed knowledge requires an approved citation or a personal inference opinion'
        using errcode = '23514';
    end if;

    if not public.is_valid_human_locked_fields(v_locked) then
      raise exception 'human_locked_fields must be unique editable field names'
        using errcode = '22023';
    end if;
  elsif p_decision = 'reject' then
    if p_rejection_reason is null
      or char_length(btrim(p_rejection_reason)) not between 1 and 2000
    then
      raise exception 'rejection reason is required'
        using errcode = '22023';
    end if;
    v_locked := v_item.human_locked_fields;
  else
    v_locked := v_item.human_locked_fields;
  end if;

  v_next_version := v_item.current_version + 1;

  update public.review_tasks
  set
    status = 'completed',
    resolved_at = now(),
    resolved_by_user_id = v_user_id,
    updated_at = now()
  where knowledge_item_id = v_item.id
    and owner_user_id = v_item.owner_user_id
    and space_id = v_item.space_id
    and status = 'open';

  update public.knowledge_items
  set
    title = v_title,
    l0_summary = v_l0,
    l1_content = v_l1,
    l2_content = v_l2,
    conditions = v_conditions,
    limitations = v_limitations,
    human_locked_fields = v_locked,
    status = case p_decision
      when 'confirm' then 'confirmed'::public.knowledge_status
      when 'reject' then 'rejected'::public.knowledge_status
      else 'needs_review'::public.knowledge_status
    end,
    current_version = v_next_version,
    updated_at = now()
  where id = v_item.id
    and owner_user_id = v_item.owner_user_id
  returning * into v_item;

  insert into public.knowledge_versions (
    owner_user_id,
    space_id,
    knowledge_item_id,
    version,
    snapshot_json,
    change_origin,
    changed_by_user_id
  )
  values (
    v_item.owner_user_id,
    v_item.space_id,
    v_item.id,
    v_next_version,
    jsonb_build_object(
      'title', v_item.title,
      'knowledge_type', v_item.knowledge_type,
      'l0_summary', v_item.l0_summary,
      'l1_content', v_item.l1_content,
      'l2_content', v_item.l2_content,
      'conditions', to_jsonb(v_item.conditions),
      'limitations', to_jsonb(v_item.limitations),
      'confidence', v_item.confidence,
      'evidence_mode', v_item.evidence_mode,
      'status', v_item.status,
      'human_locked_fields', to_jsonb(v_item.human_locked_fields),
      'decision', p_decision,
      'rejection_reason', nullif(btrim(coalesce(p_rejection_reason, '')), '')
    ),
    'user',
    v_user_id
  );

  select version.source_item_id
  into v_source_item_id
  from public.source_versions as version
  where version.id = v_item.source_version_id
    and version.owner_user_id = v_item.owner_user_id;

  return jsonb_build_object(
    'knowledge_item_id', v_item.id,
    'version', v_item.current_version,
    'status', v_item.status,
    'source_item_id', v_source_item_id,
    'source_version_id', v_item.source_version_id
  );
end;
$$;

revoke all on function public.review_knowledge_item(
  uuid,
  integer,
  text,
  jsonb,
  uuid[],
  text[],
  text
)
from public, anon, authenticated;
grant execute on function public.review_knowledge_item(
  uuid,
  integer,
  text,
  jsonb,
  uuid[],
  text[],
  text
)
to authenticated;
