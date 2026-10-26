import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { setPassword } from "./actions";

vi.mock("@/lib/session", () => ({ requireMember: vi.fn(async () => ({ id: "me" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const getClaims = vi.fn();
const updateUser = vi.fn();
const fresh = () => ({ data: { claims: { amr: [{ method: "otp", timestamp: Date.now() / 1000 - 60 }] } } });
const good = "correct horse battery";

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue(fresh());
  updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { getClaims, updateUser } } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setPassword", () => {
  it("sets the password after a recent sign-in", async () => {
    expect(await setPassword(good, good)).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ password: good });
  });

  it("checks the two match, the length, and bcrypt's 72 bytes", async () => {
    expect(await setPassword(good, "other")).toMatchObject({ ok: false, error: "The two passwords don't match." });
    expect(await setPassword("short", "short")).toMatchObject({ ok: false, error: "Use at least 12 characters." });
    const long = "é".repeat(40); // 80 bytes
    expect(await setPassword(long, long)).toMatchObject({ ok: false });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("asks for a fresh sign-in when the session is old", async () => {
    getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "otp", timestamp: 1 }] } } });
    expect(await setPassword(good, good)).toMatchObject({ ok: false, resign: true });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("explains a weak password, and hides unexpected errors", async () => {
    updateUser.mockResolvedValueOnce({ error: { code: "weak_password", status: 422 } });
    expect(await setPassword(good, good)).toMatchObject({ ok: false, error: expect.stringContaining("too easy to guess") });
    updateUser.mockResolvedValueOnce({ error: { code: "boom", status: 500 } });
    expect(await setPassword(good, good)).toEqual({ ok: false, error: "Your password couldn't be saved. Try again." });
    expect(console.error).toHaveBeenCalledWith("password update failed", { code: "boom", status: 500 });
  });
});
