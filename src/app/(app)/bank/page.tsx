import { PageHeader } from "@/components/page-header";
import { fetchAll } from "@/lib/claims";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { BankManager, type Account, type Entry } from "./bank-manager";

export const metadata = { title: "Bank" };

export default async function BankPage() {
  await requireFinance();
  const supabase = await createClient();
  // RLS: Finance and admins only; the page guard above is just for navigation.
  const { data: accounts, error } = await supabase
    .from("bank_balances")
    .select("account_id, name, bank, last4, active, balance_cents, last_entry_date")
    .order("name");
  if (error) throw new Error(`bank read failed: ${error.code}`);
  const entries = await fetchAll<Entry>((from, to) =>
    supabase
      .from("bank_entries")
      .select("id, account_id, kind, amount_cents, entry_date, note, actor_name, created_at")
      .order("entry_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );

  return (
    <>
      <PageHeader
        title="Bank"
        description="Expected balances from everything recorded here. Compare them with DBS iBanking; record any difference as an adjustment. Only Finance and admins can see this page."
      />
      <BankManager
        accounts={(accounts ?? []).map((a) => ({ ...a, balance_cents: Number(a.balance_cents) }) as Account)}
        entries={entries.map((e) => ({ ...e, amount_cents: Number(e.amount_cents) }))}
        today={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date())}
      />
    </>
  );
}
