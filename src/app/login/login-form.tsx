"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { sendMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

// `notice` is a message from the URL (e.g. an expired link). It hides once a new link is sent.
export function LoginForm({ next, notice }: { next: string; notice?: string }) {
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
    <form action={formAction} className="mt-6 grid gap-4">
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
