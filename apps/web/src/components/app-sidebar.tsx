import Link from "next/link";

type AppSidebarProps = {
  exceptionCount: number;
};

export function AppSidebar({ exceptionCount }: AppSidebarProps) {
  const links = [
    { href: "/", label: "今天" },
    { href: "/captures", label: "采集记录" },
    { href: "/exceptions", label: `异常 ${exceptionCount}` },
    { href: "/settings", label: "设置" },
  ];

  return (
    <aside className="border-b border-slate-200 bg-slate-950 text-white md:min-h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-5 py-5 md:block md:px-7 md:py-8">
        <Link className="text-lg font-semibold tracking-wide" href="/">
          Recall AI
        </Link>
        <span className="text-xs text-slate-400 md:mt-1 md:block">
          可靠采集
        </span>
      </div>
      <nav
        aria-label="主导航"
        className="flex gap-1 overflow-x-auto px-3 pb-4 md:block md:space-y-2 md:px-4"
      >
        {links.map((link) => (
          <Link
            className="block whitespace-nowrap rounded-xl px-4 py-3 text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
