import "server-only";

import { z } from "zod";

import { createServerClient } from "@/lib/supabase/server";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviewTaskRecord = {
  createdAt: string;
  id: string;
  knowledgeItemId: string;
  priority: number;
};

export type KnowledgeInboxItemRecord = {
  confidence: number;
  createdAt: string;
  id: string;
  knowledgeType: string;
  l0Summary: string;
  sourceTitle: string | null;
};

export interface ReviewInboxRepository {
  listKnowledgeItems(
    ownerUserId: string,
    knowledgeItemIds: string[],
  ): Promise<KnowledgeInboxItemRecord[]>;
  listOpenReviewTasks(
    ownerUserId: string,
    limit: number,
  ): Promise<ReviewTaskRecord[]>;
}

export type KnowledgeInboxCard = {
  confidence: number;
  createdAt: string;
  knowledgeItemId: string;
  knowledgeType: string;
  l0Summary: string;
  sourceTitle: string;
  taskId: string;
};

export type KnowledgeInboxPage = {
  items: KnowledgeInboxCard[];
  nextCursor: string | null;
};

export type ReviewCursor = {
  createdAt: string;
  id: string;
  priority: number;
};

type FilterBuilder = PromiseLike<{
  data: unknown;
  error: { message?: string } | null;
}> & {
  eq(column: string, value: string): FilterBuilder;
  in(column: string, values: string[]): FilterBuilder;
  not(column: string, operator: string, value: unknown): FilterBuilder;
  order(column: string, options?: { ascending?: boolean }): FilterBuilder;
  limit(value: number): FilterBuilder;
};

type KnowledgeQueryClient = {
  from(table: string): {
    select(columns: string): FilterBuilder;
  };
};

function normalizedLimit(limit?: number) {
  if (limit == null) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_PAGE_SIZE);
}

export function encodeReviewCursor(cursor: ReviewCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeReviewCursor(value: string | null): ReviewCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ReviewCursor;
    if (
      typeof parsed.id === "string" &&
      UUID_PATTERN.test(parsed.id) &&
      typeof parsed.createdAt === "string" &&
      Number.isInteger(parsed.priority)
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function afterCursor(task: ReviewTaskRecord, cursor: ReviewCursor) {
  if (task.priority !== cursor.priority) {
    return task.priority < cursor.priority;
  }
  if (task.createdAt !== cursor.createdAt) {
    return task.createdAt > cursor.createdAt;
  }
  return task.id > cursor.id;
}

export async function listReviewTasksWithRepository(
  repository: ReviewInboxRepository,
  ownerUserId: string,
  cursor: string | null = null,
  limit?: number,
): Promise<KnowledgeInboxPage> {
  const ownerId = z.uuid().parse(ownerUserId);
  const pageSize = normalizedLimit(limit);
  const decoded = decodeReviewCursor(cursor);
  const tasks = await repository.listOpenReviewTasks(ownerId, 200);
  const ordered = [...tasks].sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    return left.id.localeCompare(right.id);
  });
  const filtered = decoded ? ordered.filter((task) => afterCursor(task, decoded)) : ordered;
  const page = filtered.slice(0, pageSize + 1);
  const hasMore = page.length > pageSize;
  const visible = page.slice(0, pageSize);
  const items = await repository.listKnowledgeItems(
    ownerId,
    visible.map((task) => task.knowledgeItemId),
  );
  const byId = new Map(items.map((item) => [item.id, item]));

  const cards = visible.flatMap((task): KnowledgeInboxCard[] => {
    const item = byId.get(task.knowledgeItemId);
    if (!item) {
      return [];
    }
    return [
      {
        confidence: item.confidence,
        createdAt: item.createdAt,
        knowledgeItemId: item.id,
        knowledgeType: item.knowledgeType,
        l0Summary: item.l0Summary,
        sourceTitle: item.sourceTitle ?? "未命名来源",
        taskId: task.id,
      },
    ];
  });

  const last = visible.at(-1);
  return {
    items: cards,
    nextCursor:
      hasMore && last
        ? encodeReviewCursor({
            createdAt: last.createdAt,
            id: last.id,
            priority: last.priority,
          })
        : null,
  };
}

export async function countOpenReviewTasksWithRepository(
  repository: Pick<ReviewInboxRepository, "listOpenReviewTasks">,
  ownerUserId: string,
) {
  const ownerId = z.uuid().parse(ownerUserId);
  return (await repository.listOpenReviewTasks(ownerId, 200)).length;
}

async function loadSourceTitles(
  client: KnowledgeQueryClient,
  ownerUserId: string,
  rows: Array<{ id: string; source_version_id: string | null }>,
) {
  const versionIds = rows
    .map((row) => row.source_version_id)
    .filter((id): id is string => typeof id === "string");
  if (versionIds.length === 0) {
    return new Map<string, string>();
  }

  const versions = await client
    .from("source_versions")
    .select("id, source_item_id")
    .eq("owner_user_id", ownerUserId)
    .in("id", versionIds);
  if (versions.error) throw versions.error;

  const versionRows = (versions.data ?? []) as Array<{
    id: string;
    source_item_id: string;
  }>;
  const sourceIds = versionRows.map((row) => row.source_item_id);
  const sources = await client
    .from("source_items")
    .select("id, title")
    .eq("owner_user_id", ownerUserId)
    .in("id", sourceIds);
  if (sources.error) throw sources.error;

  const sourceRows = (sources.data ?? []) as Array<{ id: string; title: string }>;
  const titleBySource = new Map(sourceRows.map((row) => [row.id, row.title]));
  const titleByVersion = new Map(
    versionRows.map((row) => [row.id, titleBySource.get(row.source_item_id) ?? null]),
  );

  return new Map(
    rows.flatMap((row) => {
      const title = row.source_version_id
        ? titleByVersion.get(row.source_version_id)
        : null;
      return title ? [[row.id, title] as const] : [];
    }),
  );
}

export async function createReviewInboxRepository(): Promise<ReviewInboxRepository> {
  const client = (await createServerClient()) as unknown as KnowledgeQueryClient;

  return {
    async listOpenReviewTasks(ownerUserId, limit) {
      const result = await client
        .from("review_tasks")
        .select("id, knowledge_item_id, priority, created_at")
        .eq("owner_user_id", ownerUserId)
        .eq("status", "open")
        .not("knowledge_item_id", "is", null)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(limit);
      if (result.error) throw result.error;

      return ((result.data ?? []) as Array<{
        created_at: string;
        id: string;
        knowledge_item_id: string | null;
        priority: number;
      }>).flatMap((row) =>
        row.knowledge_item_id
          ? [
              {
                createdAt: row.created_at,
                id: row.id,
                knowledgeItemId: row.knowledge_item_id,
                priority: row.priority,
              },
            ]
          : [],
      );
    },
    async listKnowledgeItems(ownerUserId, knowledgeItemIds) {
      if (knowledgeItemIds.length === 0) return [];
      const result = await client
        .from("knowledge_items")
        .select(
          "id, l0_summary, knowledge_type, confidence, created_at, source_version_id",
        )
        .eq("owner_user_id", ownerUserId)
        .in("id", knowledgeItemIds);
      if (result.error) throw result.error;

      const rows = (result.data ?? []) as Array<{
        confidence: number;
        created_at: string;
        id: string;
        knowledge_type: string;
        l0_summary: string;
        source_version_id: string | null;
      }>;
      const titles = await loadSourceTitles(client, ownerUserId, rows);

      return rows.map((row) => ({
        confidence: Number(row.confidence),
        createdAt: row.created_at,
        id: row.id,
        knowledgeType: row.knowledge_type,
        l0Summary: row.l0_summary,
        sourceTitle: titles.get(row.id) ?? null,
      }));
    },
  };
}

export async function listReviewTasks(
  ownerUserId: string,
  cursor: string | null = null,
  limit?: number,
) {
  return listReviewTasksWithRepository(
    await createReviewInboxRepository(),
    ownerUserId,
    cursor,
    limit,
  );
}

export async function countOpenReviewTasks(ownerUserId: string) {
  return countOpenReviewTasksWithRepository(
    await createReviewInboxRepository(),
    ownerUserId,
  );
}
