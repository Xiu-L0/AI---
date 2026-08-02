# ChatGPT Message Image Capture Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a real ChatGPT message attachment rendered as `button > img` is captured as an attachment or honestly reported as missing, never silently omitted from a complete receipt.

**Architecture:** Keep the existing extraction, scoped-draft, attachment preparation, upload, and durable-finalize pipeline. Narrow only the image exclusion rule at the extraction boundary, then rely on the existing URL, MIME, size, signature, hashing, partial-capture, and Outbox behavior.

**Tech Stack:** TypeScript, WXT Manifest V3, JSDOM, Vitest, pnpm.

## Global Constraints

- Milestone A reliable capture only; no OCR, AI image understanding, or new platform support.
- Preserve every existing user modification and database record; do not reset, checkout, clean, delete, or rewrite history.
- A ChatGPT image that cannot be saved must produce `partial` with a concrete missing element.
- `complete` is allowed only after expected message images are either durably saved or proven absent.
- Keep current attachment limits, MIME allowlist, RLS, Outbox, and two-phase finalize protocol unchanged.
- Use the production extension build for the real Chrome retest.

---

## File Structure

- Modify `apps/extension/lib/chatgpt/extract.ts`: define which message images are interface decoration versus capture candidates.
- Modify `apps/extension/lib/chatgpt/extract.test.ts`: reproduce the real ChatGPT `button > img` attachment structure and protect explicit icon exclusions.
- Modify `docs/runbooks/milestone-a-acceptance.md`: record the failed original sample and the repair retest without removing the failure from the denominator.

### Task 1: Recognize Real Message Attachment Thumbnails

**Files:**
- Modify: `apps/extension/lib/chatgpt/extract.ts`
- Test: `apps/extension/lib/chatgpt/extract.test.ts`

**Interfaces:**
- Consumes: `extractChatGptConversation(document: Document, url: URL): ChatGptExtraction`.
- Produces: unchanged `ChatGptExtraction.images: ChatGptImage[]`; a message-owned `button > img` becomes a normal `ChatGptImage` while explicit UI decoration remains excluded.

- [ ] **Step 1: Write the failing regression test**

Add this case to `extract.test.ts`:

```ts
it("captures a ChatGPT attachment thumbnail inside a button", () => {
  const dom = new JSDOM(`
    <main>
      <article data-message-author-role="user" data-message-id="with-upload">
        <button type="button">
          <img
            alt="recall-partial-test.png"
            src="https://chatgpt.com/backend-api/estuary/content?id=file_test"
            width="1254"
            height="1254"
          />
        </button>
        test message
      </article>
    </main>
  `);

  const extraction = extractChatGptConversation(
    dom.window.document,
    new URL("https://chatgpt.com/c/with-upload"),
  );

  expect(extraction.images).toEqual([
    {
      alt: "recall-partial-test.png",
      height: 1254,
      messageExternalId: "with-upload",
      messageOrdinal: 0,
      src: "https://chatgpt.com/backend-api/estuary/content?id=file_test",
      width: 1254,
    },
  ]);
});
```

- [ ] **Step 2: Protect explicit interface-image exclusions**

In the same test file, add a message containing visible images marked with `data-testid="conversation-turn-avatar"`, `data-testid="message-feedback-icon"`, `role="presentation"`, and `aria-hidden="true"`. Assert `extraction.images` is empty so removing the broad button rule cannot capture known UI decoration.

- [ ] **Step 3: Run the focused test and verify the new attachment case fails**

Run:

```powershell
.\node_modules\.bin\vitest.CMD run apps/extension/lib/chatgpt/extract.test.ts
```

Expected: the new `button > img` case fails because the current selector contains `button img`; existing cases continue to pass.

- [ ] **Step 4: Implement the minimal selector correction**

In `CHATGPT_SELECTORS.excludedImages`, remove only `button img`. Retain:

```ts
"[aria-hidden='true'], [hidden], [role='presentation'], [data-testid*='avatar'], [data-testid*='feedback'], [data-testid*='icon'], .avatar, [style*='display: none'], [style*='visibility: hidden']"
```

Do not change the message-ownership filter:

```ts
image.closest(CHATGPT_SELECTORS.messageContainers) === container
```

- [ ] **Step 5: Run focused extraction, completeness, and draft tests**

Run:

```powershell
.\node_modules\.bin\vitest.CMD run apps/extension/lib/chatgpt/extract.test.ts apps/extension/lib/chatgpt/completeness.test.ts apps/extension/lib/chatgpt/to-capture-draft.test.ts
```

Expected: all cases pass; readable attachments are retained and unreadable images still create missing elements.

- [ ] **Step 6: Commit the extraction fix**

```powershell
git add apps/extension/lib/chatgpt/extract.ts apps/extension/lib/chatgpt/extract.test.ts
git commit -m "fix: capture ChatGPT message attachments"
```

### Task 2: Validate the Production Extension and Retest the Real Sample

**Files:**
- Modify: `docs/runbooks/milestone-a-acceptance.md`

**Interfaces:**
- Consumes: production output at `apps/extension/.output/chrome-mv3` and the existing real ChatGPT conversation.
- Produces: reproducible automated evidence plus a real Chrome retest entry linked to original attempt 17.

- [ ] **Step 1: Run the full extension verification**

Run:

```powershell
.\node_modules\.bin\vitest.CMD run apps/extension
pnpm --filter @recall/extension typecheck
pnpm --filter @recall/extension build
```

Expected: all extension tests and type checking pass; WXT emits a Manifest V3 build under `apps/extension/.output/chrome-mv3`.

- [ ] **Step 2: Inspect the production manifest and secret surface**

Run:

```powershell
rg -n "SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|secret-token" apps/extension/.output
```

Expected: no secret matches. Confirm `manifest_version` remains `3` and no new permissions or host permissions were introduced.

- [ ] **Step 3: Reload the unpacked production extension**

In `chrome://extensions`, click Reload for Recall AI. Confirm the loaded directory remains `apps/extension/.output/chrome-mv3` and pairing remains active; if Chrome invalidates local state, pair again with a newly generated one-time code.

- [ ] **Step 4: Retest the existing ChatGPT conversation**

Open conversation `6a6f4784-a818-83e8-8b83-1ccc74028ead`, choose “完整会话”, and save once. Accept exactly one of these outcomes:

- `complete`, 6 messages, 1 attachment; or
- `partial`, 6 messages, 0 attachments, with a missing-element entry naming the image in the fifth message.

Reject `complete`, 6 messages, 0 attachments.

- [ ] **Step 5: Verify the Web record**

Open SourceItem `135747a3-a868-4354-8327-8a1b35bec01f`. Confirm a new version contains 6 ordered messages and either one saved attachment or a partial status with a concrete missing element. Confirm the original faulty version 3 remains available as evidence.

- [ ] **Step 6: Update the acceptance record and gate**

Add the retest as a new attempt without deleting attempt 17. If the retest passes, change the image-specific blocking defect to fixed/retested, return the overall conclusion from `FAIL` to `CONDITIONAL`, and continue toward 30 real attempts and Edge smoke. If it fails, keep `FAIL` and record the exact new result.

- [ ] **Step 7: Run final document checks and commit evidence**

Run:

```powershell
git diff --check
git status --short
git add docs/runbooks/milestone-a-acceptance.md
git commit -m "docs: record ChatGPT image capture retest"
```

Expected: no whitespace errors; only intended acceptance evidence is committed.
