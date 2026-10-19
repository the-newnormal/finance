"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { formatSGD } from "@/lib/money";
import type { Category, Division, Pool } from "@/lib/types";
import type { Result } from "../people/actions";
import { addCategory, addDivision, savePool, setCategoryActive, setPoolActive } from "./actions";

type PoolRow = Pool & { allocated_cents: number };

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

export function SetupManager({ divisions, categories, pools }: { divisions: Division[]; categories: Category[]; pools: PoolRow[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <PoolsCard pools={pools} divisions={divisions} />
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

function PoolsCard({ pools, divisions }: { pools: PoolRow[]; divisions: Division[] }) {
  const { pending, error, run } = useAction();
  const [editing, setEditing] = useState<PoolRow | "new" | null>(null);
  const divisionName = (id: string) => divisions.find((d) => d.id === id)?.name ?? "—";

  return (
    <Card>
      <CardHeader><CardTitle>Budgets &amp; events</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {error && <Alert>{error}</Alert>}
        {pools.map((p) =>
          editing !== "new" && editing?.id === p.id ? (
            <PoolForm key={p.id} pool={p} divisions={divisions}
              onDone={() => setEditing((cur) => (cur !== "new" && cur?.id === p.id ? null : cur))} />
          ) : (
            <div key={p.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-line p-4 ${p.active ? "" : "opacity-60"}`}>
              <div className="mr-auto">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-ink-soft">
                  {divisionName(p.division_id)} · {p.kind === "event" ? "Event" : "General"} · {formatSGD(p.allocated_cents)}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setPoolActive(p.id, !p.active))}>
                {p.active ? "Close" : "Reopen"}
              </Button>
            </div>
          ),
        )}
        {editing === "new" ? (
          <PoolForm pool={null} divisions={divisions} onDone={() => setEditing((cur) => (cur === "new" ? null : cur))} />
        ) : (
          <Button variant="soft" onClick={() => setEditing("new")} disabled={!divisions.length}>
            <Plus /> New budget or event
          </Button>
        )}
        {!divisions.length && <p className="text-xs text-ink-soft">Add a division first.</p>}
      </CardContent>
    </Card>
  );
}

function PoolForm({ pool, divisions, onDone }: { pool: PoolRow | null; divisions: Division[]; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const [v, setV] = useState({
    name: pool?.name ?? "",
    kind: pool?.kind ?? ("event" as Pool["kind"]),
    divisionId: pool?.division_id ?? divisions[0]?.id ?? "",
    allocated: pool ? (pool.allocated_cents / 100).toFixed(2) : "",
  });
  return (
    <form className="grid w-full gap-4 rounded-xl border border-line bg-canvas/60 p-4 sm:grid-cols-2"
      onSubmit={(e) => { e.preventDefault(); run(() => savePool(pool?.id ?? null, v), onDone); }}>
      <Field label="Name" className="sm:col-span-2">
        <Input required maxLength={100} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Community Iftar 2026" />
      </Field>
      <Field label="Type">
        <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Pool["kind"] })}>
          <option value="event">Event</option>
          <option value="general">General budget</option>
        </Select>
      </Field>
      <Field label="Division">
        <Select value={v.divisionId} onChange={(e) => setV({ ...v, divisionId: e.target.value })}>
          {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Field>
      <Field label="Budget (SGD)">
        <Input required inputMode="decimal" value={v.allocated} onChange={(e) => setV({ ...v, allocated: e.target.value })} />
      </Field>
      {error && <Alert className="sm:col-span-2">{error}</Alert>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
