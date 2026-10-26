"use client";

import { Bot, FileText, ListChecks, Paperclip, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { forgetSavedPayout, submitClaim, type ClaimInput } from "../actions";
import { precheckClaim, type PrecheckResult } from "../precheck-actions";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { byGroup } from "@/lib/categories";
import { comparedFixes } from "@/lib/claim-items";
import { parseAmountToCents } from "@/lib/money";
import { DOCUMENT_FIELDS, type DocumentKind } from "@/lib/receipt-fields";
import { ACCEPT_ATTR, ACCEPTED, uploadable } from "@/lib/receipt-upload";
import { createClient } from "@/lib/supabase/client";
import { PAYOUT_LABEL, type Category, type ClaimKind, type ClaimRule, type PayoutType } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  uid: string;
  /** Today in Singapore (YYYY-MM-DD): the latest purchase date. */
  today: string;
  canInvoice: boolean;
  goesStraightToFinance: boolean;
  budgets: { id: string; name: string; kind: "event" | "general"; is_reserve: boolean }[];
  /** Which categories each budget provisions: a claim may only use one of its budget's. */
  provisions: { budget_id: string; category_id: string }[];
  categories: Pick<Category, "id" | "name" | "category_group">[];
  savedPayout: { type: PayoutType; masked: string } | null;
  /** The rules Finance shows on this form (claim_rules), in order. */
  rules: Pick<ClaimRule, "id" | "title" | "body" | "applies_to" | "link_label" | "link_url">[];
  /** Whether the AI receipt check is on: it reads the files as they're attached, and for reviewers. */
  aiCheck: boolean;
};

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

// A file attached and uploaded: straight away, so the AI can read it before the claim is sent.
// `proof` marks a proof of payment for an invoice the claimant paid; all of them are attached.
type Attachment = { file: File; path: string; proof?: boolean };

// What the claimant ticks to submit, in TRP's words: it agrees to the declaration above it.
const AGREEMENT = "I agree that all relevant information is accurate and free of errors, and I understand the processing timeline and terms above.";

export function ClaimForm({ uid, today, canInvoice, goesStraightToFinance, budgets, provisions, categories, savedPayout, rules, aiCheck }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [budgetId, setBudgetId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // Only the categories the chosen budget provisions (the database refuses any other).
  const budgetCategories = useMemo(() => {
    const ids = new Set(provisions.filter((p) => p.budget_id === budgetId).map((p) => p.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [budgetId, provisions, categories]);
  const [kind, setKind] = useState<ClaimKind>("reimbursement");
  // Only chooses which mandatory fields the form lists: a receipt, or an invoice they paid.
  const [paidWith, setPaidWith] = useState<"receipt" | "paid_invoice">("receipt");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [folder] = useState(() => `${uid}/${crypto.randomUUID()}`);
  const [payoutType, setPayoutType] = useState<PayoutType | "saved">(savedPayout ? "saved" : "paynow_mobile");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // HEIC photos are made into JPEGs and every file is uploaded as it's chosen, which takes a moment:
  // files can't change meanwhile.
  const [attaching, setAttaching] = useState(false);
  // With the AI check on, the files are read as soon as they're attached, by kind and files; the
  // claim can be sent once the read of what's attached now is back (one that couldn't run holds
  // nothing up). Reads are kept, so going back to files already read doesn't read them again.
  const [reads, setReads] = useState<Record<string, PrecheckResult>>({});
  const asked = useRef(new Set<string>());
  // What the read found to fix, shown as the claim is sent; the claimant may send it anyway.
  const [toFix, setToFix] = useState<string[] | null>(null);
  // One per claim: lets the server recognise a retry of this same claim.
  const [submissionId] = useState(() => crypto.randomUUID());

  const isInvoice = kind === "invoice";
  const shownRules = rules.filter((r) => r.applies_to === "all" || r.applies_to === kind);
  const documentKind: DocumentKind = isInvoice ? "vendor_invoice" : paidWith;
  // An invoice they paid needs the invoice and, separately, the proof that they paid it.
  const needsProof = documentKind === "paid_invoice";
  const effectivePayout = isInvoice && payoutType === "saved" ? "paynow_uen" : payoutType;
  const readKey = JSON.stringify({ kind, paths: files.map((a) => a.path) });
  const read = reads[readKey];
  const reading = aiCheck && files.length > 0 && !read;

  useEffect(() => {
    const { kind: k, paths } = JSON.parse(readKey) as { kind: ClaimKind; paths: string[] };
    if (!aiCheck || !paths.length || asked.current.has(readKey)) return;
    asked.current.add(readKey);
    precheckClaim({ kind: k, attachmentPaths: paths })
      .catch((): PrecheckResult => ({ ok: false }))
      .then((result) => setReads((r) => ({ ...r, [readKey]: result })));
  }, [aiCheck, readKey]);

  async function addFiles(list: FileList | null, proof: boolean) {
    const chosen = Array.from(list ?? []); // read now: the input is cleared once this returns
    if (!chosen.length) return;
    setAttaching(true);
    setError(null);
    try {
      const storage = createClient().storage.from("receipts");
      const next = [...files];
      for (const picked of chosen) {
        if (next.length >= MAX_FILES) break;
        let f: File;
        try { f = await uploadable(picked); }
        catch { setError(`${picked.name} couldn't be converted to a JPEG. Attach a screenshot of it instead.`); continue; }
        if (!ACCEPTED.includes(f.type)) { setError(`${f.name} isn't a JPEG, PNG, GIF, WebP, HEIC or PDF.`); continue; }
        if (f.size > MAX_BYTES) { setError(`${f.name} is larger than 10 MB.`); continue; }
        // Straight into the private receipts bucket, in this member's own folder (storage RLS). Only
        // letters, digits, _ - and single dots (the database refuses ".." in any path).
        const safe = f.name.replace(/[^\w.-]+/g, "_").replace(/\.{2,}/g, ".").slice(-80);
        const path = `${folder}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
        const uploaded = await storage.upload(path, f, { contentType: f.type, upsert: false }).catch(() => null);
        if (!uploaded || uploaded.error) { setError(`${f.name} couldn't be uploaded. Check your connection and try again.`); continue; }
        next.push({ file: f, path, proof });
      }
      setFiles(next);
    } catch {
      setError("The files couldn't be attached. Try again.");
    } finally {
      setAttaching(false);
    }
  }

  // Changing what is attached starts the files afresh, as TRP's form does: a file attached as one
  // kind of document is never sent as another (an invoice as the receipt, say).
  function choose(nextKind: ClaimKind, nextPaidWith: typeof paidWith) {
    const next: DocumentKind = nextKind === "invoice" ? "vendor_invoice" : nextPaidWith;
    setKind(nextKind);
    setPaidWith(nextPaidWith);
    if (next !== documentKind) setFiles([]);
  }

  // Files can't change while the claim is being sent (the controls are disabled), so what is attached
  // is always what's on screen. Removed files stay private in the member's own folder.
  function removeFile(i: number) {
    if (busy) return;
    setFiles(files.filter((_, j) => j !== i));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!files.some((a) => !a.proof)) return setError(isInvoice || needsProof ? "Attach the invoice." : "Attach your receipt.");
    if (needsProof && !files.some((a) => a.proof)) return setError("Attach the proof of payment: a screenshot of the PayNow or bank transfer.");
    // What the read found to fix, with the documents' total and date compared to what was entered
    // (never the payout details): shown first, and the claimant may send it anyway, as the AI can be
    // wrong and a reviewer decides.
    const fd = new FormData(e.currentTarget);
    const fixes = read?.ok
      ? [...read.fixes, ...comparedFixes(read.documents, {
        amountCents: parseAmountToCents(String(fd.get("amount") ?? "")),
        expenseDate: isInvoice ? null : String(fd.get("expenseDate") ?? "") || null,
      })]
      : [];
    if (fixes.length) return setToFix(fixes);
    void send(e.currentTarget);
  }

  async function send(form: HTMLFormElement) {
    setToFix(null);
    const fd = new FormData(form);
    const s = (k: string) => String(fd.get(k) ?? "");
    setBusy(true);
    try {
      const payout: ClaimInput["payout"] =
        effectivePayout === "saved" ? { type: "saved" }
        : effectivePayout === "bank" ? { type: "bank", name: s("payeeName"), bankName: s("bankName"), accountNumber: s("accountNumber") }
        : { type: effectivePayout, name: s("payeeName"), proxy: s("proxy") };

      const res = await submitClaim({
        kind,
        budgetId,
        categoryId,
        description: s("description"),
        amount: s("amount"),
        expenseDate: s("expenseDate"),
        vendorName: isInvoice ? s("vendorName") : undefined,
        dueDate: isInvoice ? s("dueDate") : undefined,
        attachmentPaths: files.map((a) => a.path),
        payout,
        savePayout: fd.get("savePayout") === "on",
        agreed: fd.get("agreed") === "on",
        submissionId,
        // What was bought, as the AI read it from these files (0012).
        items: read?.ok && read.items.length ? read.items : undefined,
      });
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      router.push(`/claims/${res.id}?submitted=1${res.payoutSaved ? "" : "&unsaved=1"}`);
    } catch {
      // Safe to retry: the same submission id never makes a second claim.
      setError("The claim couldn't be sent. Check your connection and try again.");
      setBusy(false);
    }
  }

  const payoutOptions: (PayoutType | "saved")[] = [
    ...(savedPayout && !isInvoice ? (["saved"] as const) : []),
    "paynow_mobile", "paynow_uen", "bank",
  ];

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* Locked while submitting: what is sent is what is on screen. */}
      <fieldset disabled={busy} className="grid min-w-0 content-start gap-6">
        {canInvoice && (
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-1.5">
            {(["reimbursement", "invoice"] as const).map((k) => (
              <button key={k} type="button" disabled={busy || attaching} onClick={() => choose(k, paidWith)}
                className={cn("rounded-xl px-4 py-2.5 text-left text-sm transition-colors", kind === k ? "bg-ink text-white" : "hover:bg-canvas")}>
                <div className="font-medium">{k === "reimbursement" ? "Reimburse me" : "Pay a vendor invoice"}</div>
                <div className={cn("text-xs", kind === k ? "text-white/70" : "text-ink-soft")}>
                  {k === "reimbursement" ? "I've already paid" : "Finance pays the vendor directly"}
                </div>
              </button>
            ))}
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>What was it for?</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Budget" className="sm:col-span-2">
              <Select name="budgetId" required value={budgetId}
                onChange={(e) => { setBudgetId(e.target.value); setCategoryId(""); }}>
                <option value="" disabled>Choose one…</option>
                {budgets.filter((b) => b.kind === "event" && !b.is_reserve).length > 0 && (
                  <optgroup label="Events">{budgets.filter((b) => b.kind === "event" && !b.is_reserve).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
                )}
                {budgets.filter((b) => b.kind === "general" && !b.is_reserve).length > 0 && (
                  <optgroup label="Other budgets">{budgets.filter((b) => b.kind === "general" && !b.is_reserve).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
                )}
                {budgets.some((b) => b.is_reserve) && (
                  <optgroup label="Finance only">{budgets.filter((b) => b.is_reserve).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
                )}
              </Select>
            </Field>
            <Field label="Category">
              <Select name="categoryId" required value={categoryId} disabled={!budgetId}
                onChange={(e) => setCategoryId(e.target.value)}>
                <option value="" disabled>{budgetId ? "Choose one…" : "Choose a budget first"}</option>
                {byGroup(budgetCategories).map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Amount (SGD)">
              <Input name="amount" inputMode="decimal" placeholder="0.00" required pattern="^\$?\d+(\.\d{1,2})?$" title="e.g. 42.50" />
            </Field>
            {isInvoice ? (
              <>
                <Field label="Vendor"><Input name="vendorName" required placeholder="e.g. The Hall Pte Ltd" /></Field>
                <Field label="Payment due"><Input name="dueDate" type="date" /></Field>
              </>
            ) : (
              <Field label="Date of purchase"><Input name="expenseDate" type="date" max={today} required /></Field>
            )}
            <Field label="Description" className="sm:col-span-2">
              <Textarea name="description" required maxLength={500} placeholder={isInvoice ? "e.g. Venue rental for 12 Oct workshop, 9am–5pm" : "e.g. Snacks and water for 40 volunteers"} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isInvoice ? "Invoice" : paidWith === "paid_invoice" ? "Invoice and proof of payment" : "Receipt"}</CardTitle>
            <CardDescription>
              Images or PDFs, up to 10 MB each, max {MAX_FILES} files.
              {aiCheck && " As you attach them, an AI service (Anthropic's Claude) reads them to check they show what's needed and to list what was bought, and reviewers may have it read them again."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {!isInvoice && (
              <div role="radiogroup" aria-label="What are you attaching?" className="grid grid-cols-2 gap-2 rounded-xl border border-line p-1">
                {(["receipt", "paid_invoice"] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={paidWith === k} disabled={busy || attaching} onClick={() => choose(kind, k)}
                    className={cn("rounded-lg px-3 py-2 text-sm", paidWith === k ? "bg-ink text-white" : "hover:bg-canvas")}>
                    {k === "receipt" ? "Receipt" : "Invoice I've paid"}
                  </button>
                ))}
              </div>
            )}
            <MandatoryFields kind={documentKind} ai={aiCheck} />
            {needsProof ? (
              <>
                <FileSlot title="Invoice(s)" hint="One or more invoices you paid." files={files} proof={false} busy={busy || attaching} onAdd={addFiles} onRemove={removeFile} />
                <FileSlot title="Proof(s) of payment" hint="One or more screenshots of the PayNow or bank transfer confirmation."
                  files={files} proof busy={busy || attaching} onAdd={addFiles} onRemove={removeFile} />
              </>
            ) : (
              <FileSlot files={files} proof={false} busy={busy || attaching} onAdd={addFiles} onRemove={removeFile} />
            )}
          </CardContent>
        </Card>
      </fieldset>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{isInvoice ? "Pay the vendor via" : "Reimburse me via"}</CardTitle>
            <CardDescription>PayNow is preferred: it&apos;s fastest for Finance.</CardDescription>
          </CardHeader>
          {/* Locked while submitting: what is sent is what is on screen. */}
          <CardContent className="grid gap-4">
            <fieldset disabled={busy} className="grid gap-4 disabled:opacity-60">
            <div className="grid gap-2">
              {payoutOptions.map((t) => (
                <label key={t} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm",
                  effectivePayout === t ? "border-brand-deep bg-teal/20" : "border-line hover:bg-canvas")}>
                  <input type="radio" name="payoutType" className="accent-brand-deep" checked={effectivePayout === t} onChange={() => setPayoutType(t)} />
                  <span className="flex-1">
                    {t === "saved" ? <>Saved: <strong>{PAYOUT_LABEL[savedPayout!.type]}</strong> {savedPayout!.masked}</> : PAYOUT_LABEL[t]}
                  </span>
                  {t === "bank" && <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] text-ink-soft">Slower</span>}
                  {(t === "paynow_mobile" || t === "paynow_uen") && <span className="rounded-full bg-teal/60 px-2 py-0.5 text-[11px]">Preferred</span>}
                </label>
              ))}
              {savedPayout && !isInvoice && (
                <button type="button" className="justify-self-start text-xs text-ink-soft underline-offset-4 hover:underline"
                  onClick={async () => {
                    const res = await forgetSavedPayout().catch(() => ({ ok: false }));
                    if (!res.ok) return setError("Your saved details couldn't be removed. Try again.");
                    setPayoutType("paynow_mobile");
                    router.refresh();
                  }}>
                  Forget my saved details
                </button>
              )}
            </div>

            {effectivePayout !== "saved" && (
              <>
                <Field label={effectivePayout === "bank" ? "Account holder name" : "Name registered with PayNow"}>
                  <Input name="payeeName" required autoComplete="name" />
                </Field>
                {effectivePayout === "bank" ? (
                  <>
                    <Field label="Bank"><Input name="bankName" required placeholder="e.g. DBS / POSB" /></Field>
                    <Field label="Account number"><Input name="accountNumber" required inputMode="numeric" autoComplete="off" /></Field>
                  </>
                ) : (
                  <Field label={effectivePayout === "paynow_mobile" ? "PayNow mobile number" : "UEN"}
                    hint={effectivePayout === "paynow_mobile" ? "Singapore number, e.g. 9123 4567" : undefined}>
                    <Input key={effectivePayout} name="proxy" required inputMode={effectivePayout === "paynow_mobile" ? "tel" : "text"} autoComplete="off" />
                  </Field>
                )}
                {!isInvoice && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="savePayout" defaultChecked className="accent-brand-deep" /> Remember for next time
                  </label>
                )}
                <p className="text-xs text-ink-soft">Your details are encrypted and only Finance can see them in full.</p>
              </>
            )}
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Declaration</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {shownRules.map((r) => (
              <section key={r.id} className="grid gap-1 rounded-xl border border-line bg-canvas/60 p-3.5">
                <h3 className="font-medium">{r.title}</h3>
                <p className="whitespace-pre-wrap text-ink-soft">{r.body}</p>
                {r.link_url && (
                  <a href={r.link_url} target="_blank" rel="noreferrer" className="justify-self-start text-brand-deep underline underline-offset-4">
                    {r.link_label}
                  </a>
                )}
              </section>
            ))}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3.5">
              <input type="checkbox" name="agreed" required disabled={busy} className="mt-0.5 accent-brand-deep" />
              <span>{AGREEMENT}</span>
            </label>
            <p className="text-ink-soft">
              {goesStraightToFinance
                ? "This goes straight to Finance for approval."
                : "Your event lead will review this first, then Finance gives final approval. We'll e-mail you when it's approved."}
            </p>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" size="lg" className="w-full" disabled={busy || attaching || reading}>
              {busy ? "Submitting…" : attaching ? "Uploading your files…" : reading ? "Reading your receipts…"
                : isInvoice ? "Submit invoice" : "Submit claim"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={toFix !== null} onOpenChange={(open) => { if (!open) setToFix(null); }}>
        <AlertDialogContent>
          <AlertDialogTitle><Bot className="size-4 shrink-0" /> The AI check found something to fix</AlertDialogTitle>
          <ul className="grid list-disc gap-1 pl-5 text-sm">{toFix?.map((f, i) => <li key={i}>{f}</li>)}</ul>
          <AlertDialogDescription>Go back and fix it, or submit it as it is: the AI can be wrong, and your reviewer decides.</AlertDialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogCancel asChild><Button type="button" variant="outline">Go back and fix</Button></AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button type="button" onClick={() => { if (formRef.current) void send(formRef.current); }}>Submit anyway</Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

// The fields a document must show, as TRP's finance system lists them (src/lib/receipt-fields.ts).
// With the AI receipt check on, it verifies each one for the reviewer.
function MandatoryFields({ kind, ai }: { kind: DocumentKind; ai: boolean }) {
  const { label, fields } = DOCUMENT_FIELDS[kind];
  const Icon = ai ? Bot : ListChecks;
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-canvas p-4 text-sm">
      <div className="flex items-start gap-2 font-semibold uppercase tracking-wide">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <span>{label} — {ai ? "AI will verify these mandatory fields" : "must show these mandatory fields"}:</span>
      </div>
      <ul className="grid list-disc gap-1 pl-5 text-ink-soft">{fields.map((f) => <li key={f}>{f}</li>)}</ul>
      <p className="text-ink-soft">Make sure your uploaded document clearly shows all fields above for faster approval.</p>
    </div>
  );
}

// Where one kind of document is added: the receipt or invoice, or (proof) the proof of payment.
function FileSlot({ title, hint, files, proof, busy, onAdd, onRemove }: {
  title?: string; hint?: string; files: Attachment[]; proof: boolean; busy: boolean;
  onAdd: (list: FileList | null, proof: boolean) => Promise<void>; onRemove: (i: number) => void;
}) {
  return (
    <div className="grid gap-2">
      {title && (
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-ink-soft">{hint}</div>
        </div>
      )}
      <label aria-disabled={busy} className="flex cursor-pointer flex-col aria-disabled:pointer-events-none aria-disabled:opacity-50 items-center justify-center gap-1 rounded-xl border border-dashed border-ink/25 bg-canvas/60 px-4 py-8 text-center text-sm hover:bg-canvas">
        <Paperclip className="size-5 text-brand-deep" />
        <span className="font-medium">Tap to add files</span>
        <span className="text-xs text-ink-soft">or take a photo</span>
        {/* Named for its slot, so the invoice and proof inputs don't sound the same to a screen reader. */}
        <input type="file" accept={ACCEPT_ATTR} multiple disabled={busy} className="sr-only"
          aria-label={title ? `Add ${title.toLowerCase()}` : undefined}
          onChange={(e) => { void onAdd(e.target.files, proof); e.target.value = ""; }} />
      </label>
      {files.map((a, i) => !a.proof === !proof && (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
          <FileText className="size-4 text-ink-soft" />
          <span className="flex-1 truncate">{a.file.name}</span>
          <button type="button" aria-label={`Remove ${a.file.name}`} disabled={busy} onClick={() => onRemove(i)}><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}
