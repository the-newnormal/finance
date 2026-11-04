"use client";

import { useState, useTransition } from "react";
import { sendTestEmail, type EmailTestResult } from "./email-test-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function EmailTest() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid gap-3">
      <Button className="justify-self-start" variant="outline" disabled={pending}
        onClick={() => start(async () => {
          setFailed(false);
          try { setResult(await sendTestEmail()); } catch { setResult(null); setFailed(true); }
        })}>
        {pending ? "Sending…" : "Send me a test email"}
      </Button>
      {!pending && result?.sent && (
        <Alert tone="success">
          Sent to {result.to}. If it doesn&apos;t arrive within a few minutes, check Spam, and the sending account&apos;s Sent folder.
        </Alert>
      )}
      {!pending && result && !result.sent && <Alert>Not sent ({result.code}). {result.hint}</Alert>}
      {!pending && failed && <Alert>The test couldn&apos;t run. Check your connection and try again.</Alert>}
    </div>
  );
}
