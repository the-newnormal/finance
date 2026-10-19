import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set([
  "email",
  "invite",
  "magiclink",
  "recovery",
  "signup",
  "email_change",
  "phone_change",
]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (!tokenHash || !type || !OTP_TYPES.has(type)) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as "email" | "invite" | "magiclink" | "recovery" | "signup" | "email_change" | "phone_change",
  });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
  }

  return NextResponse.redirect(new URL("/claims", request.url));
}
