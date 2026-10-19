import { PageHeader } from "@/components/page-header";
import { fetchAll } from "@/lib/fetch-all";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Division, Member } from "@/lib/types";
import { PeopleManager } from "./people-manager";

export const metadata = { title: "People" };

export default async function PeoplePage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  // Every row: an admin saving someone must see all of their divisions, or the save would drop some.
  const [members, divisions, links] = await Promise.all([
    fetchAll<Member>((from, to) => supabase.from("members").select("id, email, name, role, finance, active").order("created_at").order("id").range(from, to)),
    fetchAll<Division>((from, to) => supabase.from("divisions").select("id, name").order("name").order("id").range(from, to)),
    fetchAll<{ member_id: string; division_id: string }>((from, to) =>
      supabase.from("division_members").select("member_id, division_id").order("member_id").order("division_id").range(from, to)),
  ]);
  const byMember = new Map<string, string[]>();
  for (const l of links) byMember.set(l.member_id, [...(byMember.get(l.member_id) ?? []), l.division_id]);

  return (
    <>
      <PageHeader title="People" description="Create accounts and decide what each person can see and approve." />
      <PeopleManager
        meId={me.id}
        divisions={divisions}
        people={[...members].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ ...m, divisionIds: byMember.get(m.id) ?? [] }))}
      />
    </>
  );
}
