import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

// Sign-in and invite links land here, then continue to `next` (same-site paths only).
// - ?token_hash=…&type=email|invite: from our templates. Works on any device or browser. The one-time
//   token is NOT used on GET: email security scanners open links before people do, which would use
//   it up. GET shows /auth/confirm, whose button POSTs the token back here to sign in.
// - ?code=…: Supabase's default template (PKCE). Only works in the browser that asked for the link,
//   which a scanner doesn't share, so it's exchanged on GET.
// `type` defaults to email; any other value is refused, so a link can't ask for another kind of
// verification (password recovery, email change, …) that this app doesn't handle.
const LINK_TYPES: ReadonlySet<EmailOtpType> = new Set<EmailOtpType>(["email", "invite"]);

const isLinkType = (value: string): value is EmailOtpType => LINK_TYPES.has(value as EmailOtpType);

// Keep where they were going, so the new link they ask for goes there too.
function linkFailed(origin: string, next: string) {
  const login = new URL("/login", origin);
  login.searchParams.set("error", "link");
  login.searchParams.set("next", next);
  return NextResponse.redirect(login, 303);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = searchParams.get("type") ?? "email";
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && isLinkType(type)) {
    const confirm = new URL("/auth/confirm", origin);
    confirm.searchParams.set("token_hash", tokenHash);
    confirm.searchParams.set("type", type);
    confirm.searchParams.set("next", next);
    return NextResponse.redirect(confirm, 303);
  }
  if (code && isLinkType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin), 303);
  }
  return linkFailed(origin, next);
}

// The Continue button on /auth/confirm: uses the one-time token and signs in.
export async function POST(request: NextRequest) {
  const { origin } = request.nextUrl;
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "email");
  const next = safeNextPath(String(form.get("next") ?? ""));

  if (tokenHash && isLinkType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin), 303);
  }
  return linkFailed(origin, next);
}
