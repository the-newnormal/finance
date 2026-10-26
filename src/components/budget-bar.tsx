import { formatSGD } from "@/lib/money";

// How much of a budget is disbursed, approved and (for the reserve) on loan, out of its total.
// What's left is the total less all three. `loaned` is shown only when given.
export function BudgetBar({ allocated, committed, spent, loaned }: { allocated: number; committed: number; spent: number; loaned?: number }) {
  const onLoan = loaned ?? 0;
  const total = Math.max(allocated, spent + committed + onLoan, 1);
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
  const remaining = allocated - spent - committed - onLoan;
  return (
    <div className="grid gap-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-ink/8" role="img"
        aria-label={`${formatSGD(spent)} disbursed, ${formatSGD(committed)} approved${loaned !== undefined ? `, ${formatSGD(onLoan)} on loan` : ""} of ${formatSGD(allocated)}`}>
        <div className="bg-brand-deep" style={{ width: pct(spent) }} />
        <div className="bg-brand/60" style={{ width: pct(committed) }} />
        {loaned !== undefined && <div className="bg-yellow" style={{ width: pct(onLoan) }} />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        <span><i className="mr-1 inline-block size-2 rounded-full bg-brand-deep" />Disbursed {formatSGD(spent)}</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-brand/60" />Approved {formatSGD(committed)}</span>
        {loaned !== undefined && <span><i className="mr-1 inline-block size-2 rounded-full bg-yellow" />On loan {formatSGD(onLoan)}</span>}
        <span className={remaining < 0 ? "font-medium text-danger" : ""}>
          {remaining < 0 ? `Over by ${formatSGD(-remaining)}` : `${formatSGD(remaining)} left`}
        </span>
      </div>
    </div>
  );
}
