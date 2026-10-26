"use server";

import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { recentlySignedIn } from "@/lib/auth/recent";

export type PasswordResult = { ok: true } | { ok: false; error: string; resign?: boolean };

/** Supabase hashes passwords with bcrypt, which reads at most 72 bytes. */
const MIN = 12;
const MAX_BYTES = 72;

// Sets or changes the signed-in member's password. Only within a few minutes of signing in, so
// someone using a session left open on a shared computer can't quietly set one.
export async function setPassword(password: string, confirm: string): Promise<PasswordResult> {
  await requireMember();
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };
  if (password.length < MIN) return { ok: false, error: `Use at least ${MIN} characters.` };
  if (new TextEncoder().encode(password).length > MAX_BYTES) return { ok: false, error: "Use a shorter password (at most 72 characters)." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!recentlySignedIn(data?.claims)) {
    return { ok: false, resign: true, error: "For your security, sign in again (with an emailed link or your current password), then set it within 15 minutes." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "weak_password") return { ok: false, error: "That password is too easy to guess, or has appeared in a data breach. Choose another." };
    if (error.code === "same_password") return { ok: false, error: "That's already your password." };
    if (error.code === "reauthentication_needed") {
      return { ok: false, resign: true, error: "For your security, sign in again, then set it within 15 minutes." };
    }
    console.error("password update failed", { code: error.code, status: error.status });
    return { ok: false, error: "Your password couldn't be saved. Try again." };
  }
  return { ok: true };
}
