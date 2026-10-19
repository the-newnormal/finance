"use server";

import { safeNextPath } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string; email: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The link's origin comes from configuration, never from the request: a forged Origin or Host
// header could otherwise point someone's one-time token at another site.
function siteUrl() {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) throw new Error("NEXT_PUBLIC_SITE_URL is not set");
  return site;
}

export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const typed = String(formData.get("email") ?? "");
  const email = typed.trim().toLowerCase();
  const next = safeNextPath(String(formData.get("next") ?? ""));

  if (!EMAIL_RE.test(email)) {
    return { status: "error", message: "Enter a valid email address.", email: typed };
  }

  const supabase = await createClient();
  // The email template appends token_hash to this URL (see supabase/templates/magic-link.html).
  const confirm = new URL("/auth/callback", siteUrl());
  confirm.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Invite-only: Finance creates accounts on the People page; sign-ups are off.
      shouldCreateUser: false,
      emailRedirectTo: confirm.toString(),
    },
  });

  if (error) {
    // Only errors that can't depend on whether the account exists reach the user.
    // Anything else (no account, per-user email limits, SMTP refusals) gets the same
    // "sent" reply, so this form can't be used to find out who's been invited.
    if (error.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many attempts. Wait a minute, then try again.", email: typed };
    }
    if (!error.status) {
      return { status: "error", message: "Couldn't reach the sign-in service. Try again.", email: typed };
    }
    console.error("signInWithOtp failed", { code: error.code, status: error.status });
  }

  return { status: "sent", email };
}
