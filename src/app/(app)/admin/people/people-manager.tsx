"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { inviteMember, updateMember } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import type { Division, Role } from "@/lib/types";

type U = { id: string; name: string; email: string; role: Role; finance: boolean; divisionIds: string[]; active: boolean };

const ROLE_HELP: Record<Role, string> = {
  volunteer: "Submits claims and sees only their own.",
  core: "Also reviews claims and sees budgets for their divisions; can submit vendor invoices.",
  admin: "Full access, including people, setup and all financial data.",
};

function AccessFields({ value, onChange, divisions }: { value: Pick<U, "role" | "finance" | "divisionIds">; onChange: (v: Pick<U, "role" | "finance" | "divisionIds">) => void; divisions: Division[] }) {
  return (
    <>
      <Field label="Role" hint={ROLE_HELP[value.role]}>
        <Select value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value as Role })}>
          <option value="volunteer">Volunteer</option>
          <option value="core">Core personnel</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      {value.role !== "volunteer" && (
        <Field label="Divisions" group>
          <div className="flex flex-wrap gap-2">
            {divisions.map((d) => {
              const on = value.divisionIds.includes(d.id);
              return (
                <button key={d.id} type="button" onClick={() => onChange({ ...value, divisionIds: on ? value.divisionIds.filter((x) => x !== d.id) : [...value.divisionIds, d.id] })}
                  className={`rounded-full border px-3 py-1 text-xs ${on ? "border-brand-deep bg-teal/40" : "border-line hover:bg-canvas"}`}>
                  {d.name}
                </button>
              );
            })}
            {!divisions.length && <span className="text-xs text-ink-soft">Create divisions under Setup first.</span>}
          </div>
        </Field>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 accent-brand-deep" checked={value.finance} onChange={(e) => onChange({ ...value, finance: e.target.checked })} />
        <span><strong>Finance team</strong><br /><span className="text-xs text-ink-soft">Final approval on all claims, sees all budgets, processes payouts. May approve their own claims.</span></span>
      </label>
    </>
  );
}

export function PeopleManager({ people: users, divisions, meId }: { people: U[]; divisions: Division[]; meId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "", role: "volunteer" as Role, finance: false, divisionIds: [] as string[] });
  const [editing, setEditing] = useState<U | null>(null);
  const [q, setQ] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? { tone: "success", text: success } : { tone: "error", text: res.error ?? "Failed" });
      if (res.ok) { after?.(); router.refresh(); }
    });

  const divName = (id: string) => divisions.find((d) => d.id === id)?.name ?? "?";
  const shown = users.filter((u) => (u.name + u.email).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{users.length} people</CardTitle>
          <Input placeholder="Search…" className="max-w-48" value={q} onChange={(e) => setQ(e.target.value)} />
        </CardHeader>
        <CardContent className="grid gap-2">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          {shown.map((u) => (
            <div key={u.id} className={`rounded-xl border border-line p-3 ${u.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="mr-auto">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-ink-soft">{u.email}</div>
                </div>
                <Badge className="bg-lavender/50 capitalize">{u.role}</Badge>
                {u.finance && <Badge className="bg-yellow/60">Finance</Badge>}
                {!u.active && <Badge className="bg-ink/10">Deactivated</Badge>}
                <Button size="sm" variant="outline" onClick={() => setEditing(editing?.id === u.id ? null : u)}>Edit</Button>
              </div>
              {u.divisionIds.length > 0 && <div className="mt-1 text-xs text-ink-soft">{u.divisionIds.map(divName).join(", ")}</div>}
              {editing?.id === u.id && (
                <div className="mt-3 grid gap-4 border-t border-line pt-3">
                  <AccessFields value={editing} onChange={(v) => setEditing({ ...editing, ...v })} divisions={divisions} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-brand-deep" checked={editing.active} disabled={u.id === meId}
                      onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Account active (unticking signs them out everywhere)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={pending} onClick={() => run(() => updateMember(u.id, editing), `Updated ${u.name}.`, () => setEditing(null))}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardHeader>
          <CardTitle>Add a person</CardTitle>
          <CardDescription>They get an email with a sign-in link. After that, they sign in any time with their email address.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteMember(draft), `Account created for ${draft.email}. They've been emailed a sign-in link.`,
              () => setDraft({ name: "", email: "", role: "volunteer", finance: false, divisionIds: [] }));
          }}>
            <Field label="Full name"><Input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="E-mail"><Input type="email" required value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            <AccessFields value={draft} onChange={(v) => setDraft({ ...draft, ...v })} divisions={divisions} />
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create account"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
