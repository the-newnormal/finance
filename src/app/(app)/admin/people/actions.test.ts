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

// A minimal query-builder stand-in: every call chains, and awaiting it yields `result`.
function table(result: { data?: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "upsert"]) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(() => Promise.resolve(result));
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}

let tables: Record<string, ReturnType<typeof table>>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://finance.test");
  tables = { members: table({ error: null }), division_members: table({ error: null }) };
  vi.mocked(createClient).mockResolvedValue({ from: (t: string) => tables[t] } as never);
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
  it("invites the normalised email, then adds the member row as the admin", async () => {
    expect(await inviteMember(person)).toEqual({ ok: true });
    expect(auth.inviteUserByEmail).toHaveBeenCalledWith("mei@example.com", {
      redirectTo: "https://finance.test/auth/callback?next=/claims",
    });
    expect(tables.members.insert).toHaveBeenCalledWith({
      id: USER, email: "mei@example.com", name: "Mei Tan", role: "core", finance: false,
    });
    expect(tables.division_members.insert).toHaveBeenCalledWith([{ member_id: USER, division_id: DIV }]);
  });

  it("deletes the new login if the member row can't be added", async () => {
    tables.members = table({ error: { code: "42501" } });
    expect(await inviteMember(person)).toEqual({ ok: false, error: "The account couldn't be created." });
    expect(auth.deleteUser).toHaveBeenCalledWith(USER);
  });

  it("says when the email already has an account", async () => {
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { code: "email_exists" } });
    expect(await inviteMember(person)).toEqual({ ok: false, error: "An account with that email already exists." });
    expect(tables.members.insert).not.toHaveBeenCalled();
  });

  it("gives volunteers no divisions", async () => {
    await inviteMember({ ...person, role: "volunteer" });
    expect(tables.division_members.insert).not.toHaveBeenCalled();
  });

  it("refuses invalid input before inviting anyone", async () => {
    expect(await inviteMember({ ...person, email: "nope" })).toEqual({ ok: false, error: "Enter a valid email" });
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("explains a missing service key", async () => {
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new MissingServiceKeyError();
    });
    const res = await inviteMember(person);
    expect(res.ok).toBe(false);
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });
});

describe("updateMember", () => {
  const access = { role: "volunteer" as const, finance: false, divisionIds: [], active: false };

  it("bans the login when an account is deactivated", async () => {
    tables.members = table({ data: { active: true }, error: null });
    expect(await updateMember(USER, access)).toEqual({ ok: true });
    expect(auth.updateUserById).toHaveBeenCalledWith(USER, { ban_duration: "876000h" });
  });

  it("lifts the ban when an account is reactivated", async () => {
    tables.members = table({ data: { active: false }, error: null });
    await updateMember(USER, { ...access, active: true });
    expect(auth.updateUserById).toHaveBeenCalledWith(USER, { ban_duration: "none" });
  });

  it("leaves the login alone when active doesn't change", async () => {
    tables.members = table({ data: { active: false }, error: null });
    await updateMember(USER, access);
    expect(auth.updateUserById).not.toHaveBeenCalled();
  });

  it("explains the database's refusal to change your own access", async () => {
    const t = table({ data: { active: true }, error: null });
    t.update = vi.fn(() => table({ error: { code: "42501" } }));
    tables.members = t;
    expect(await updateMember(USER, access)).toEqual({ ok: false, error: "You can't change your own access." });
  });
});
