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

  const supabase = await createClient();
  const { error: insertError } = await supabase.from("members").insert({
    id: data.user.id,
    email: v.email,
    name: v.name,
    role: v.role,
    finance: v.finance,
  });
  if (insertError) {
    await service.auth.admin.deleteUser(data.user.id);
    console.error("members insert failed", { code: insertError.code });
    return { ok: false, error: "The account couldn't be created." };
  }

  const divisionError = await setDivisions(supabase, data.user.id, v.role === "volunteer" ? [] : v.divisionIds);
  revalidatePath("/admin/people");
  return divisionError ?? { ok: true };
}

// Changes someone's role, Finance flag, divisions and whether their account is active, as the
// signed-in admin (RLS; the database refuses changes to your own access). Deactivating also bans
// the login, so their current sessions stop working.
export async function updateMember(id: string, input: z.input<typeof access> & { active: boolean }): Promise<Result> {
  await requireAdmin();
  const parsed = access.extend({ active: z.boolean() }).safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success) return { ok: false, error: "Invalid input." };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: before } = await supabase.from("members").select("active").eq("id", id).maybeSingle();
  if (!before) return { ok: false, error: "That person wasn't found." };

  const { error } = await supabase
    .from("members")
    .update({ role: v.role, finance: v.finance, active: v.active })
    .eq("id", id);
  if (error) {
    if (error.code === "42501") return { ok: false, error: "You can't change your own access." };
    console.error("members update failed", { code: error.code });
    return { ok: false, error: "The change couldn't be saved." };
  }

  const divisionError = await setDivisions(supabase, id, v.role === "volunteer" ? [] : v.divisionIds);
  if (divisionError) return divisionError;

  if (before.active !== v.active) {
    const service = serviceClient();
    if ("ok" in service) return service;
    const { error: banError } = await service.auth.admin.updateUserById(id, {
      ban_duration: v.active ? "none" : BANNED_FOR,
    });
    if (banError) {
      console.error("ban update failed", { code: banError.code });
      return { ok: false, error: "Saved, but their sign-in couldn't be updated. Try again." };
    }
  }

  revalidatePath("/admin/people");
  return { ok: true };
}

async function setDivisions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
  divisionIds: string[],
): Promise<Result | null> {
  const { error: delError } = await supabase.from("division_members").delete().eq("member_id", memberId);
  if (!delError && divisionIds.length) {
    const { error } = await supabase
      .from("division_members")
      .insert(divisionIds.map((division_id) => ({ member_id: memberId, division_id })));
    if (!error) return null;
    console.error("division_members insert failed", { code: error.code });
  } else if (!delError) {
    return null;
  }
  return { ok: false, error: "Saved, but their divisions couldn't be updated. Try again." };
}
