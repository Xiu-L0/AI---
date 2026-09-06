alter table public.source_items
  add constraint source_items_id_owner_space_key
    unique (id, owner_user_id, space_id);

alter table public.source_messages
  add constraint source_messages_id_version_item_owner_key
    unique (id, source_version_id, source_item_id, owner_user_id);

alter table public.source_attachments
  add constraint source_attachments_id_version_owner_key
    unique (id, source_version_id, owner_user_id);

create type public.source_block_type as enum (
  'heading',
  'paragraph',
  'list_item',
  'table',
  'code',
  'message',
  'ocr_region',
  'repository_file',
  'repository_excerpt',
  'metadata'
);

create type public.source_asset_relation as enum (
  'inline_image',
  'screenshot',
  'attachment',
  'ocr_source',
  'supplemental_evidence'
);

create type public.knowledge_type as enum (
  'concept',
  'principle',
  'method',
  'scenario',
  'case',
  'fact',
  'opinion',
  'question',
  'conclusion'
);

create type public.knowledge_status as enum (
  'ai_draft',
  'pending_review',
  'confirmed',
  'rejected',
  'archived',
  'needs_review'
);

create type public.knowledge_evidence_mode as enum (
  'cited',
  'personal_inference'
);

create type public.knowledge_change_origin as enum (
  'ai',
  'user',
  'system'
);

create type public.citation_origin as enum (
  'ai',
  'user'
);

create type public.citation_review_status as enum (
  'pending',
  'approved',
  'rejected'
);

create type public.review_task_type as enum (
  'knowledge_draft',
  'low_confidence',
  'sensitive_content',
  'conflict',
  'stale_knowledge'
);

create type public.review_task_status as enum (
  'open',
  'completed',
  'dismissed'
);

create or replace function public.is_valid_human_locked_fields(
  fields text[]
) returns boolean
language sql
immutable
as $$
  select
    fields is not null
    and not exists (
      select 1
      from unnest(fields) as entry
      where entry not in (
        'title',
        'l0_summary',
        'l1_content',
        'l2_content',
        'conditions',
        'limitations'
      )
    )
    and (
      select count(*) = count(distinct entry)
      from unnest(fields) as entry
    );
$$;

create or replace function public.is_valid_short_text_array(
  p_values text[]
) returns boolean
language sql
immutable
as $$
  select
    p_values is not null
    and cardinality(p_values) <= 50
    and not exists (
      select 1
      from unnest(p_values) as entry
      where char_length(entry) not between 1 and 1000
    );
$$;

create or replace function public.assert_ai_knowledge_update(
  p_locked_fields text[],
  p_changed_fields text[]
) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_locked_fields, '{}')) as locked_field
    join pg_catalog.unnest(coalesce(p_changed_fields, '{}')) as changed_field
      on changed_field = locked_field
  ) then
    raise exception 'direct AI updates cannot overwrite a locked field';
  end if;
end;
$$;

revoke all on function public.assert_ai_knowledge_update(text[], text[])
from public, anon, authenticated;
grant execute on function public.assert_ai_knowledge_update(text[], text[])
to service_role;

create table public.source_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  source_item_id uuid not null,
  source_version_id uuid not null,
  source_message_id uuid,
  block_type public.source_block_type not null,
  ordinal integer not null,
  locator_key text not null,
  locator_json jsonb not null,
  content_hash text not null,
  text_content text not null,
  language text,
  metadata_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_blocks_space_owner_fk
    foreign key (space_id, owner_user_id)
    references public.spaces(id, owner_user_id),
  constraint source_blocks_item_owner_space_fk
    foreign key (source_item_id, owner_user_id, space_id)
    references public.source_items(id, owner_user_id, space_id)
    on delete cascade,
  constraint source_blocks_version_item_owner_fk
    foreign key (source_version_id, source_item_id, owner_user_id)
    references public.source_versions(id, source_item_id, owner_user_id)
    on delete cascade,
  constraint source_blocks_message_version_item_owner_fk
    foreign key (
      source_message_id,
      source_version_id,
      source_item_id,
      owner_user_id
    )
    references public.source_messages(
      id,
      source_version_id,
      source_item_id,
      owner_user_id
    )
    on delete cascade,
  constraint source_blocks_ordinal_nonnegative check (ordinal >= 0),
  constraint source_blocks_locator_key_length
    check (char_length(locator_key) between 1 and 500),
  constraint source_blocks_content_hash_format
    check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint source_blocks_text_content_size
    check (octet_length(text_content) <= 1048576),
  constraint source_blocks_locator_json_size
    check (octet_length(locator_json::text) <= 65536),
  constraint source_blocks_metadata_json_size
    check (
      metadata_json is null
      or octet_length(metadata_json::text) <= 65536
    ),
  constraint source_blocks_language_length
    check (language is null or char_length(language) between 1 and 32),
  constraint source_blocks_id_owner_key unique (id, owner_user_id),
  constraint source_blocks_id_owner_space_key unique (id, owner_user_id, space_id),
  constraint source_blocks_version_ordinal_key unique (source_version_id, ordinal),
  constraint source_blocks_version_locator_hash_key
    unique (source_version_id, locator_key, content_hash)
);

create table public.source_asset_links (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  source_attachment_id uuid not null,
  source_message_id uuid,
  source_block_id uuid,
  relation_type public.source_asset_relation not null,
  created_at timestamptz not null default now(),
  constraint source_asset_links_space_owner_fk
    foreign key (space_id, owner_user_id)
    references public.spaces(id, owner_user_id),
  constraint source_asset_links_attachment_owner_fk
    foreign key (source_attachment_id, owner_user_id)
    references public.source_attachments(id, owner_user_id)
    on delete cascade,
  constraint source_asset_links_message_owner_fk
    foreign key (source_message_id, owner_user_id)
    references public.source_messages(id, owner_user_id)
    on delete cascade,
  constraint source_asset_links_block_owner_space_fk
    foreign key (source_block_id, owner_user_id, space_id)
    references public.source_blocks(id, owner_user_id, space_id)
    on delete cascade,
  constraint source_asset_links_target_present
    check (source_message_id is not null or source_block_id is not null),
  constraint source_asset_links_id_owner_key unique (id, owner_user_id),
  constraint source_asset_links_relation_tuple_key
    unique nulls not distinct (
      source_attachment_id,
      source_message_id,
      source_block_id,
      relation_type
    )
);

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  created_by_user_id uuid not null references auth.users(id),
  knowledge_type public.knowledge_type not null,
  title text not null,
  l0_summary text not null,
  l1_content text not null,
  l2_content text not null default '',
  conditions text[] not null default '{}',
  limitations text[] not null default '{}',
  human_locked_fields text[] not null default '{}',
  confidence numeric(4, 3) not null,
  status public.knowledge_status not null default 'ai_draft',
  evidence_mode public.knowledge_evidence_mode not null default 'cited',
  freshness_status text not null default 'current',
  review_after timestamptz,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_items_space_owner_fk
    foreign key (space_id, owner_user_id)
    references public.spaces(id, owner_user_id),
  constraint knowledge_items_title_length
    check (char_length(btrim(title)) between 1 and 500),
  constraint knowledge_items_l0_length
    check (char_length(btrim(l0_summary)) between 1 and 1000),
  constraint knowledge_items_l1_size
    check (octet_length(l1_content) <= 1048576),
  constraint knowledge_items_l2_size
    check (octet_length(l2_content) <= 1048576),
  constraint knowledge_items_conditions_valid
    check (public.is_valid_short_text_array(conditions)),
  constraint knowledge_items_limitations_valid
    check (public.is_valid_short_text_array(limitations)),
  constraint knowledge_items_locked_fields_valid
    check (public.is_valid_human_locked_fields(human_locked_fields)),
  constraint knowledge_items_confidence_range
    check (confidence >= 0 and confidence <= 1),
  constraint knowledge_items_freshness_valid
    check (freshness_status in ('current', 'aging', 'stale', 'unknown')),
  constraint knowledge_items_current_version_positive
    check (current_version > 0),
  constraint knowledge_items_id_owner_key unique (id, owner_user_id),
  constraint knowledge_items_id_owner_space_key unique (id, owner_user_id, space_id)
);

create table public.knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  knowledge_item_id uuid not null,
  version integer not null,
  snapshot_json jsonb not null,
  change_origin public.knowledge_change_origin not null,
  changed_by_user_id uuid references auth.users(id),
  processor_run_id uuid,
  created_at timestamptz not null default now(),
  constraint knowledge_versions_item_owner_space_fk
    foreign key (knowledge_item_id, owner_user_id, space_id)
    references public.knowledge_items(id, owner_user_id, space_id)
    on delete cascade,
  constraint knowledge_versions_number_positive check (version > 0),
  constraint knowledge_versions_snapshot_size
    check (octet_length(snapshot_json::text) <= 2097152),
  constraint knowledge_versions_id_owner_key unique (id, owner_user_id),
  constraint knowledge_versions_item_version_key unique (knowledge_item_id, version)
);

create table public.citations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  knowledge_item_id uuid not null,
  source_block_id uuid not null,
  claim_path text not null,
  quote_excerpt text not null,
  origin_type public.citation_origin not null,
  review_status public.citation_review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint citations_knowledge_owner_space_fk
    foreign key (knowledge_item_id, owner_user_id, space_id)
    references public.knowledge_items(id, owner_user_id, space_id)
    on delete cascade,
  constraint citations_block_owner_space_fk
    foreign key (source_block_id, owner_user_id, space_id)
    references public.source_blocks(id, owner_user_id, space_id),
  constraint citations_claim_path_valid
    check (claim_path in (
      'l0_summary',
      'l1_content',
      'l2_content',
      'conditions',
      'limitations'
    )),
  constraint citations_quote_excerpt_length
    check (char_length(quote_excerpt) between 1 and 2000),
  constraint citations_id_owner_key unique (id, owner_user_id)
);

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  knowledge_item_id uuid,
  task_type public.review_task_type not null,
  status public.review_task_status not null default 'open',
  priority integer not null,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id),
  constraint review_tasks_space_owner_fk
    foreign key (space_id, owner_user_id)
    references public.spaces(id, owner_user_id),
  constraint review_tasks_knowledge_owner_space_fk
    foreign key (knowledge_item_id, owner_user_id, space_id)
    references public.knowledge_items(id, owner_user_id, space_id)
    on delete cascade,
  constraint review_tasks_priority_range check (priority between 0 and 100),
  constraint review_tasks_reason_length
    check (char_length(btrim(reason)) between 1 and 2000),
  constraint review_tasks_resolution_consistent
    check (
      (
        status = 'open'
        and resolved_at is null
        and resolved_by_user_id is null
      )
      or (
        status in ('completed', 'dismissed')
        and resolved_at is not null
      )
    ),
  constraint review_tasks_id_owner_key unique (id, owner_user_id)
);

create unique index review_tasks_open_item_type_idx
  on public.review_tasks (knowledge_item_id, task_type)
  where status = 'open' and knowledge_item_id is not null;

create or replace function public.prevent_knowledge_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'knowledge_versions are immutable';
end;
$$;

create trigger knowledge_versions_prevent_update
  before update on public.knowledge_versions
  for each row
  execute function public.prevent_knowledge_version_mutation();

create trigger knowledge_versions_prevent_delete
  before delete on public.knowledge_versions
  for each row
  execute function public.prevent_knowledge_version_mutation();

create or replace function public.enforce_knowledge_version_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_expected integer;
begin
  select coalesce(max(version), 0) + 1
  into v_expected
  from public.knowledge_versions
  where knowledge_item_id = new.knowledge_item_id;

  if new.version <> v_expected then
    raise exception 'knowledge versions must be strictly sequential';
  end if;

  return new;
end;
$$;

create trigger knowledge_versions_sequence
  before insert on public.knowledge_versions
  for each row
  execute function public.enforce_knowledge_version_sequence();

create or replace function public.enforce_knowledge_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item public.knowledge_items%rowtype;
  v_item_id uuid;
begin
  if tg_table_name = 'knowledge_items' then
    v_item := new;
  else
    v_item_id := coalesce(new.knowledge_item_id, old.knowledge_item_id);
    select *
    into v_item
    from public.knowledge_items
    where id = v_item_id;

    if not found then
      return coalesce(new, old);
    end if;
  end if;

  if v_item.status is distinct from 'confirmed' then
    return coalesce(new, old);
  end if;

  if
    v_item.knowledge_type = 'opinion'
    and v_item.evidence_mode = 'personal_inference'
  then
    return coalesce(new, old);
  end if;

  if not exists (
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

  return coalesce(new, old);
end;
$$;

create constraint trigger knowledge_items_confirmation
after insert or update on public.knowledge_items
deferrable initially deferred
for each row
execute function public.enforce_knowledge_confirmation();

create constraint trigger citations_confirmation
after insert or update or delete on public.citations
deferrable initially deferred
for each row
execute function public.enforce_knowledge_confirmation();

create or replace function public.enforce_rejected_knowledge_review_tasks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item public.knowledge_items%rowtype;
  v_item_id uuid;
begin
  if tg_table_name = 'knowledge_items' then
    v_item := new;
  else
    if new.status is distinct from 'open' then
      return new;
    end if;

    v_item_id := new.knowledge_item_id;
    if v_item_id is null then
      return new;
    end if;

    select *
    into v_item
    from public.knowledge_items
    where id = v_item_id;

    if not found then
      return new;
    end if;
  end if;

  if v_item.status is distinct from 'rejected' then
    return coalesce(new, old);
  end if;

  if exists (
    select 1
    from public.review_tasks as task
    where task.knowledge_item_id = v_item.id
      and task.status = 'open'
  ) then
    raise exception 'rejected knowledge cannot have an open review task'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

create constraint trigger knowledge_items_rejected_review_tasks
after insert or update on public.knowledge_items
deferrable initially deferred
for each row
execute function public.enforce_rejected_knowledge_review_tasks();

create constraint trigger review_tasks_rejected_knowledge
after insert or update on public.review_tasks
deferrable initially deferred
for each row
execute function public.enforce_rejected_knowledge_review_tasks();

create index knowledge_items_space_status_updated_idx
  on public.knowledge_items (space_id, status, updated_at desc);

create index knowledge_items_space_type_updated_idx
  on public.knowledge_items (space_id, knowledge_type, updated_at desc);

create index knowledge_versions_item_version_idx
  on public.knowledge_versions (knowledge_item_id, version);

create index citations_knowledge_item_idx
  on public.citations (knowledge_item_id);

create index citations_source_block_idx
  on public.citations (source_block_id);

create index review_tasks_space_status_priority_idx
  on public.review_tasks (space_id, status, priority desc, created_at);

alter table public.source_blocks enable row level security;
alter table public.source_asset_links enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.knowledge_versions enable row level security;
alter table public.citations enable row level security;
alter table public.review_tasks enable row level security;

revoke all on table
  public.source_blocks,
  public.source_asset_links,
  public.knowledge_items,
  public.knowledge_versions,
  public.citations,
  public.review_tasks
from public, anon, authenticated;

grant select on table
  public.source_blocks,
  public.source_asset_links,
  public.knowledge_items,
  public.knowledge_versions,
  public.citations,
  public.review_tasks
to authenticated;

grant select, insert, update, delete on table
  public.source_blocks,
  public.source_asset_links,
  public.knowledge_items,
  public.citations,
  public.review_tasks
to service_role;

grant select, insert on table
  public.knowledge_versions
to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_blocks',
    'source_asset_links',
    'knowledge_items',
    'knowledge_versions',
    'citations',
    'review_tasks'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using ('
      || '(select auth.uid()) is not null '
      || 'and (select auth.uid()) = owner_user_id '
      || 'and exists ('
      || '  select 1 from public.space_members as membership '
      || '  where membership.space_id = %I.space_id '
      || '    and membership.user_id = (select auth.uid())'
      || '))',
      table_name || '_owner_member_select',
      table_name,
      table_name
    );
  end loop;
end;
$$;
