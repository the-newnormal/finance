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
  divisionIds: z.array(z.uuid()).max(500),
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

  // Someone already on People: never invite them again here (Supabase would return their existing
  // login, and a failed add must not then delete it). Use Resend invite instead.
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase.from("members").select("id").eq("email", v.email).maybeSingle();
  if (existingError) return { ok: false, error: "The account couldn't be created. Try again." };
  if (existing) return { ok: false, error: "That person already has an account. Use Resend invite if they can't sign in." };

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
  const { error: addError } = await supabase.rpc("admin_add_member", {
    p_id: data.user.id,
    p_email: v.email,
    p_name: v.name,
    p_role: v.role,
    p_finance: v.finance,
    p_divisions: v.divisionIds,
  });
  if (addError) {
    console.error("admin_add_member failed", { code: addError.code });
    // 23505: a member row appeared for this login meanwhile; it's someone's account, so leave it.
    if (addError.code === "23505") return { ok: false, error: "That person already has an account." };
    // Undo the login this invite made (no member row had it, checked above), retrying once; if that
    // fails too, say so: a login without a member row can't be re-invited or seen on this page.
    const undo = async () => {
      try {
        return (await service.auth.admin.deleteUser(data.user.id)).error;
      } catch (e) {
        return e as { code?: string };
      }
    };
    const undoError = (await undo()) && (await undo());
    if (undoError) {
      console.error("invite rollback failed", { code: undoError.code ?? "thrown" });
      return {
        ok: false,
        error: `The account couldn't be created, and the login made for ${v.email} couldn't be removed. Delete it in Supabase → Authentication → Users, then try again.`,
      };
    }
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
  // Ban to match what's saved *now*, not what this request sent, so if two admins save at once the
  // login follows the latest save. (Access itself never depends on the ban: RLS checks
  // members.active on every read.)
  const { data: now, error: readError } = await supabase.from("members").select("active").eq("id", id).maybeSingle();
  if (readError || !now) return { ok: false, error: "Saved, but their sign-in couldn't be updated. Save again to retry." };
  const { error: banError } = await service.auth.admin.updateUserById(id, {
    ban_duration: now.active ? "none" : BANNED_FOR,
  });
  if (banError) {
    console.error("ban update failed", { code: banError.code });
    return { ok: false, error: "Saved, but their sign-in couldn't be updated. Save again to retry." };
  }
  return { ok: true };
}

// Sends a new invite to someone who hasn't signed in yet (invite links expire after an hour, and
// until they've used one, Supabase won't email them an ordinary sign-in link). Only for people who
// already have a member row and whose login is still unconfirmed.
export async function resendInvite(id: string): Promise<Result> {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That person wasn't found." };
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return { ok: false, error: "NEXT_PUBLIC_SITE_URL is not set, so invite links can't be built." };

  const supabase = await createClient();
  const { data: member, error } = await supabase.from("members").select("email, active").eq("id", id).maybeSingle();
  if (error || !member) return { ok: false, error: "That person wasn't found." };
  if (!member.active) return { ok: false, error: "Reactivate their account first." };

  const service = serviceClient();
  if ("ok" in service) return service;
  const { data: login } = await service.auth.admin.getUserById(id);
  if (login?.user?.email_confirmed_at) {
    return { ok: false, error: "They've already signed in before: they can request a sign-in link at the login page." };
  }
  const { error: inviteError } = await service.auth.admin.inviteUserByEmail(member.email as string, {
    redirectTo: `${site}/auth/callback?next=/claims`,
  });
  if (inviteError) {
    if (inviteError.code === "over_email_send_rate_limit") {
      return { ok: false, error: "Too many emails were sent just now. Try again in a few minutes." };
    }
    console.error("resend invite failed", { code: inviteError.code });
    return { ok: false, error: "The invite couldn't be sent. Try again." };
  }
  return { ok: true };
}
