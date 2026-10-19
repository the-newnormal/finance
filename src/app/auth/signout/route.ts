import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST only, and only from this site, so nothing elsewhere (a link, an image, or a form on a sibling
// subdomain) can sign people out.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const sameSite = origin ? origin === request.nextUrl.origin : request.headers.get("sec-fetch-site") === "same-origin";
  if (!sameSite) return new NextResponse(null, { status: 403 });
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}
