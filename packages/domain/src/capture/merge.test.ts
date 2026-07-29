import { describe, expect, it } from "vitest";
import { DuplicateMessageIdError, mergeMessages } from "./merge";

describe("mergeMessages", () => {
  it("keeps existing messages and appends only new ids", () => {
    const previous = [
      { externalMessageId: "m1", role: "user" as const, text: "Q", ordinal: 0 }
    ];
    const incoming = [
      { externalMessageId: "m1", role: "user" as const, text: "Q", ordinal: 0 },
      { externalMessageId: "m2", role: "assistant" as const, text: "A", ordinal: 1 }
    ];

    const result = mergeMessages(previous, incoming);

    expect(result).toEqual({
      messages: [previous[0], incoming[1]],
      appendedIds: ["m2"],
      changedIds: []
    });
    expect(result.messages[0]).toBe(previous[0]);
  });

  it("replaces changed text or role", () => {
    const result = mergeMessages(
      [
        {
          externalMessageId: "m1",
          role: "assistant",
          text: "old",
          ordinal: 0
        }
      ],
      [
        {
          externalMessageId: "m1",
          role: "user",
          text: "new",
          ordinal: 1
        }
      ]
    );

    expect(result.messages[0]).toMatchObject({ role: "user", text: "new" });
    expect(result.changedIds).toEqual(["m1"]);
  });

  it("retains the previous message when only ordinal changes", () => {
    const previous = {
      externalMessageId: "m1",
      role: "user" as const,
      text: "same",
      ordinal: 2
    };
    const result = mergeMessages(
      [previous],
      [{ ...previous, ordinal: 99 }]
    );

    expect(result.messages[0]).toBe(previous);
    expect(result.changedIds).toEqual([]);
  });

  it("uses the message id as a deterministic ordinal tie-breaker", () => {
    const result = mergeMessages([], [
      { externalMessageId: "z", role: "user", text: "z", ordinal: 0 },
      { externalMessageId: "a", role: "assistant", text: "a", ordinal: 0 }
    ]);

    expect(result.messages.map((message) => message.externalMessageId)).toEqual([
      "a",
      "z"
    ]);
  });

  it("rejects duplicate ids instead of silently choosing a message", () => {
    expect(() =>
      mergeMessages(
        [
          { externalMessageId: "m1", role: "user", text: "one", ordinal: 0 },
          { externalMessageId: "m1", role: "user", text: "two", ordinal: 1 }
        ],
        []
      )
    ).toThrow(DuplicateMessageIdError);
  });
});
