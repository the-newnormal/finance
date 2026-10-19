"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { formatDate, formatSGD, parseBudgetToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { addAccount, recordEntry, setAccountActive, transfer, type BankResult } from "./actions";

export type Account = {
  account_id: string;
  name: string;
  bank: string;
  last4: string;
  active: boolean;
  balance_cents: number;
  last_entry_date: string | null;
};

export type Entry = {
  id: number;
  account_id: string;
  kind: "opening" | "grant" | "payout" | "adjustment" | "transfer_in" | "transfer_out";
  amount_cents: number;
  entry_date: string;
  note: string | null;
  actor_name: string;
  created_at: string;
};

const KIND_LABEL: Record<Entry["kind"], string> = {
  opening: "Opening balance",
  grant: "Grant / income",
  payout: "Claim paid",
  adjustment: "Adjustment",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
};

type Form = {
  kind: "grant" | "adjustment" | "transfer" | "account";
  accountId?: string;
  direction?: "in" | "out";
  amount?: string;
  note?: string;
  /** Set by "Record as adjustment": the balance the difference was computed from. */
  expectedBalanceCents?: number;
};

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<BankResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.error);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  return { pending, error, run };
}

export function BankManager({ accounts, entries, ledger, today }: {
  accounts: Account[];
  entries: Entry[];
  ledger: { account: string | null; page: number; hasOlder: boolean };
  today: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(accounts.length ? null : { kind: "account" });
  const active = accounts.filter((a) => a.active);
  const name = (id: string) => accounts.find((a) => a.account_id === id)?.name ?? "—";
  const visible = entries;
  const go = (account: string | null, page: number) => {
    const q = new URLSearchParams();
    if (account) q.set("account", account);
    if (page) q.set("page", String(page));
    router.push(`/bank${q.size ? `?${q}` : ""}`);
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        {accounts.map((a) => (
          <AccountCard key={a.account_id} account={a}
            onAdjust={(cents) => setForm({ kind: "adjustment", accountId: a.account_id, direction: cents > 0 ? "in" : "out",
              amount: (Math.abs(cents) / 100).toFixed(2), note: "Match DBS balance", expectedBalanceCents: a.balance_cents })} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="soft" onClick={() => setForm({ kind: "grant" })} disabled={!active.length}><Plus /> Grant / income</Button>
        <Button variant="outline" onClick={() => setForm({ kind: "adjustment" })} disabled={!active.length}>Adjustment</Button>
        <Button variant="outline" onClick={() => setForm({ kind: "transfer" })} disabled={active.length < 2}>Transfer between accounts</Button>
        <Button variant="ghost" onClick={() => setForm({ kind: "account" })}>Add an account</Button>
      </div>

      {form && <EntryForm key={JSON.stringify(form)} form={form} accounts={active} today={today} onDone={() => setForm(null)} />}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Ledger</CardTitle>
          <Select className="max-w-60" value={ledger.account ?? "all"} onChange={(e) => go(e.target.value === "all" ? null : e.target.value, 0)} aria-label="Show entries for">
            <option value="all">All accounts</option>
            {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
          </Select>
        </CardHeader>
        <CardContent>
          {visible.length ? (
            <Table>
              <THead><tr><TH>Date</TH><TH>Account</TH><TH>What</TH><TH>Note</TH><TH className="text-right">Amount</TH><TH>By</TH></tr></THead>
              <TBody>
                {visible.map((e) => (
                  <tr key={e.id}>
                    <TD className="whitespace-nowrap text-ink-soft">{formatDate(e.entry_date)}</TD>
                    <TD className="whitespace-nowrap">{name(e.account_id)}</TD>
                    <TD className="whitespace-nowrap">{KIND_LABEL[e.kind]}</TD>
                    <TD className="min-w-40 text-ink-soft">{e.note}</TD>
                    <TD className={cn("whitespace-nowrap text-right tabular-nums", e.amount_cents < 0 ? "text-danger" : "text-brand-deep")}>
                      {e.amount_cents > 0 ? "+" : "−"}{formatSGD(Math.abs(e.amount_cents))}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-soft">{e.actor_name}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-ink-soft">Nothing recorded yet.</p>
          )}
          {(ledger.page > 0 || ledger.hasOlder) && (
            <div className="flex justify-center gap-2 pt-4">
              <Button size="sm" variant="outline" disabled={ledger.page === 0} onClick={() => go(ledger.account, ledger.page - 1)}>Newer</Button>
              <Button size="sm" variant="outline" disabled={!ledger.hasOlder} onClick={() => go(ledger.account, ledger.page + 1)}>Older</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AccountCard({ account: a, onAdjust }: { account: Account; onAdjust: (cents: number) => void }) {
  const { pending, error, run } = useAction();
  const [dbs, setDbs] = useState("");
  // parseBudgetToCents: a balance can be zero.
  const dbsCents = dbs.trim() === "" ? null : parseBudgetToCents(dbs.trim().replace(/^-/, ""));
  const signedDbs = dbsCents === null ? null : dbs.trim().startsWith("-") ? -dbsCents : dbsCents;
  const diff = signedDbs === null ? null : signedDbs - a.balance_cents;

  return (
    <Card className={cn("p-5", !a.active && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{a.name}</div>
          <div className="text-xs text-ink-soft">{a.bank} •••• {a.last4}{!a.active && " · Closed"}</div>
        </div>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setAccountActive(a.account_id, !a.active))}>
          {a.active ? "Close" : "Reopen"}
        </Button>
      </div>
      <div className="mt-3 text-xs uppercase tracking-wide text-ink-soft">Expected balance</div>
      <div className="font-serif text-3xl font-semibold tabular-nums">{formatSGD(a.balance_cents)}</div>
      <div className="text-xs text-ink-soft">Last entry {formatDate(a.last_entry_date)}</div>
      {error && <Alert className="mt-3">{error}</Alert>}
      {a.active && (
        <div className="mt-4 grid gap-2 border-t border-line pt-4">
          <Field label="Balance in DBS iBanking" hint="Type it in to compare. Nothing is saved.">
            <Input inputMode="decimal" value={dbs} onChange={(e) => setDbs(e.target.value)} placeholder="0.00" />
          </Field>
          {diff !== null && (
            diff === 0 ? (
              <Alert tone="success">Matches.</Alert>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-yellow/40 px-3 py-2 text-sm">
                <span>DBS is {formatSGD(Math.abs(diff))} {diff > 0 ? "higher" : "lower"}.</span>
                <Button size="sm" variant="outline" onClick={() => onAdjust(diff)}>Record as adjustment</Button>
              </div>
            )
          )}
          {dbs.trim() !== "" && signedDbs === null && <p className="text-xs text-danger">Enter an amount like 12500.00.</p>}
        </div>
      )}
    </Card>
  );
}

function EntryForm({ form, accounts, today, onDone }: { form: Form; accounts: Account[]; today: string; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const [v, setV] = useState({
    accountId: form.accountId ?? (accounts.length === 1 ? accounts[0].account_id : ""),
    to: "",
    direction: form.direction ?? ("in" as "in" | "out"),
    amount: form.amount ?? "",
    date: today,
    note: form.note ?? "",
    name: "", bank: "DBS", last4: "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const accountSelect = (label: string, key: "accountId" | "to") => (
    <Field label={label}>
      <Select value={v[key]} onChange={set(key)} required>
        <option value="" disabled>Choose…</option>
        {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.name} (•••• {a.last4})</option>)}
      </Select>
    </Field>
  );
  const titles = { grant: "Record a grant or income", adjustment: "Record an adjustment", transfer: "Transfer between accounts", account: "Add a bank account" };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.kind === "account") return run(() => addAccount({ name: v.name, bank: v.bank, last4: v.last4, opening: v.amount, asOf: v.date }), onDone);
    if (form.kind === "transfer") return run(() => transfer({ from: v.accountId, to: v.to, amount: v.amount, date: v.date, note: v.note }), onDone);
    // The DBS shortcut's balance only holds while its account and amount are unchanged.
    const expected = form.expectedBalanceCents !== undefined && v.accountId === form.accountId && v.amount === form.amount
      ? form.expectedBalanceCents : undefined;
    run(() => recordEntry({ accountId: v.accountId, kind: form.kind as "grant" | "adjustment", direction: v.direction,
      amount: v.amount, date: v.date, note: v.note, expectedBalanceCents: expected }), onDone);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titles[form.kind]}</CardTitle>
        {form.kind === "adjustment" && <CardDescription>For bank fees, interest or anything else that makes the expected balance differ from DBS.</CardDescription>}
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {form.kind === "account" ? (
            <>
              <Field label="Name" hint="e.g. DBS Joint Account A"><Input required maxLength={80} value={v.name} onChange={set("name")} /></Field>
              <Field label="Bank"><Input required maxLength={40} value={v.bank} onChange={set("bank")} /></Field>
              <Field label="Last four digits" hint="Never the full account number."><Input required inputMode="numeric" pattern="\d{4}" maxLength={4} value={v.last4} onChange={set("last4")} /></Field>
              <Field label="Opening balance (SGD)"><Input required inputMode="decimal" value={v.amount} onChange={set("amount")} placeholder="0.00" /></Field>
              <Field label="Balance as of"><Input type="date" required max={today} value={v.date} onChange={set("date")} /></Field>
            </>
          ) : (
            <>
              {accountSelect(form.kind === "transfer" ? "From" : "Account", "accountId")}
              {form.kind === "transfer" && accountSelect("To", "to")}
              {form.kind === "adjustment" && (
                <Field label="Direction">
                  <Select value={v.direction} onChange={set("direction")}>
                    <option value="in">Add to the balance</option>
                    <option value="out">Take off the balance</option>
                  </Select>
                </Field>
              )}
              <Field label="Amount (SGD)"><Input required inputMode="decimal" value={v.amount} onChange={set("amount")} placeholder="0.00" /></Field>
              <Field label="Date"><Input type="date" required max={today} value={v.date} onChange={set("date")} /></Field>
              <Field label={form.kind === "transfer" ? "Note (optional)" : "Note"} className="sm:col-span-2"
                hint={form.kind === "grant" ? "e.g. NAC grant tranche 2" : form.kind === "adjustment" ? "Why, e.g. DBS service fee" : undefined}>
                <Input required={form.kind !== "transfer"} minLength={form.kind === "transfer" ? undefined : 3} maxLength={300} value={v.note} onChange={set("note")} />
              </Field>
            </>
          )}
          {error && <Alert className="sm:col-span-2">{error}</Alert>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
