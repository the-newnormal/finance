import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Division, Member } from "@/lib/types";
import { PeopleManager } from "./people-manager";

export const metadata = { title: "People" };

export default async function PeoplePage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const [members, divisions, links] = await Promise.all([
    supabase.from("members").select("id, email, name, role, finance, active").order("name"),
    supabase.from("divisions").select("id, name").order("name"),
    supabase.from("division_members").select("member_id, division_id"),
  ]);
  const byMember = new Map<string, string[]>();
  for (const l of links.data ?? []) byMember.set(l.member_id, [...(byMember.get(l.member_id) ?? []), l.division_id]);

  return (
    <>
      <PageHeader title="People" description="Create accounts and decide what each person can see and approve." />
      <PeopleManager
        meId={me.id}
        divisions={(divisions.data ?? []) as Division[]}
        people={((members.data ?? []) as Member[]).map((m) => ({ ...m, divisionIds: byMember.get(m.id) ?? [] }))}
      />
    </>
  );
}
