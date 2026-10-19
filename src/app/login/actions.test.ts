import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { sendMagicLink } from "./actions";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const signInWithOtp = vi.fn();

function submit(email: string, next?: string) {
  const form = new FormData();
  form.set("email", email);
  if (next !== undefined) form.set("next", next);
  return sendMagicLink({ status: "idle" }, form);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://finance.test");
  vi.mocked(createClient).mockResolvedValue({ auth: { signInWithOtp } } as never);
  signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendMagicLink", () => {
  it("rejects an invalid email and echoes what was typed", async () => {
    expect(await submit(" not-an-email ")).toEqual({
      status: "error",
      message: "Enter a valid email address.",
      email: " not-an-email ",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends an invite-only link that returns to /auth/callback with next", async () => {
    expect(await submit("  Ada@NewNormal.SG ", "/claims/new?week=2")).toEqual({
      status: "sent",
      email: "ada@newnormal.sg",
    });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "ada@newnormal.sg",
      options: {
        shouldCreateUser: false,
        emailRedirectTo:
          "https://finance.test/auth/callback?next=%2Fclaims%2Fnew%3Fweek%3D2",
      },
    });
  });

  it("falls back to /claims for an unsafe next", async () => {
    await submit("ada@newnormal.sg", "//evil.example");
    const { options } = signInWithOtp.mock.calls[0][0];
    expect(options.emailRedirectTo).toBe("https://finance.test/auth/callback?next=%2Fclaims");
  });

  it("builds the link from the configured site URL, never from request headers", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://finance.vercel.app");
    await submit("ada@newnormal.sg");
    const { options } = signInWithOtp.mock.calls[0][0];
    expect(options.emailRedirectTo).toBe("https://finance.vercel.app/auth/callback?next=%2Fclaims");
  });

  // Errors that depend on the account (or its email limits) must look like success,
  // so the form can't be used to find out who's been invited.
  it.each([
    ["otp_disabled", 422],
    ["signup_disabled", 422],
    ["user_not_found", 400],
    ["over_email_send_rate_limit", 429],
    ["email_address_not_authorized", 400],
    ["unexpected_failure", 500],
  ])("replies 'sent' for %s", async (code, status) => {
    signInWithOtp.mockResolvedValue({ data: {}, error: new AuthApiError("nope", status, code) });
    expect(await submit("ada@newnormal.sg")).toEqual({ status: "sent", email: "ada@newnormal.sg" });
    expect(console.error).toHaveBeenCalledWith("signInWithOtp failed", { code, status });
  });

  it("asks the user to wait only on the per-IP request limit", async () => {
    signInWithOtp.mockResolvedValue({
      data: {},
      error: new AuthApiError("slow down", 429, "over_request_rate_limit"),
    });
    expect(await submit("Ada@newnormal.sg")).toEqual({
      status: "error",
      message: "Too many attempts. Wait a minute, then try again.",
      email: "Ada@newnormal.sg",
    });
  });

  it.each([
    ["a network failure (status 0)", new AuthRetryableFetchError("fetch failed", 0)],
    ["an error without a status", new AuthUnknownError("bad JSON", new SyntaxError())],
  ])("says it can't reach the sign-in service on %s", async (_label, error) => {
    signInWithOtp.mockResolvedValue({ data: {}, error });
    expect(await submit("ada@newnormal.sg")).toEqual({
      status: "error",
      message: "Couldn't reach the sign-in service. Try again.",
      email: "ada@newnormal.sg",
    });
  });
});
