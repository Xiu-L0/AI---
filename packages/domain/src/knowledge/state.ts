import type {
  EditableKnowledgeField,
  KnowledgeChangeOrigin,
  KnowledgeStatus
} from "@recall/contracts";

export type KnowledgeActor = KnowledgeChangeOrigin;

export interface KnowledgeContent {
  title: string;
  l0Summary: string;
  l1Content: string;
  l2Content: string;
  conditions: readonly string[];
  limitations: readonly string[];
}

export type KnowledgePatch = Partial<KnowledgeContent>;

export type KnowledgePatchResult =
  | { ok: true; next: KnowledgeContent }
  | { ok: false; code: "locked_field"; field: EditableKnowledgeField };

const AI_TRANSITIONS: Record<KnowledgeStatus, readonly KnowledgeStatus[]> = {
  ai_draft: ["ai_draft", "pending_review"],
  pending_review: ["ai_draft", "pending_review"],
  confirmed: [],
  rejected: [],
  archived: [],
  needs_review: ["ai_draft", "pending_review"]
};

const USER_TRANSITIONS: Record<KnowledgeStatus, readonly KnowledgeStatus[]> = {
  ai_draft: ["pending_review", "rejected", "archived"],
  pending_review: ["confirmed", "rejected", "needs_review", "ai_draft"],
  confirmed: ["needs_review", "archived"],
  rejected: ["needs_review", "archived"],
  archived: ["needs_review"],
  needs_review: ["confirmed", "rejected", "pending_review", "archived"]
};

const SYSTEM_TRANSITIONS: Record<KnowledgeStatus, readonly KnowledgeStatus[]> = {
  ai_draft: [],
  pending_review: ["needs_review"],
  confirmed: ["needs_review"],
  rejected: [],
  archived: [],
  needs_review: []
};

const TRANSITIONS: Record<
  KnowledgeActor,
  Record<KnowledgeStatus, readonly KnowledgeStatus[]>
> = {
  ai: AI_TRANSITIONS,
  user: USER_TRANSITIONS,
  system: SYSTEM_TRANSITIONS
};

const EDITABLE_FIELDS = [
  "title",
  "l0Summary",
  "l1Content",
  "l2Content",
  "conditions",
  "limitations"
] as const satisfies readonly EditableKnowledgeField[];

export function canTransitionKnowledge(
  from: KnowledgeStatus,
  to: KnowledgeStatus,
  actor: KnowledgeActor
): boolean {
  return TRANSITIONS[actor][from].includes(to);
}

export function applyKnowledgePatch(
  current: KnowledgeContent,
  patch: KnowledgePatch,
  lockedFields: readonly string[],
  origin: KnowledgeChangeOrigin
): KnowledgePatchResult {
  const locked = new Set(lockedFields);

  for (const field of EDITABLE_FIELDS) {
    if (!Object.hasOwn(patch, field) || patch[field] === undefined) {
      continue;
    }

    if (origin === "ai" && locked.has(field)) {
      return { ok: false, code: "locked_field", field };
    }
  }

  return {
    ok: true,
    next: {
      title: patch.title ?? current.title,
      l0Summary: patch.l0Summary ?? current.l0Summary,
      l1Content: patch.l1Content ?? current.l1Content,
      l2Content: patch.l2Content ?? current.l2Content,
      conditions: patch.conditions ?? current.conditions,
      limitations: patch.limitations ?? current.limitations
    }
  };
}

export function nextKnowledgeVersion(currentVersion: number): number {
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error("knowledge versions start at 1");
  }

  return currentVersion + 1;
}
