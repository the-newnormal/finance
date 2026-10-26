"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { sendMagicLink, signInWithPassword, type LoginState } from "./actions";
import { cn } from "@/lib/utils";

const initialState: LoginState = { status: "idle" };

// `notice` is a message from the URL (e.g. an expired link). It hides once a new link is sent.
export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [mode, setMode] = useState<"link" | "password">("link");
  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-1 rounded-full border border-line bg-surface p-1 text-sm">
        {(["link", "password"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
            className={cn("rounded-full px-3 py-1.5 transition-colors", mode === m ? "bg-ink text-white" : "hover:bg-canvas")}>
            {m === "link" ? "Email me a link" : "Password"}
          </button>
        ))}
      </div>
      {mode === "link" ? <LinkForm next={next} notice={notice} /> : <PasswordForm next={next} notice={notice} />}
    </>
  );
}

function PasswordForm({ next, notice }: { next: string; notice?: string }) {
  const [state, formAction, pending] = useActionState(signInWithPassword, initialState);
  return (
    <form action={formAction} className="mt-4 grid gap-4">
      {notice && <Alert>{notice}</Alert>}
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required
          defaultValue={state.status === "error" ? state.email : undefined} />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required
          aria-invalid={state.status === "error" || undefined} />
      </Field>
      {state.status === "error" && <Alert>{state.message}</Alert>}
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      <p className="text-xs text-ink-soft">Forgot it, or never set one? Use an emailed link, then set a password on your Account page.</p>
    </form>
  );
}

function LinkForm({ next, notice }: { next: string; notice?: string }) {
  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);

  if (state.status === "sent") {
    return (
      <Alert tone="success" className="mt-6">
        If <span className="font-medium">{state.email}</span> has an account, a sign-in link is on its way. It
        expires in an hour. You can close this tab.
      </Alert>
    );
  }

  return (
    <form action={formAction} className="mt-4 grid gap-4">
      {notice && <Alert>{notice}</Alert>}
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          // React resets the form after each submit; keep what they typed when there's an error.
          defaultValue={state.status === "error" ? state.email : undefined}
          required
          aria-invalid={state.status === "error" || undefined}
        />
      </Field>
      {state.status === "error" && <Alert>{state.message}</Alert>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
