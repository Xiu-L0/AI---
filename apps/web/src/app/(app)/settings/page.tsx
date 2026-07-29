import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PairingPanel } from "@/features/extension/components/pairing-panel";
import {
  listExtensionTokens,
  revokeExtensionToken,
} from "@/features/extension/server/pairing";
import { requireUser } from "@/lib/supabase/server";

const TokenIdSchema = z.string().uuid();

function formatDate(value: string | null) {
  if (!value) {
    return "从未使用";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function SettingsPage() {
  const user = await requireUser();
  const tokens = await listExtensionTokens(user.id);

  async function revokeToken(formData: FormData) {
    "use server";

    const tokenId = TokenIdSchema.safeParse(formData.get("tokenId"));
    if (!tokenId.success) {
      return;
    }

    const currentUser = await requireUser();
    await revokeExtensionToken(currentUser.id, tokenId.data);
    revalidatePath("/settings");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-10 lg:px-10">
      <div>
        <p className="text-sm font-medium text-emerald-700">设置</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          浏览器扩展
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          配对凭据只会在扩展首次交换时显示，服务器只保存不可逆哈希。
        </p>
      </div>

      <PairingPanel />

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">已配对设备</h2>

        {tokens.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">目前没有已配对设备。</p>
        ) : (
          <ul className="mt-5 divide-y divide-slate-200">
            {tokens.map((token) => {
              const isExpired = new Date(token.expiresAt) <= new Date();
              const isRevoked = token.revokedAt !== null;

              return (
                <li
                  className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between"
                  key={token.id}
                >
                  <div>
                    <p className="font-medium text-slate-950">{token.label}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      最后使用：{formatDate(token.lastUsedAt)}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {isRevoked
                        ? `已撤销：${formatDate(token.revokedAt)}`
                        : isExpired
                          ? `已过期：${formatDate(token.expiresAt)}`
                          : `到期：${formatDate(token.expiresAt)}`}
                    </p>
                  </div>

                  {!isRevoked && !isExpired ? (
                    <form action={revokeToken}>
                      <input name="tokenId" type="hidden" value={token.id} />
                      <button
                        className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
                        type="submit"
                      >
                        撤销
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
