"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reverseReserveAddition } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Reverses an addition entered by mistake, with a reason. */
export function ReverseButton({ id }: { id: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Reverse…</Button>;
  return (
    <div className="grid min-w-56 gap-1.5">
      <Input aria-label="Why it's being reversed" value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Entered twice" maxLength={280} />
      {error && <span className="text-xs text-danger">{error}</span>}
      <div className="flex gap-1.5">
        <Button size="sm" variant="destructive" disabled={pending}
          onClick={() => start(async () => {
            const res = await reverseReserveAddition(id, reason);
            if (!res.ok) return setError(res.error);
            router.refresh();
          })}>
          {pending ? "Reversing…" : "Reverse"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
      </div>
    </div>
  );
}
