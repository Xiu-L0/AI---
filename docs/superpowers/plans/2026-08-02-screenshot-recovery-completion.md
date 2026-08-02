# Screenshot Recovery Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one successful ChatGPT screenshot supplement produce one complete recovery version, clear the recovered missing item, resolve the exception, and prevent repeated clicks from creating parallel recovery versions.

**Architecture:** Keep the change inside the extension background orchestration. Build a fresh recovery draft from the original partial messages and metadata plus exactly one newly captured PNG, then rely on the existing durable finalize receipt and recovery-chain resolution. Before capturing, search the local Outbox for an existing screenshot-recovery child and return it instead of enqueueing another child.

**Tech Stack:** TypeScript, WXT Manifest V3, React popup, Vitest, `chrome.storage.local`, existing two-phase capture API.

## Global Constraints

- Do not delete, rewrite, or roll back acceptance versions 5–11.
- Do not synthesize a success receipt; success is displayed only after the server returns and the Outbox stores a durable receipt.
- A failed screenshot, upload, or finalize keeps the original partial receipt available and unresolved.
- A successful screenshot recovery contains exactly one newly generated `image/png` attachment and does not inherit previous recovery screenshots.
- Do not bypass ChatGPT resource authorization and do not add OCR, image understanding, or AI calls.
- Preserve the existing 10 MiB per attachment, 50 attachment, and 100 MiB total limits.
- Do not modify Web or database code unless focused tests prove the existing complete-recovery relationship cannot clear the Web exception.

---

## File Structure

- `apps/extension/lib/background-controller.ts` owns screenshot recovery draft creation, duplicate-child detection, capture, enqueue, processing, and ancestor resolution.
- `apps/extension/lib/background-controller.test.ts` owns regression coverage for complete recovery, one-shot attachment semantics, duplicate-click suppression, and honest failure.
- `apps/extension/entrypoints/popup/App.tsx` already disables the button while one popup operation is running and already renders the returned stored receipt; no modification is planned unless the new focused test proves otherwise.
- `apps/extension/entrypoints/popup/App.test.tsx` remains the verification surface for operation-state UI and receipt-only success.

### Task 1: Complete Screenshot Recovery Exactly Once

**Files:**
- Modify: `apps/extension/lib/background-controller.ts`
- Test: `apps/extension/lib/background-controller.test.ts`
- Verify: `apps/extension/entrypoints/popup/App.test.tsx`

**Interfaces:**
- Consumes: `OutboxItem`, `CaptureDraft`, `dependencies.outbox.list()`, `dependencies.outbox.enqueue(draft, options)`, and `dependencies.processOutboxItem(itemId, now)`.
- Produces: `addScreenshotRecovery(itemId: string): Promise<OutboxItem>` returning either the existing direct screenshot-recovery child or the single newly processed recovery item.
- Produces: a recovery `CaptureDraft` with `attachments: [newScreenshot]`, `completeness: "complete"`, `missingElements: []`, and `pendingImages: []` while preserving the original source, external reference, messages, sensitivity, scope, title, and origin metadata.

- [ ] **Step 1: Strengthen the screenshot-recovery regression test**

Replace the current broad test with assertions that the processed recovery is complete, contains one new screenshot only, clears missing elements, resolves the original, and returns the durable complete receipt:

```ts
it("completes a partial capture with exactly one fresh screenshot", async () => {
  const originalReceipt = receipt("partial");
  const inherited = storedAttachment({ clientId: "old-screenshot" });
  const original = outboxItem({
    captureId,
    draft: {
      ...draft(),
      attachments: [inherited],
      completeness: "partial",
      missingElements: originalReceipt.missingElements,
    },
    receipt: originalReceipt,
    receiptStoredAt: fixedNow.toISOString(),
    state: "partial",
  });
  const test = setup([original]);
  test.process.mockImplementation(async (id: string) =>
    test.dependencies.outbox.mutate(
      id,
      (item) => ({
        ...item,
        captureId,
        receipt: receipt("complete"),
        receiptStoredAt: fixedNow.toISOString(),
        resolvedAt: fixedNow.toISOString(),
        state: "complete",
      }),
      fixedNow,
    ),
  );

  const result = await test.controller.addScreenshotRecovery(original.id);
  const recovery = test.items.find((item) => item.id === result.id)!;

  expect(recovery.draft.attachments).toHaveLength(1);
  expect(recovery.draft.attachments[0]?.clientId).toContain(
    "recovery-screenshot-",
  );
  expect(recovery.draft.attachments[0]?.clientId).not.toBe("old-screenshot");
  expect(recovery.draft.completeness).toBe("complete");
  expect(recovery.draft.missingElements).toEqual([]);
  expect(recovery.draft.pendingImages).toEqual([]);
  expect(result.state).toBe("complete");
  expect(test.items.find((item) => item.id === original.id)).toMatchObject({
    resolvedAt: fixedNow.toISOString(),
    supersededByItemId: result.id,
  });
});
```

If the existing test helpers use a different attachment factory, construct the exact `StoredAttachment` literal already used elsewhere in this test file rather than adding a new production helper.

- [ ] **Step 2: Add a failing duplicate-click regression test**

Create one existing direct recovery child and assert that a second call returns it without capturing or enqueueing another screenshot:

```ts
it("returns the existing direct screenshot recovery instead of creating another", async () => {
  const original = partialOutboxItem();
  const existing = outboxItem({
    id: "existing-screenshot-recovery",
    recoveryOfItemId: original.id,
    draft: {
      ...draft(),
      attachments: [screenshotAttachment],
      completeness: "complete",
      missingElements: [],
    },
    state: "pending",
  });
  const test = setup([original, existing]);

  const result = await test.controller.addScreenshotRecovery(original.id);

  expect(result.id).toBe(existing.id);
  expect(test.dependencies.captureVisibleTab).not.toHaveBeenCalled();
  expect(test.dependencies.outbox.enqueue).not.toHaveBeenCalled();
  expect(test.items).toHaveLength(2);
});
```

Identify screenshot-recovery children structurally: `recoveryOfItemId === original.id`, source is `chatgpt_web`, `pendingImages` is empty, and the child has an attachment whose `clientId` starts with `recovery-screenshot-`. Do not treat ordinary manual recaptures as screenshot children.

- [ ] **Step 3: Run the focused tests and verify failure**

Run:

```bash
pnpm vitest run apps/extension/lib/background-controller.test.ts
```

Expected: the complete-draft assertions fail because the current implementation inherits `partial`, `missingElements`, and existing attachments; the duplicate test fails because another screenshot child is created.

- [ ] **Step 4: Build a fresh complete recovery draft**

Change `screenshotRecoveryDraft` to preserve only original non-attachment content and the newly captured screenshot:

```ts
function screenshotRecoveryDraft(
  original: OutboxItem,
  attachment: CaptureDraft["attachments"][number],
): CaptureDraft {
  return {
    ...original.draft,
    attachments: [attachment],
    completeness: "complete",
    missingElements: [],
    pendingImages: [],
  };
}
```

The source version still contains the original messages; only attachments and completeness metadata are replaced for the recovery attempt.

- [ ] **Step 5: Return an existing screenshot-recovery child before capture**

Add a narrow predicate and use the existing Outbox list before calling `captureVisibleTab`:

```ts
function isScreenshotRecoveryChild(
  item: OutboxItem,
  originalId: string,
): boolean {
  return (
    item.recoveryOfItemId === originalId &&
    item.draft.source === "chatgpt_web" &&
    item.draft.pendingImages.length === 0 &&
    item.draft.attachments.some((attachment) =>
      attachment.clientId.startsWith("recovery-screenshot-"),
    )
  );
}
```

At the start of `addScreenshotRecovery`, after validating the original partial receipt:

```ts
const existingRecovery = (await dependencies.outbox.list()).find((item) =>
  isScreenshotRecoveryChild(item, original.id),
);
if (existingRecovery !== undefined) {
  return existingRecovery;
}
```

This is a local idempotency guard. It must run before reading the active tab or capturing pixels.

- [ ] **Step 6: Keep size validation scoped to the new screenshot**

Because the fresh recovery draft contains exactly one attachment, remove inheritance-based count and total-byte checks from `addScreenshotRecovery`. Keep the single screenshot check:

```ts
if (blob.size > 10 * 1024 * 1024) {
  throw new Error("截图超过 10 MiB");
}
```

The one-attachment recovery is necessarily below the 50-attachment and 100 MiB aggregate limits once this check passes.

- [ ] **Step 7: Run focused extension tests**

Run:

```bash
pnpm vitest run apps/extension/lib/background-controller.test.ts apps/extension/entrypoints/popup/App.test.tsx apps/extension/lib/capture-runner.test.ts
```

Expected: all tests pass; popup tests still prove success is rendered only from a stored server receipt and screenshot errors keep the original partial receipt visible.

- [ ] **Step 8: Run extension verification**

Run:

```bash
pnpm --filter @recall/extension typecheck
pnpm --filter @recall/extension build
pnpm vitest run apps/extension
git diff --check
```

Inspect `apps/extension/.output/chrome-mv3/manifest.json` and confirm Manifest V3, permissions, and host permissions are unchanged. Run:

```bash
rg -n "SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|secret-token" apps/extension/.output
```

Expected: no secret matches.

- [ ] **Step 9: Review and commit the code fix**

Review the diff to confirm only the background controller and its tests changed. Commit:

```bash
git add apps/extension/lib/background-controller.ts apps/extension/lib/background-controller.test.ts
git commit -m "fix: complete screenshot recovery once"
```

- [ ] **Step 10: Perform the real Chrome retest**

Reload `apps/extension/.output/chrome-mv3` in Chrome, refresh the existing ChatGPT conversation, and create one fresh partial capture if the old item already has recovery children. Click “补充截图” once with the test image visible.

Expected:

- popup changes from partial to complete only after the stored server receipt;
- receipt reports six messages and one attachment;
- extension unresolved count becomes zero;
- the same Web SourceItem gains one new complete version with one PNG attachment and no missing-elements list;
- Web exception count becomes zero;
- a second click is unavailable, and reopening the popup does not create another recovery version.

Record the result in `docs/runbooks/milestone-a-acceptance.md` without deleting the failed versions 5–11, then create a separate evidence commit.
