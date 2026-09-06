import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { listExceptions } from "@/features/capture/server/list-exceptions";
import { ensureDefaultPrivateSpace } from "@/features/spaces/server/default-space";
import { requireUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  await ensureDefaultPrivateSpace(user.id);
  const exceptions = await listExceptions(user.id);

  return (
    <div className="min-h-screen md:flex">
      <AppSidebar exceptionCount={exceptions.length} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
