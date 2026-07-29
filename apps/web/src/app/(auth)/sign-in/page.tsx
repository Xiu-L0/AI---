"use client";

import { type FormEvent, useState } from "react";

import { createBrowserClient } from "@/lib/supabase/browser";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
          shouldCreateUser: false,
        },
      });

      if (error) {
        setErrorMessage("登录链接发送失败，请稍后重试。");
        return;
      }

      setSent(true);
    } catch {
      setErrorMessage("登录服务暂不可用，请检查本地配置。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold tracking-[0.2em] text-emerald-700">
          RECALL AI
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950">
          登录你的知识库
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          输入已授权的邮箱，我们会发送一次性登录链接。
        </p>

        {sent ? (
          <div
            className="mt-8 rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"
            role="status"
          >
            登录链接已发送，请打开邮箱完成登录。
          </div>
        ) : (
          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label
                className="mb-2 block text-sm font-medium text-slate-800"
                htmlFor="email"
              >
                邮箱
              </label>
              <input
                autoComplete="email"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                id="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </div>

            {errorMessage ? (
              <p className="text-sm text-red-700" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <button
              className="w-full rounded-xl bg-slate-950 px-4 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "正在发送…" : "发送登录链接"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
