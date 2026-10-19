import { PageHeader } from "@/components/page-header";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { BankManager, type Account, type Entry } from "./bank-manager";

export const metadata = { title: "Bank" };

const PAGE = 100;

export default async function BankPage({ searchParams }: PageProps<"/bank">) {
  await requireFinance();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // Anything malformed is ignored (all accounts, first page) rather than reaching the query.
  const rawAccount = one(params.account) ?? "";
  const account = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawAccount) ? rawAccount : null;
  const rawPage = one(params.page) ?? "0";
  const page = /^\d{1,6}$/.test(rawPage) ? Number(rawPage) : 0;
  const supabase = await createClient();
  // RLS: Finance only; the page guard above is just for navigation.
  const { data: accounts, error } = await supabase
    .from("bank_balances")
    .select("account_id, name, bank, last4, active, balance_cents, last_entry_date")
    .order("name");
  if (error) throw new Error(`bank read failed: ${error.code}`);
  // The ledger, a page at a time (one extra row says whether there's an older page).
  let query = supabase
    .from("bank_entries")
    .select("id, account_id, kind, amount_cents, entry_date, note, actor_name, created_at")
    .order("entry_date", { ascending: false })
    .order("id", { ascending: false });
  if (account) query = query.eq("account_id", account);
  const { data: rows, error: ledgerError } = await query.range(page * PAGE, page * PAGE + PAGE);
  if (ledgerError) throw new Error(`ledger read failed: ${ledgerError.code}`);
  const entries = (rows ?? []) as Entry[];

  return (
    <>
      <PageHeader
        title="Bank"
        description="Expected balances from everything recorded here. Compare them with DBS iBanking; record any difference as an adjustment. Only Finance can see this page."
      />
      <BankManager
        accounts={(accounts ?? []).map((a) => ({ ...a, balance_cents: Number(a.balance_cents) }) as Account)}
        entries={entries.slice(0, PAGE).map((e) => ({ ...e, amount_cents: Number(e.amount_cents) }))}
        ledger={{ account, page, hasOlder: entries.length > PAGE }}
        today={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date())}
      />
    </>
  );
}
