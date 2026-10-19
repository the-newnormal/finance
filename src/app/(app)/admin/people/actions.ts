"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { createServiceRoleClient, MissingServiceKeyError } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true } | { ok: false; error: string };

const access = z.object({
  role: z.enum(["volunteer", "core", "admin"]),
  finance: z.boolean(),
  divisionIds: z.array(z.uuid()).max(50),
});

const newMember = access.extend({
  name: z.string().trim().min(1, "Enter a name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
});

const BANNED_FOR = "876000h"; // ~100 years: Supabase's way of saying "until unbanned"

function serviceClient(): ReturnType<typeof createServiceRoleClient> | Result {
  try {
    return createServiceRoleClient();
  } catch (e) {
    if (e instanceof MissingServiceKeyError) return { ok: false, error: e.message };
    throw e;
  }
}

// Creates the login (Supabase sends the invite email) and then, as the signed-in admin, the member
// row: RLS checks the admin again there. If the row can't be added, the login is deleted.
export async function inviteMember(input: z.input<typeof newMember>): Promise<Result> {
  await requireAdmin();
  const parsed = newMember.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return { ok: false, error: "NEXT_PUBLIC_SITE_URL is not set, so invite links can't be built." };
  const service = serviceClient();
  if ("ok" in service) return service;

  const { data, error } = await service.auth.admin.inviteUserByEmail(v.email, {
    redirectTo: `${site}/auth/callback?next=/claims`,
  });
  if (error || !data.user) {
    if (error?.code === "email_exists") return { ok: false, error: "An account with that email already exists." };
    if (error?.code === "over_email_send_rate_limit") {
      return { ok: false, error: "Too many emails were sent just now. Try again in a few minutes." };
    }
    console.error("inviteUserByEmail failed", { code: error?.code, status: error?.status });
    return { ok: false, error: "The invite couldn't be sent. Try again." };
  }

  // The member row and their divisions, in one transaction (admin_add_member, as the admin).
  const supabase = await createClient();
  const { error: addError } = await supabase.rpc("admin_add_member", {
    p_id: data.user.id,
    p_email: v.email,
    p_name: v.name,
    p_role: v.role,
    p_finance: v.finance,
    p_divisions: v.divisionIds,
  });
  if (addError) {
    await service.auth.admin.deleteUser(data.user.id);
    console.error("admin_add_member failed", { code: addError.code });
    return { ok: false, error: "The account couldn't be created." };
  }

  revalidatePath("/admin/people");
  return { ok: true };
}

// Changes someone's role, Finance flag, divisions and whether their account is active, in one
// transaction as the signed-in admin (admin_update_member: RLS, and the database refuses changes to
// your own access). Then the login's ban is set to match, every time, so retrying a save whose ban
// update failed fixes it: deactivated logins can't sign in, and their sessions stop.
export async function updateMember(id: string, input: z.input<typeof access> & { active: boolean }): Promise<Result> {
  await requireAdmin();
  const parsed = access.extend({ active: z.boolean() }).safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success) return { ok: false, error: "Invalid input." };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_member", {
    p_id: id,
    p_role: v.role,
    p_finance: v.finance,
    p_active: v.active,
    p_divisions: v.divisionIds,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "You can't change your own access." };
    if (error.code === "P0002") return { ok: false, error: "That person wasn't found." };
    console.error("admin_update_member failed", { code: error.code });
    return { ok: false, error: "The change couldn't be saved." };
  }
  revalidatePath("/admin/people");

  const service = serviceClient();
  if ("ok" in service) return { ok: false, error: `Saved, but their sign-in wasn't updated. ${service.ok ? "" : service.error}` };
  const { error: banError } = await service.auth.admin.updateUserById(id, {
    ban_duration: v.active ? "none" : BANNED_FOR,
  });
  if (banError) {
    console.error("ban update failed", { code: banError.code });
    return { ok: false, error: "Saved, but their sign-in couldn't be updated. Save again to retry." };
  }
  return { ok: true };
}
