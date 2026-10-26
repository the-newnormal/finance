"use client";

import { useState, useTransition } from "react";
import { setPassword } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function PasswordForm() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; resign?: boolean } | null>(null);
  const [round, setRound] = useState(0);

  return (
    <div className="grid gap-4">
    <form
      key={round}
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await setPassword(String(fd.get("password") ?? ""), String(fd.get("confirm") ?? ""));
          setResult(res);
          if (res.ok) setRound((r) => r + 1);
        });
      }}
    >
      <Field label="New password" hint="At least 12 characters. A few unrelated words make a good one.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <Field label="Type it again">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <Button type="submit" className="justify-self-start" disabled={pending}>{pending ? "Saving…" : "Save password"}</Button>
    </form>
    {result?.ok && <Alert tone="success">Password saved. You can now sign in with your email and this password.</Alert>}
    {result && !result.ok && <Alert>{result.error}</Alert>}
    {/* Outside the form above: forms can't nest. A plain POST, like the header's sign-out. */}
    {result?.resign && (
      <form action="/auth/signout" method="post">
        <Button type="submit" size="sm" variant="outline">Sign out and sign in again</Button>
      </form>
    )}
    </div>
  );
}
