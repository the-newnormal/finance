import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient, MissingServiceKeyError } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { inviteMember, updateMember } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn().mockResolvedValue({ id: "admin" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/supabase/admin")>()),
  createServiceRoleClient: vi.fn(),
}));

const USER = "00000000-0000-4000-8000-000000000001";
const DIV = "10000000-0000-4000-8000-000000000001";
const auth = { inviteUserByEmail: vi.fn(), deleteUser: vi.fn(), updateUserById: vi.fn() };
const rpc = vi.fn();
// What members.active reads as after the save (updateMember bans to match it), and whether a member
// row already has the invited email (inviteMember checks first).
let savedActive: boolean;
let existingMember: { id: string } | null;
const from = vi.fn(() => {
  let cols = "";
  const q = {
    select: (c: string) => ((cols = c), q),
    eq: () => q,
    maybeSingle: async () => ({ data: cols === "id" ? existingMember : { active: savedActive }, error: null }),
  };
  return q;
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://finance.test");
  rpc.mockReset().mockResolvedValue({ error: null });
  savedActive = false;
  existingMember = null;
  vi.mocked(createClient).mockResolvedValue({ rpc, from } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue({ auth: { admin: auth } } as never);
  auth.inviteUserByEmail.mockReset().mockResolvedValue({ data: { user: { id: USER } }, error: null });
  auth.deleteUser.mockReset().mockResolvedValue({ error: null });
  auth.updateUserById.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const person = { name: " Mei Tan ", email: " Mei@Example.COM ", role: "core" as const, finance: false, divisionIds: [DIV] };

describe("inviteMember", () => {
  it("invites the normalised email, then adds the member and divisions in one call as the admin", async () => {
    expect(await inviteMember(person)).toEqual({ ok: true });
    expect(auth.inviteUserByEmail).toHaveBeenCalledWith("mei@example.com", {
      redirectTo: "https://finance.test/auth/callback?next=/claims",
    });
    expect(rpc).toHaveBeenCalledWith("admin_add_member", {
      p_id: USER, p_email: "mei@example.com", p_name: "Mei Tan", p_role: "core", p_finance: false, p_divisions: [DIV],
    });
  });

  it("deletes the new login if the member can't be added", async () => {
    rpc.mockResolvedValue({ error: { code: "23503" } });
    expect(await inviteMember(person)).toEqual({ ok: false, error: "The account couldn't be created." });
    expect(auth.deleteUser).toHaveBeenCalledWith(USER);
  });

  it("retries the rollback, then says if the login was left behind", async () => {
    rpc.mockResolvedValue({ error: { code: "23503" } });
    auth.deleteUser.mockResolvedValue({ error: { code: "unexpected_failure" } });
    const res = await inviteMember(person);
    expect(auth.deleteUser).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("couldn't be removed");
  });

  it("never re-invites someone already on People (a failed add would delete their login)", async () => {
    existingMember = { id: USER };
    expect(await inviteMember(person)).toEqual({ ok: false, error: "That person already has an account. Use Resend invite if they can't sign in." });
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("leaves the login alone if the member row appeared meanwhile (23505)", async () => {
    rpc.mockResolvedValue({ error: { code: "23505" } });
    expect(await inviteMember(person)).toEqual({ ok: false, error: "That person already has an account." });
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  it("treats a thrown rollback like a failed one", async () => {
    rpc.mockResolvedValue({ error: { code: "23503" } });
    auth.deleteUser.mockRejectedValue(new Error("network"));
    const res = await inviteMember(person);
    expect(auth.deleteUser).toHaveBeenCalledTimes(2);
    expect(!res.ok && res.error).toContain("couldn't be removed");
  });

  it("says when the email already has an account", async () => {
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { code: "email_exists" } });
    expect(await inviteMember(person)).toEqual({ ok: false, error: "An account with that email already exists." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses invalid input before inviting anyone", async () => {
    expect(await inviteMember({ ...person, email: "nope" })).toEqual({ ok: false, error: "Enter a valid email" });
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("explains a missing service key", async () => {
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new MissingServiceKeyError();
    });
    expect((await inviteMember(person)).ok).toBe(false);
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });
});

describe("updateMember", () => {
  const access = { role: "volunteer" as const, finance: false, divisionIds: [], active: false };

  it("saves access in one call, then bans a deactivated login", async () => {
    expect(await updateMember(USER, access)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admin_update_member", {
      p_id: USER, p_role: "volunteer", p_finance: false, p_active: false, p_divisions: [],
    });
    expect(auth.updateUserById).toHaveBeenCalledWith(USER, { ban_duration: "876000h" });
  });

  it("lifts the ban for an active account, every time (so a retry fixes a failed one)", async () => {
    savedActive = true;
    await updateMember(USER, { ...access, active: true });
    expect(auth.updateUserById).toHaveBeenCalledWith(USER, { ban_duration: "none" });
  });

  it("bans to match what's saved now, not what this request sent", async () => {
    savedActive = true; // another admin reactivated them meanwhile
    await updateMember(USER, access);
    expect(auth.updateUserById).toHaveBeenCalledWith(USER, { ban_duration: "none" });
  });

  it("says so when the ban couldn't be updated", async () => {
    auth.updateUserById.mockResolvedValue({ error: { code: "unexpected_failure" } });
    expect(await updateMember(USER, access)).toEqual({
      ok: false, error: "Saved, but their sign-in couldn't be updated. Save again to retry.",
    });
  });

  it("explains the database's refusal to change your own access", async () => {
    rpc.mockResolvedValue({ error: { code: "42501" } });
    expect(await updateMember(USER, access)).toEqual({ ok: false, error: "You can't change your own access." });
    expect(auth.updateUserById).not.toHaveBeenCalled();
  });
});
