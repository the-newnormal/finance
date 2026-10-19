import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { canReview, isAdmin, isFinance, type Member } from "@/lib/types";

// The signed-in person's member row, read as them (RLS: their own row only). null when signed out,
// or when they have a login but no active member row. Page guards here only decide what to show;
// RLS decides what anyone can read or change.
export const getMe = cache(async (): Promise<{ user: true; member: Member | null } | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: member } = await supabase
    .from("members")
    .select("id, email, name, role, finance, active")
    .eq("id", uid)
    .maybeSingle<Member>();
  return { user: true, member: member?.active ? member : null };
});

export async function requireMember(): Promise<Member> {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!me.member) redirect("/inactive");
  return me.member;
}

export async function requireReviewer() {
  const me = await requireMember();
  if (!canReview(me)) redirect("/claims");
  return me;
}

export async function requireFinance() {
  const me = await requireMember();
  if (!isFinance(me)) redirect("/claims");
  return me;
}

export async function requireAdmin() {
  const me = await requireMember();
  if (!isAdmin(me)) redirect("/claims");
  return me;
}
