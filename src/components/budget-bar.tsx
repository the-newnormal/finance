import { formatSGD } from "@/lib/money";

export function BudgetBar({ allocated, committed, spent }: { allocated: number; committed: number; spent: number }) {
  const total = Math.max(allocated, spent + committed, 1);
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
  const remaining = allocated - spent - committed;
  return (
    <div className="grid gap-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-ink/8" role="img"
        aria-label={`${formatSGD(spent)} spent, ${formatSGD(committed)} committed of ${formatSGD(allocated)}`}>
        <div className="bg-brand-deep" style={{ width: pct(spent) }} />
        <div className="bg-brand/60" style={{ width: pct(committed) }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        <span><i className="mr-1 inline-block size-2 rounded-full bg-brand-deep" />Disbursed {formatSGD(spent)}</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-brand/60" />Approved {formatSGD(committed)}</span>
        <span className={remaining < 0 ? "font-medium text-danger" : ""}>
          {remaining < 0 ? `Over by ${formatSGD(-remaining)}` : `${formatSGD(remaining)} left`}
        </span>
      </div>
    </div>
  );
}
