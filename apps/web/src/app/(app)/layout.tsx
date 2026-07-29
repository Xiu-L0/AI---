import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { requireUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();

  return (
    <div className="min-h-screen md:flex">
      <AppSidebar exceptionCount={0} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
