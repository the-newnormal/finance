"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideClaim, markPaid } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";

export function ReviewActions({ claimId, canApprove, canReject, approveLabel }: { claimId: string; canApprove: boolean; canReject: boolean; approveLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });

  return (
    <div className="grid gap-3">
      {error && <Alert>{error}</Alert>}
      {rejecting ? (
        <>
          <Field label="Reason (sent to the claimant)">
            <Textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Receipt is unreadable; please re-upload." />
          </Field>
          <div className="flex gap-2">
            <Button variant="destructive" disabled={pending} onClick={() => run(() => decideClaim(claimId, false, reason))}>Reject claim</Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canApprove && <Button disabled={pending} onClick={() => run(() => decideClaim(claimId, true))}>{pending ? "Saving…" : approveLabel}</Button>}
          {canReject && <Button variant="outline" disabled={pending} onClick={() => setRejecting(true)}>Reject…</Button>}
        </div>
      )}
    </div>
  );
}

export function MarkPaidForm({ claimId, accounts }: {
  claimId: string;
  accounts: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ref, setRef] = useState("");
  const [account, setAccount] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await markPaid(claimId, ref, account);
          if (!res.ok) setError(res.error);
          else router.refresh();
        });
      }}
    >
      {error && <Alert>{error}</Alert>}
      <Field label="Paid from" hint="Its expected balance on the Bank page goes down by this amount.">
        <Select value={account} onChange={(e) => setAccount(e.target.value)} required>
          <option value="" disabled>Choose an account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
      </Field>
      {!accounts.length && <Alert tone="info">Add the bank accounts on the Bank page first.</Alert>}
      <Field label="Bank transaction reference" hint="Once you've made the transfer, record it here. The claimant gets an e-mail.">
        <Input value={ref} onChange={(e) => setRef(e.target.value)} required />
      </Field>
      <Button type="submit" disabled={pending || !accounts.length}>{pending ? "Saving…" : "Mark as paid"}</Button>
    </form>
  );
}
