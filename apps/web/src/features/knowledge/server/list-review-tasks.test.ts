import { describe, expect, it, vi } from "vitest";

import {
  encodeReviewCursor,
  listReviewTasksWithRepository,
  type ReviewInboxRepository,
} from "./list-review-tasks";

const ownerA = "00000000-0000-4000-8000-0000000000d1";
const ownerB = "00000000-0000-4000-8000-0000000000d2";

function createRepository(
  overrides: Partial<ReviewInboxRepository> = {},
): ReviewInboxRepository {
  return {
    listOpenReviewTasks: vi.fn(async () => [
      {
        createdAt: "2026-09-06T08:00:00.000Z",
        id: "90000000-0000-4000-8000-000000000002",
        knowledgeItemId: "80000000-0000-4000-8000-000000000002",
        priority: 20,
      },
      {
        createdAt: "2026-09-06T07:00:00.000Z",
        id: "90000000-0000-4000-8000-000000000001",
        knowledgeItemId: "80000000-0000-4000-8000-000000000001",
        priority: 40,
      },
    ]),
    listKnowledgeItems: vi.fn(async (_ownerUserId, ids: string[]) =>
      ids.map((id) => ({
        confidence: id.endsWith("1") ? 0.8 : 0.4,
        createdAt: "2026-09-06T07:00:00.000Z",
        id,
        knowledgeType: "concept",
        l0Summary: id.endsWith("1") ? "Higher priority claim" : "Later claim",
        sourceTitle: "ChatGPT fixture",
      })),
    ),
    ...overrides,
  };
}

describe("listReviewTasksWithRepository", () => {
  it("returns open tasks ordered by priority then created time", async () => {
    const repository = createRepository();
    const page = await listReviewTasksWithRepository(repository, ownerA);

    expect(page.items.map((item) => item.knowledgeItemId)).toEqual([
      "80000000-0000-4000-8000-000000000001",
      "80000000-0000-4000-8000-000000000002",
    ]);
    expect(page.items[0]).toMatchObject({
      l0Summary: "Higher priority claim",
      sourceTitle: "ChatGPT fixture",
      confidence: 0.8,
    });
    expect(repository.listOpenReviewTasks).toHaveBeenCalledWith(ownerA, 200);
  });

  it("does not include another owner’s knowledge items", async () => {
    const repository = createRepository({
      listKnowledgeItems: vi.fn(async (ownerUserId: string, ids: string[]) =>
        ownerUserId === ownerA
          ? ids.map((id) => ({
              confidence: 0.5,
              createdAt: "2026-09-06T07:00:00.000Z",
              id,
              knowledgeType: "concept",
              l0Summary: "Owner A only",
              sourceTitle: "Owner A source",
            }))
          : [],
      ),
    });

    const page = await listReviewTasksWithRepository(repository, ownerB, null, 10);
    expect(repository.listOpenReviewTasks).toHaveBeenCalledWith(ownerB, 200);
    expect(page.items).toEqual([]);
  });

  it("pages after the current cursor", async () => {
    const repository = createRepository();
    const page = await listReviewTasksWithRepository(
      repository,
      ownerA,
      encodeReviewCursor({
        createdAt: "2026-09-06T07:00:00.000Z",
        id: "90000000-0000-4000-8000-000000000001",
        priority: 40,
      }),
      10,
    );

    expect(page.items.map((item) => item.knowledgeItemId)).toEqual([
      "80000000-0000-4000-8000-000000000002",
    ]);
  });
});
