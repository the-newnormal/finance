"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addToReserve } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";

export function ReserveForm({ today }: { today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const s = (k: string) => String(fd.get(k) ?? "");
        start(async () => {
          setError(null);
          setSaved(false);
          const res = await addToReserve({ amount: s("amount"), direction: s("direction") as "in" | "out", date: s("date"), note: s("note") });
          if (!res.ok) return setError(res.error);
          form.reset();
          setSaved(true);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select name="direction" defaultValue="in">
            <option value="in">Add funds</option>
            <option value="out">Take funds out / correct</option>
          </Select>
        </Field>
        <Field label="Amount (SGD)"><Input name="amount" inputMode="decimal" placeholder="0.00" required /></Field>
        <Field label="Date"><Input name="date" type="date" max={today} defaultValue={today} required /></Field>
        <Field label="Note"><Input name="note" required minLength={3} maxLength={300} placeholder="e.g. Grant from the council" /></Field>
      </div>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">Saved.</Alert>}
      <Button type="submit" className="justify-self-start" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}
