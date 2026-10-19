import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORIGIN = "https://finance.test";
const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();

const get = (query: string) => GET(new NextRequest(`${ORIGIN}/auth/callback${query}`));
function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return POST(new NextRequest(`${ORIGIN}/auth/callback`, { method: "POST", body }));
}
function location(response: Response) {
  expect(response.status).toBe(303);
  return response.headers.get("location");
}

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue({ auth: { verifyOtp, exchangeCodeForSession } } as never);
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
});

describe("GET /auth/callback", () => {
  it("never uses a token_hash on GET: it shows the confirm page", async () => {
    const res = await get("?token_hash=abc&type=email&next=%2Fclaims%2Fnew");
    expect(location(res)).toBe(`${ORIGIN}/auth/confirm?token_hash=abc&type=email&next=%2Fclaims%2Fnew`);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("keeps the invite type for the confirm page", async () => {
    expect(location(await get("?token_hash=inv1&type=invite"))).toBe(`${ORIGIN}/auth/confirm?token_hash=inv1&type=invite&next=%2Fclaims`);
  });

  it("exchanges a PKCE code on GET", async () => {
    expect(location(await get("?code=c0de&next=%2Fbudgets"))).toBe(`${ORIGIN}/budgets`);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("c0de");
  });

  it("sends a failed code exchange back to login, keeping next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "expired" } });
    expect(location(await get("?code=c0de"))).toBe(`${ORIGIN}/login?error=link&next=%2Fclaims`);
  });

  it.each(["recovery", "email_change", "signup"])("refuses link type %s", async (type) => {
    expect(location(await get(`?token_hash=abc&type=${type}`))).toBe(`${ORIGIN}/login?error=link&next=%2Fclaims`);
  });

  it("falls back to /claims for an unsafe next", async () => {
    expect(location(await get("?token_hash=abc&next=%2F%2Fevil.example"))).toBe(`${ORIGIN}/auth/confirm?token_hash=abc&type=email&next=%2Fclaims`);
  });
});

describe("POST /auth/callback", () => {
  it("verifies the token and continues to next", async () => {
    expect(location(await post({ token_hash: "abc", type: "email", next: "/claims/new" }))).toBe(`${ORIGIN}/claims/new`);
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc" });
  });

  it("verifies an invite", async () => {
    await post({ token_hash: "inv1", type: "invite" });
    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "inv1" });
  });

  it("sends a used or expired token back to login", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    expect(location(await post({ token_hash: "old", next: "/claims" }))).toBe(`${ORIGIN}/login?error=link&next=%2Fclaims`);
  });

  it("refuses other link types and unsafe next", async () => {
    expect(location(await post({ token_hash: "abc", type: "recovery" }))).toBe(`${ORIGIN}/login?error=link&next=%2Fclaims`);
    await post({ token_hash: "abc", next: "https://evil.example" });
    expect(verifyOtp).toHaveBeenLastCalledWith({ type: "email", token_hash: "abc" });
  });
});
