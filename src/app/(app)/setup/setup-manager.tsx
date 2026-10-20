"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { formatSGD, parseBudgetToCents } from "@/lib/money";
import { RULE_SCOPE_LABEL, type Budget, type Category, type ClaimRule, type ClaimRuleScope, type Division } from "@/lib/types";
import type { Result } from "../people/actions";
import {
  addCategory, addDivision, deleteClaimRule, saveBudget, saveClaimRule, setBudgetActive, setCategoryActive, setClaimRuleActive,
} from "./actions";

export type BudgetRow = Budget & { guidelines: { category_id: string; guideline_cents: number }[] };

const totalOf = (b: BudgetRow) => b.guidelines.reduce((s, g) => s + g.guideline_cents, 0);

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
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

export function SetupManager({ divisions, categories, budgets, rules }: {
  divisions: Division[]; categories: Category[]; budgets: BudgetRow[]; rules: ClaimRule[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-6">
        <BudgetsCard budgets={budgets} divisions={divisions} categories={categories} />
        <RulesCard rules={rules} />
      </div>
      <div className="grid content-start gap-6">
        <NamedListCard title="Divisions" placeholder="New division" maxLength={80} items={divisions.map((d) => ({ ...d, active: true }))} add={addDivision} />
        <NamedListCard title="Claim categories" placeholder="e.g. Venue costs" maxLength={60} items={categories} add={addCategory}
          toggle={(id, active) => setCategoryActive(id, active)} />
      </div>
    </div>
  );
}

function NamedListCard({ title, placeholder, maxLength, items, add, toggle }: {
  title: string;
  placeholder: string;
  maxLength: number;
  items: { id: string; name: string; active: boolean }[];
  add: (name: string) => Promise<Result>;
  toggle?: (id: string, active: boolean) => Promise<Result>;
}) {
  const { pending, error, run } = useAction();
  const [name, setName] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        {error && <Alert>{error}</Alert>}
        {items.map((i) => (
          <div key={i.id} className={`flex items-center justify-between rounded-lg bg-canvas px-3 py-1.5 text-sm ${i.active ? "" : "opacity-50"}`}>
            {i.name}
            {toggle && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => toggle(i.id, !i.active))}>
                {i.active ? "Hide" : "Show"}
              </Button>
            )}
          </div>
        ))}
        <form className="flex gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); run(() => add(name), () => setName("")); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} required maxLength={maxLength} />
          <Button size="sm" className="h-10" disabled={pending}>Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BudgetsCard({ budgets, divisions, categories }: { budgets: BudgetRow[]; divisions: Division[]; categories: Category[] }) {
  const { pending, error, run } = useAction();
  const [editing, setEditing] = useState<BudgetRow | "new" | null>(null);
  const divisionName = (id: string) => divisions.find((d) => d.id === id)?.name ?? "—";
  const canCreate = divisions.length > 0 && categories.some((c) => c.active);

  return (
    <Card>
      <CardHeader><CardTitle>Budgets &amp; events</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {error && <Alert>{error}</Alert>}
        {budgets.map((b) =>
          editing !== "new" && editing?.id === b.id ? (
            <BudgetForm key={b.id} budget={b} divisions={divisions} categories={categories}
              onDone={() => setEditing((cur) => (cur !== "new" && cur?.id === b.id ? null : cur))} />
          ) : (
            <div key={b.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-line p-4 ${b.active ? "" : "opacity-60"}`}>
              <div className="mr-auto">
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-ink-soft">
                  {divisionName(b.division_id ?? "")} · {b.kind === "event" ? "Event" : "General"} · {formatSGD(totalOf(b))} across{" "}
                  {b.guidelines.length} {b.guidelines.length === 1 ? "category" : "categories"}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(b)}>Edit</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setBudgetActive(b.id, !b.active))}>
                {b.active ? "Close" : "Reopen"}
              </Button>
            </div>
          ),
        )}
        {editing === "new" ? (
          <BudgetForm budget={null} divisions={divisions} categories={categories} onDone={() => setEditing((cur) => (cur === "new" ? null : cur))} />
        ) : (
          <Button variant="soft" onClick={() => setEditing("new")} disabled={!canCreate}>
            <Plus /> New budget or event
          </Button>
        )}
        {!canCreate && <p className="text-xs text-ink-soft">Add a division and a claim category first.</p>}
      </CardContent>
    </Card>
  );
}

type GuidelineDraft = { key: number; categoryId: string; amount: string };

function BudgetForm({ budget, divisions, categories, onDone }: {
  budget: BudgetRow | null; divisions: Division[]; categories: Category[]; onDone: () => void;
}) {
  const { pending, error, run } = useAction();
  const [v, setV] = useState({
    name: budget?.name ?? "",
    kind: budget?.kind ?? ("event" as Budget["kind"]),
    divisionId: budget?.division_id ?? divisions[0]?.id ?? "",
    active: budget?.active ?? true,
  });
  const [nextKey, setNextKey] = useState(budget?.guidelines.length ?? 1);
  const [rows, setRows] = useState<GuidelineDraft[]>(() =>
    budget?.guidelines.length
      ? budget.guidelines.map((g, i) => ({ key: i, categoryId: g.category_id, amount: (g.guideline_cents / 100).toFixed(2) }))
      : [{ key: 0, categoryId: "", amount: "" }],
  );
  // Active categories, plus any inactive one this budget already provisions (so editing keeps it).
  const choosable = categories.filter((c) => c.active || rows.some((r) => r.categoryId === c.id));
  const total = rows.reduce((s, r) => s + (parseBudgetToCents(r.amount) ?? 0), 0);
  const setRow = (key: number, patch: Partial<GuidelineDraft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form className="grid w-full gap-4 rounded-xl border border-line bg-canvas/60 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveBudget(budget?.id ?? null, { ...v, guidelines: rows.map(({ categoryId, amount }) => ({ categoryId, amount })) }), onDone);
      }}>
      <Field label="Name" className="sm:col-span-2">
        <Input required maxLength={100} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Community Iftar 2026" />
      </Field>
      <Field label="Type">
        <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Budget["kind"] })}>
          <option value="event">Event</option>
          <option value="general">General budget</option>
        </Select>
      </Field>
      <Field label="Division">
        <Select value={v.divisionId} onChange={(e) => setV({ ...v, divisionId: e.target.value })}>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Field>
      <Field label="Status">
        <Select value={v.active ? "open" : "closed"} onChange={(e) => setV({ ...v, active: e.target.value === "open" })}>
          <option value="open">Open for claims</option>
          <option value="closed">Closed</option>
        </Select>
      </Field>

      <div className="grid gap-2 sm:col-span-2">
        <div className="text-sm font-medium">Spend guidelines</div>
        {rows.map((r) => (
          <div key={r.key} className="flex gap-2">
            <Select aria-label="Category" required value={r.categoryId} onChange={(e) => setRow(r.key, { categoryId: e.target.value })}>
              <option value="" disabled>Choose a category</option>
              {choosable.map((c) => (
                <option key={c.id} value={c.id} disabled={r.categoryId !== c.id && rows.some((o) => o.categoryId === c.id)}>
                  {c.name}{c.active ? "" : " (hidden)"}
                </option>
              ))}
            </Select>
            <Input aria-label="Guideline (SGD)" required inputMode="decimal" placeholder="0.00" className="w-36"
              value={r.amount} onChange={(e) => setRow(r.key, { amount: e.target.value })} />
            <Button type="button" size="sm" variant="ghost" className="h-10" aria-label="Remove category"
              disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((o) => o.key !== r.key))}>
              <X />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="soft" disabled={rows.length >= choosable.length}
            onClick={() => { setRows((rs) => [...rs, { key: nextKey, categoryId: "", amount: "" }]); setNextKey((k) => k + 1); }}>
            <Plus /> Add category
          </Button>
          <span className="text-sm text-ink-soft">Total <span className="font-medium text-ink tabular-nums">{formatSGD(total)}</span></span>
        </div>
      </div>

      {error && <Alert className="sm:col-span-2">{error}</Alert>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

// The rules the claim form shows, in order. Plain text: what Finance types is what claimants see.
function RulesCard({ rules }: { rules: ClaimRule[] }) {
  const { pending, error, run } = useAction();
  const [editing, setEditing] = useState<ClaimRule | "new" | null>(null);
  const nextOrder = Math.min(1000, (rules.at(-1)?.sort_order ?? 0) + 10);

  return (
    <Card>
      <CardHeader><CardTitle>Claim rules</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-ink-soft">Shown on the claim form, in this order. Each one is for every claim, reimbursements only or vendor invoices only.</p>
        {error && <Alert>{error}</Alert>}
        {rules.map((r) =>
          editing !== "new" && editing?.id === r.id ? (
            <RuleForm key={r.id} rule={r} nextOrder={nextOrder}
              onDone={() => setEditing((cur) => (cur !== "new" && cur?.id === r.id ? null : cur))} />
          ) : (
            <div key={r.id} className={`flex flex-wrap items-start gap-3 rounded-xl border border-line p-4 ${r.active ? "" : "opacity-60"}`}>
              <div className="mr-auto min-w-0 flex-1">
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-ink-soft">{RULE_SCOPE_LABEL[r.applies_to]}{r.active ? "" : " · Hidden"}</div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-ink-soft">{r.body}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setClaimRuleActive(r.id, !r.active))}>
                {r.active ? "Hide" : "Show"}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending}
                onClick={() => { if (confirm(`Delete "${r.title}"? This can't be undone; hide it instead to keep it.`)) run(() => deleteClaimRule(r.id)); }}>
                Delete
              </Button>
            </div>
          ),
        )}
        {editing === "new" ? (
          <RuleForm rule={null} nextOrder={nextOrder} onDone={() => setEditing((cur) => (cur === "new" ? null : cur))} />
        ) : (
          <Button variant="soft" onClick={() => setEditing("new")}><Plus /> New rule</Button>
        )}
      </CardContent>
    </Card>
  );
}

function RuleForm({ rule, nextOrder, onDone }: { rule: ClaimRule | null; nextOrder: number; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const [v, setV] = useState({
    title: rule?.title ?? "",
    body: rule?.body ?? "",
    appliesTo: rule?.applies_to ?? ("all" as ClaimRuleScope),
    linkLabel: rule?.link_label ?? "",
    linkUrl: rule?.link_url ?? "",
    sortOrder: String(rule?.sort_order ?? nextOrder),
  });
  return (
    <form className="grid w-full gap-4 rounded-xl border border-line bg-canvas/60 p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveClaimRule(rule?.id ?? null, { ...v, sortOrder: Number(v.sortOrder), active: rule?.active ?? true }), onDone);
      }}>
      <Field label="Title" className="sm:col-span-2">
        <Input required maxLength={100} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. What your receipt must show" />
      </Field>
      <Field label="For">
        <Select value={v.appliesTo} onChange={(e) => setV({ ...v, appliesTo: e.target.value as ClaimRuleScope })}>
          {(Object.keys(RULE_SCOPE_LABEL) as ClaimRuleScope[]).map((s) => <option key={s} value={s}>{RULE_SCOPE_LABEL[s]}</option>)}
        </Select>
      </Field>
      <Field label="Order" hint="Lower numbers come first.">
        <Input required type="number" min={0} max={1000} step={1} value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
      </Field>
      <Field label="Rule" className="sm:col-span-2" hint="Plain text. Line breaks are kept; start a line with • for a list.">
        <Textarea required maxLength={2000} rows={6} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
      </Field>
      <Field label="Link text (optional)">
        <Input maxLength={60} value={v.linkLabel} onChange={(e) => setV({ ...v, linkLabel: e.target.value })} placeholder="e.g. Our data protection policy" />
      </Field>
      <Field label="Link address (optional)">
        <Input type="url" maxLength={500} value={v.linkUrl} onChange={(e) => setV({ ...v, linkUrl: e.target.value })} placeholder="https://…" />
      </Field>
      {error && <Alert className="sm:col-span-2">{error}</Alert>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
