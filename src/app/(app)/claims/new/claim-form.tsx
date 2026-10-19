"use client";

import { FileText, Paperclip, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitClaim, type ClaimInput } from "../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { PAYOUT_LABEL, type PayoutType } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  uid: string;
  canInvoice: boolean;
  goesStraightToFinance: boolean;
  pools: { id: string; name: string; kind: "event" | "general" }[];
  categories: { id: string; name: string }[];
  savedPayout: { type: PayoutType; masked: string } | null;
};

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
// The types the receipts bucket accepts (supabase/migrations/0001_init.sql).
const ACCEPTED = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "application/pdf"];

// A chosen file, and where it was uploaded once it has been (kept, so a retry doesn't upload again).
type Attachment = { file: File; path?: string };

export function ClaimForm({ uid, canInvoice, goesStraightToFinance, pools, categories, savedPayout }: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<"reimbursement" | "invoice">("reimbursement");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [folder] = useState(() => `${uid}/${crypto.randomUUID()}`);
  const [payoutType, setPayoutType] = useState<PayoutType | "saved">(savedPayout ? "saved" : "paynow_mobile");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isInvoice = kind === "invoice";
  const effectivePayout = isInvoice && payoutType === "saved" ? "paynow_uen" : payoutType;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!ACCEPTED.includes(f.type)) { setError(`${f.name} isn't a JPEG, PNG, GIF, WebP, HEIC or PDF.`); continue; }
      if (f.size > MAX_BYTES) { setError(`${f.name} is larger than 10 MB.`); continue; }
      if (next.length < MAX_FILES) next.push({ file: f });
    }
    setFiles(next);
  }

  // Removing an uploaded file deletes it too (allowed while no claim attaches it).
  function removeFile(i: number) {
    const gone = files[i];
    setFiles(files.filter((_, j) => j !== i));
    if (gone.path) void createClient().storage.from("receipts").remove([gone.path]);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!files.length) return setError(isInvoice ? "Attach the invoice." : "Attach your receipt.");
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "");
    setBusy(true);
    try {
      // Straight into the private receipts bucket, in this member's own folder (storage RLS). Files
      // already uploaded by an earlier attempt are reused, not uploaded again.
      const storage = createClient().storage.from("receipts");
      const uploaded: Attachment[] = [];
      for (const a of files) {
        if (a.path) { uploaded.push(a); continue; }
        const safe = a.file.name.replace(/[^\w.-]+/g, "_").slice(-80);
        const path = `${folder}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
        const { error } = await storage.upload(path, a.file, { contentType: a.file.type, upsert: false });
        if (error) {
          setFiles([...uploaded, ...files.slice(uploaded.length)]);
          throw error;
        }
        uploaded.push({ ...a, path });
      }
      setFiles(uploaded);
      const attachmentPaths = uploaded.map((a) => a.path!);

      const payout: ClaimInput["payout"] =
        effectivePayout === "saved" ? { type: "saved" }
        : effectivePayout === "bank" ? { type: "bank", name: s("payeeName"), bankName: s("bankName"), accountNumber: s("accountNumber") }
        : { type: effectivePayout, name: s("payeeName"), proxy: s("proxy") };

      const res = await submitClaim({
        kind,
        poolId: s("poolId"),
        categoryId: s("categoryId"),
        description: s("description"),
        amount: s("amount"),
        expenseDate: s("expenseDate"),
        vendorName: isInvoice ? s("vendorName") : undefined,
        dueDate: isInvoice ? s("dueDate") : undefined,
        attachmentPaths,
        payout,
        savePayout: fd.get("savePayout") === "on",
      });
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      router.push(`/claims/${res.id}?submitted=1`);
    } catch {
      setError("Upload failed. Check your connection and try again.");
      setBusy(false);
    }
  }

  const payoutOptions: (PayoutType | "saved")[] = [
    ...(savedPayout && !isInvoice ? (["saved"] as const) : []),
    "paynow_mobile", "paynow_uen", "bank",
  ];

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="grid content-start gap-6">
        {canInvoice && (
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-1.5">
            {(["reimbursement", "invoice"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
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
            <Field label="Event or budget" className="sm:col-span-2">
              <Select name="poolId" required defaultValue="">
                <option value="" disabled>Choose one…</option>
                {pools.filter((p) => p.kind === "event").length > 0 && (
                  <optgroup label="Events">{pools.filter((p) => p.kind === "event").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
                )}
                {pools.filter((p) => p.kind === "general").length > 0 && (
                  <optgroup label="Other budgets">{pools.filter((p) => p.kind === "general").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
                )}
              </Select>
            </Field>
            <Field label="Category">
              <Select name="categoryId" required defaultValue="">
                <option value="" disabled>Choose one…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
              <Field label="Date of purchase"><Input name="expenseDate" type="date" max={new Date().toISOString().slice(0, 10)} /></Field>
            )}
            <Field label="Description" className="sm:col-span-2">
              <Textarea name="description" required maxLength={500} placeholder={isInvoice ? "e.g. Venue rental for 12 Oct workshop, 9am–5pm" : "e.g. Snacks and water for 40 volunteers"} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isInvoice ? "Invoice" : "Receipt"}</CardTitle>
            <CardDescription>Images or PDFs, up to 10 MB each, max {MAX_FILES} files.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink/25 bg-canvas/60 px-4 py-8 text-center text-sm hover:bg-canvas">
              <Paperclip className="size-5 text-brand-deep" />
              <span className="font-medium">Tap to add files</span>
              <span className="text-xs text-ink-soft">or take a photo</span>
              <input type="file" accept={ACCEPTED.join(",")} multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
            {files.map(({ file: f }, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                <FileText className="size-4 text-ink-soft" />
                <span className="flex-1 truncate">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removeFile(i)}><X className="size-4" /></button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{isInvoice ? "Pay the vendor via" : "Reimburse me via"}</CardTitle>
            <CardDescription>PayNow is preferred: it&apos;s fastest for Finance.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
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
          </CardContent>
        </Card>

        <Card className="p-5">
          <p className="text-sm text-ink-soft">
            {goesStraightToFinance
              ? "This goes straight to Finance for approval."
              : "Your event lead will review this first, then Finance gives final approval. We'll e-mail you when it's approved."}
          </p>
          {error && <Alert className="mt-4">{error}</Alert>}
          <Button type="submit" size="lg" className="mt-4 w-full" disabled={busy}>
            {busy ? "Submitting…" : isInvoice ? "Submit invoice" : "Submit claim"}
          </Button>
        </Card>
      </div>
    </form>
  );
}
