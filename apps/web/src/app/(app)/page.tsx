import Link from "next/link";

const overviewCards = [
  {
    description: "今天保存的原始资料会显示在这里。",
    title: "今日采集",
    value: "0",
  },
  {
    description: "原文保存成功后，后台任务会独立排队。",
    title: "等待后台处理",
    value: "0",
  },
  {
    description: "部分采集与失败记录不会静默消失。",
    title: "未恢复异常",
    value: "0",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">今天</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            先可靠保存，再慢慢整理
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Milestone A 只关注原始资料是否完整、持久地保存。
          </p>
        </div>
        <Link
          className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-800"
          href="/captures/new"
        >
          快速添加
        </Link>
      </div>

      <section
        aria-label="今日概览"
        className="mt-10 grid gap-5 md:grid-cols-3"
      >
        {overviewCards.map((card) => (
          <article
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            key={card.title}
          >
            <p className="text-sm font-medium text-slate-600">{card.title}</p>
            <p className="mt-4 text-4xl font-semibold text-slate-950">
              {card.value}
            </p>
            <p className="mt-4 text-sm leading-6 text-slate-500">
              {card.description}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8">
        <h2 className="text-lg font-semibold text-slate-900">暂无待处理事项</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          完成第一次采集后，可靠保存结果和异常恢复入口会出现在这里。
        </p>
      </section>
    </div>
  );
}
