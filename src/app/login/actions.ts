"use server";

import { redirect } from "next/navigation";
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

// Signs in with a password the member set on their Account page. Invite-only still: there is no
// sign-up, and a deactivated member's login is banned (People page), so this refuses them too.
// Every wrong email, wrong password or account without a password gets the same reply, so the
// form can't be used to find out who has an account. On success the session cookies are set and
// the member goes where they were headed.
export async function signInWithPassword(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const typed = String(formData.get("email") ?? "");
  const email = typed.trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""));

  if (!EMAIL_RE.test(email)) {
    return { status: "error", message: "Enter a valid email address.", email: typed };
  }
  if (!password) {
    return { status: "error", message: "Enter your password.", email: typed };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "over_request_rate_limit") {
      return { status: "error", message: "Too many attempts. Wait a minute, then try again.", email: typed };
    }
    if (!error.status) {
      return { status: "error", message: "Couldn't reach the sign-in service. Try again.", email: typed };
    }
    if (error.code !== "invalid_credentials" && error.code !== "user_banned") {
      console.error("signInWithPassword failed", { code: error.code, status: error.status });
    }
    return {
      status: "error",
      message: "That email and password don't match. If you haven't set a password, use an emailed link.",
      email: typed,
    };
  }
  redirect(next);
}
