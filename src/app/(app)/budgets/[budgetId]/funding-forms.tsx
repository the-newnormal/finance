"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { assignGrant, loanFromReserve, recordGrant, repayReserve, setGrantCommitment, type FundingResult } from "./funding-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { formatDate, formatSGD } from "@/lib/money";

export interface FundingAccount { account_id: string; name: string; bank: string; last4: string }
export interface UnassignedGrant { id: number; amount_cents: number; entry_date: string; note: string | null }

type Action = "grant" | "assign" | "loan" | "repay" | "commit";

const TITLE: Record<Action, string> = {
  grant: "Record a grant received",
  assign: "Assign a grant already on the Bank page",
  loan: "Take a loan from the reserve",
  repay: "Repay the reserve",
  commit: "Set the grant committed",
};

// Finance's funding forms for one budget. The database checks every amount (the reserve has it to
// lend, the budget owes it and has it to repay); what's shown here is only a guide.
export function FundingForms({ budgetId, today, accounts, reserveAvailable, owed, committed, unassignedGrants }: {
  budgetId: string;
  today: string;
  accounts: FundingAccount[];
  reserveAvailable: number | null;
  owed: number;
  committed: number;
  unassignedGrants: UnassignedGrant[];
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action>("grant");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Bumped after each save: remounts the form's fields empty, keeping the chosen action (a plain
  // form.reset() would put the controlled menu's option back to the first while action kept its value).
  const [round, setRound] = useState(0);

  const hint = {
    grant: "The money lands in the bank account you choose and on this budget's balance.",
    assign: unassignedGrants.length ? "The whole grant, as recorded on the Bank page, is added to this budget's balance." : "Every grant on the Bank page is already assigned to a budget.",
    loan: reserveAvailable === null ? "The reserve's balance couldn't be read." : `The reserve has ${formatSGD(reserveAvailable)} available to lend.`,
    repay: owed > 0 ? `This budget owes the reserve ${formatSGD(owed)}.` : "This budget owes the reserve nothing.",
    commit: `Currently ${formatSGD(committed)}. Used only to show what's still to come.`,
  }[action];

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const s = (k: string) => String(fd.get(k) ?? "");
        const done = action;
        start(async () => {
          setError(null);
          setSaved(null);
          const fund = { budget: budgetId, amount: s("amount"), date: s("date"), note: s("note") };
          let res: FundingResult;
          if (done === "grant") res = await recordGrant({ ...fund, account: s("account") });
          else if (done === "assign") res = await assignGrant({ budget: budgetId, entry: s("entry"), note: s("note") });
          else if (done === "loan") res = await loanFromReserve(fund);
          else if (done === "repay") res = await repayReserve(fund);
          else res = await setGrantCommitment({ budget: budgetId, amount: s("amount") });
          if (!res.ok) return setError(res.error);
          setRound((r) => r + 1);
          setSaved("Saved.");
          router.refresh();
        });
      }}
    >
      <Field label="What happened">
        <Select value={action} onChange={(e) => { setAction(e.target.value as Action); setError(null); setSaved(null); }}>
          {(Object.keys(TITLE) as Action[]).map((a) => <option key={a} value={a}>{TITLE[a]}</option>)}
        </Select>
      </Field>
      <p className="text-xs text-ink-soft">{hint}</p>
      <div key={round} className="grid gap-4 sm:grid-cols-2">
        {action === "assign" && (
          <Field label="Grant" className="sm:col-span-2">
            <Select name="entry" required defaultValue="">
              <option value="" disabled>Choose a grant</option>
              {unassignedGrants.map((g) => (
                <option key={g.id} value={g.id}>{formatDate(g.entry_date)} · {formatSGD(Number(g.amount_cents))}{g.note ? ` · ${g.note}` : ""}</option>
              ))}
            </Select>
          </Field>
        )}
        {action === "grant" && (
          <Field label="Arrived in" className="sm:col-span-2">
            <Select name="account" required defaultValue="">
              <option value="" disabled>Choose an account</option>
              {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.name} · {a.bank} ····{a.last4}</option>)}
            </Select>
          </Field>
        )}
        {action !== "assign" && (
          <Field label={action === "commit" ? "Grant committed (SGD)" : "Amount (SGD)"}>
            <Input key={action} name="amount" inputMode="decimal" placeholder="0.00" required
              defaultValue={action === "commit" ? (committed / 100).toFixed(2) : undefined} />
          </Field>
        )}
        {action !== "commit" && (
          <>
            {action !== "assign" && <Field label="Date"><Input name="date" type="date" max={today} defaultValue={today} required /></Field>}
            <Field label="Note" className="sm:col-span-2">
              <Input name="note" required minLength={3} maxLength={300}
                placeholder={action === "grant" || action === "assign" ? "e.g. First tranche of the grant" : action === "loan" ? "e.g. Until the grant arrives" : "e.g. Grant received"} />
            </Field>
          </>
        )}
      </div>
      {action === "grant" && accounts.length === 0 && <Alert tone="info">Add a bank account on the Bank page first.</Alert>}
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}
      <Button type="submit" className="justify-self-start" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}
