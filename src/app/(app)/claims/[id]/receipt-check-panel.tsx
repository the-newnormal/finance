"use client";

import { Check, CircleHelp, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/money";
import type { ReceiptCheck, ReceiptVerdict } from "@/lib/types";
import { checkReceipts } from "./check-actions";

const VERDICT: Record<ReceiptVerdict, { label: string; tone: string }> = {
  looks_right: { label: "Looks right", tone: "bg-teal/70 text-ink" },
  check_needed: { label: "Check needed", tone: "bg-orange/40 text-ink" },
  unreadable: { label: "Couldn't read", tone: "bg-ink/10 text-ink" },
};
const MATCH: Record<string, string> = { yes: "matches", no: "doesn't match", unclear: "unclear", not_given: "no date claimed" };

// The AI receipt check, for the claim's reviewers. `autoRun`: check now if there's no check yet
// (the first time a reviewer opens a claim awaiting a decision). Advice only.
export function ReceiptCheckPanel({ claimId, check, canRun, autoRun }: {
  claimId: string; check: ReceiptCheck | null; canRun: boolean; autoRun: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const run = () => start(async () => {
    setError(null);
    const res = await checkReceipts(claimId).catch(() => ({ ok: false as const, error: "The receipts couldn't be checked just now. Try again." }));
    if (!res.ok) setError(res.error);
    else router.refresh();
  });
  const runOnce = useEffectEvent(() => {
    if (started.current) return;
    started.current = true;
    run();
  });
  useEffect(() => {
    if (autoRun) runOnce();
  }, [autoRun]);

  const f = check?.findings ?? {};
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-brand-deep" /> AI receipt check</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {error && <Alert>{error}</Alert>}
        {pending && <p className="text-ink-soft">Reading the receipts… This can take up to a minute.</p>}
        {check && !pending && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={VERDICT[check.verdict].tone}>{VERDICT[check.verdict].label}</Badge>
              {f.amount_matches && <span className="text-xs text-ink-soft">Amount {MATCH[f.amount_matches]}</span>}
              {f.date_matches && <span className="text-xs text-ink-soft">· Date {MATCH[f.date_matches]}</span>}
            </div>
            <p>{check.summary}</p>
            {!!f.fields?.length && (
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-soft">
                  Mandatory fields{f.document_kind === "paid_invoice" ? " (invoice the claimant paid)" : f.document_kind === "receipt" ? " (receipt)" : ""}
                </div>
                <ul className="mt-1 grid gap-1">
                  {f.fields.map((x) => (
                    <li key={x.field} className="flex items-start gap-2">
                      {x.shown === "yes" ? <Check aria-label="Shown" className="mt-0.5 size-4 shrink-0 text-brand-deep" />
                        : x.shown === "no" ? <X aria-label="Missing" className="mt-0.5 size-4 shrink-0 text-danger" />
                        : <CircleHelp aria-label="Unclear" className="mt-0.5 size-4 shrink-0 text-ink-soft" />}
                      <span>{x.field}{x.value && <span className="text-ink-soft"> · {x.value}</span>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!f.documents?.length && (
              <ul className="grid gap-1.5">
                {f.documents.map((d, i) => (
                  <li key={i} className="rounded-lg bg-canvas px-2.5 py-1.5 text-xs">
                    <span className="font-medium">{d.file}</span>: {d.kind.replace("_", " ")}
                    {[d.merchant, d.date, d.total, d.reference && `ref ${d.reference}`, d.payment_method, d.items]
                      .filter(Boolean).map((v) => ` · ${v}`).join("")}
                  </li>
                ))}
              </ul>
            )}
            <List title="Missing" items={f.missing} />
            <List title="Worth a look" items={f.concerns} />
            <List title="Not read" items={f.skipped?.map((s) => `${s.name}: ${s.reason}`)} />
            <p className="text-xs text-ink-soft">
              Advice only, and only you see it: look at the receipts yourself before deciding. Checked {formatDate(check.checked_at)}.
            </p>
          </>
        )}
        {!check && !pending && !error && <p className="text-ink-soft">Not checked yet.</p>}
        {canRun && !pending && (
          <Button size="sm" variant="outline" className="justify-self-start" onClick={run}>
            {check ? "Check again" : "Check receipts"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-soft">{title}</div>
      <ul className="mt-1 list-disc pl-5">{items.map((m, i) => <li key={i}>{m}</li>)}</ul>
    </div>
  );
}
