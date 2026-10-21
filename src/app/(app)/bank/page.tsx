import { PageHeader } from "@/components/page-header";
import type { EntryEdit } from "@/lib/bank-edits";
import { fetchAll, paidFor } from "@/lib/claims";
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
    .select("id, account_id, kind, amount_cents, entry_date, note, claim_id, actor_name, created_at")
    .order("entry_date", { ascending: false })
    .order("id", { ascending: false });
  if (account) query = query.eq("account_id", account);
  const { data: rows, error: ledgerError } = await query.range(page * PAGE, page * PAGE + PAGE);
  if (ledgerError) throw new Error(`ledger read failed: ${ledgerError.code}`);
  const entries = (rows ?? []) as Omit<Entry, "paid_for" | "reference" | "edits">[];
  const shown = entries.slice(0, PAGE);
  // A payout's note (written when it was paid) says who was paid and the bank reference; the ledger
  // leads with what the claim was for, read from the claim itself. If that can't be read, the note
  // alone is shown.
  const claimIds = shown.flatMap((e) => (e.claim_id ? [e.claim_id] : []));
  const paid = new Map<string, { paidFor: string; reference: string | null }>();
  if (claimIds.length) {
    const { data: claims, error: claimsError } = await supabase.from("claims")
      .select("id, kind, description, vendor_name, payment_reference").in("id", claimIds);
    if (claimsError) console.error("ledger claims read failed", { code: claimsError.code });
    for (const c of claims ?? []) {
      paid.set(c.id as string, { paidFor: paidFor(c as Parameters<typeof paidFor>[0]), reference: c.payment_reference as string | null });
    }
  }
  // Each shown entry's edits, oldest first (0009), every page of them. If they can't all be read,
  // none are shown, and the page says so rather than show part of a history.
  const edits = new Map<number, EntryEdit[]>();
  let historyMissing = false;
  if (shown.length) {
    try {
      const editRows = await fetchAll((from, to) => supabase.from("bank_entry_edits")
        .select("id, entry_id, actor_name, reason, before, after, at").in("entry_id", shown.map((e) => e.id))
        .order("id").range(from, to));
      for (const r of editRows) {
        const id = Number(r.entry_id);
        edits.set(id, [...(edits.get(id) ?? []), r as unknown as EntryEdit]);
      }
    } catch (e) {
      console.error("ledger edits read failed", { code: e instanceof Error ? e.message : "unknown" });
      historyMissing = true;
    }
  }

  return (
    <>
      <PageHeader
        title="Bank"
        description="Expected balances from everything recorded here. Compare them with DBS iBanking; record any difference as an adjustment. Only Finance can see this page."
      />
      <BankManager
        accounts={(accounts ?? []).map((a) => ({ ...a, balance_cents: Number(a.balance_cents) }) as Account)}
        entries={shown.map((e) => {
          const claim = e.claim_id ? paid.get(e.claim_id) : undefined;
          return {
            ...e, amount_cents: Number(e.amount_cents),
            paid_for: claim?.paidFor ?? null, reference: claim?.reference ?? null, edits: edits.get(e.id) ?? [],
          };
        })}
        ledger={{ account, page, hasOlder: entries.length > PAGE }}
        historyMissing={historyMissing}
        today={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date())}
      />
    </>
  );
}
