import { formatDate, formatSGD } from "@/lib/money";

/** A ledger entry as an edit saw it (bank_entry_edits.before / after, 0009). */
export type EntrySnapshot = { account_id: string; amount_cents: number; entry_date: string; note: string | null };

export type EntryEdit = { actor_name: string; reason: string; at: string; before: EntrySnapshot; after: EntrySnapshot };

/** A signed amount as the ledger shows it: +$10.00 in, −$10.00 out. */
export function signedSGD(cents: number) {
  return cents === 0 ? formatSGD(0) : `${cents > 0 ? "+" : "−"}${formatSGD(Math.abs(cents))}`;
}

/** What an edit changed, a phrase per field, e.g. "Amount −$25.00 → −$30.00". */
export function describeEdit(edit: Pick<EntryEdit, "before" | "after">, accountName: (id: string) => string): string[] {
  const { before: b, after: a } = edit;
  const changes: string[] = [];
  if (Number(b.amount_cents) !== Number(a.amount_cents)) {
    changes.push(`Amount ${signedSGD(Number(b.amount_cents))} → ${signedSGD(Number(a.amount_cents))}`);
  }
  if (b.entry_date !== a.entry_date) changes.push(`Date ${formatDate(b.entry_date)} → ${formatDate(a.entry_date)}`);
  if (b.account_id !== a.account_id) changes.push(`Account ${accountName(b.account_id)} → ${accountName(a.account_id)}`);
  if ((b.note ?? "") !== (a.note ?? "")) changes.push(`Note “${b.note ?? ""}” → “${a.note ?? ""}”`);
  return changes;
}
