"use client";

import { StartPairingResultSchema } from "@recall/contracts";
import { useEffect, useState } from "react";

function secondsUntil(expiresAt: string) {
  return Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function PairingPanel() {
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pairing) {
      return;
    }

    const updateCountdown = () => {
      setRemainingSeconds(secondsUntil(pairing.expiresAt));
    };
    const intervalId = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(intervalId);
  }, [pairing]);

  async function createCode() {
    setErrorMessage(null);
    setIsCreating(true);

    try {
      const response = await fetch("/api/extension/pairing/start", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("pairing start failed");
      }

      const result = StartPairingResultSchema.parse(await response.json());
      setPairing(result);
      setRemainingSeconds(secondsUntil(result.expiresAt));
    } catch {
      setErrorMessage("暂时无法生成配对码，请稍后重试。");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">配对浏览器扩展</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        生成一次性配对码，然后在扩展中输入。配对码十分钟后失效。
      </p>

      {pairing && remainingSeconds > 0 ? (
        <div className="mt-6 rounded-2xl bg-slate-950 p-6 text-white">
          <p className="text-xs tracking-[0.18em] text-slate-400">
            一次性配对码
          </p>
          <output
            aria-label="一次性配对码"
            className="mt-3 block font-mono text-3xl font-semibold tracking-[0.25em]"
          >
            {pairing.code}
          </output>
          <p className="mt-3 text-sm text-slate-300">
            剩余 {formatCountdown(remainingSeconds)}
          </p>
        </div>
      ) : (
        <button
          className="mt-6 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isCreating}
          onClick={createCode}
          type="button"
        >
          {isCreating ? "正在生成…" : "生成配对码"}
        </button>
      )}

      {errorMessage ? (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
