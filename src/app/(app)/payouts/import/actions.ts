"use server";

import { revalidatePath } from "next/cache";
import { MAX_IMPORT_CHARS, parseImport } from "@/lib/import-claims";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ImportResult = { ok: true; count: number } | { ok: false; errors: string[] };

// Re-reads the file here (the browser's preview is only a preview), then imports every row in one
// database transaction: if any row is refused, nothing is saved. The database checks the names and
// dates and says which row is wrong, in words meant for Finance.
export async function importPaidClaims(csv: string): Promise<ImportResult> {
  await requireFinance();
  if (csv.length > MAX_IMPORT_CHARS) return { ok: false, errors: ["The file is too large. Split it and import a part at a time."] };
  const parsed = parseImport(csv);
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_paid_claims", { p_rows: parsed.rows });
  if (error) {
    if (["P0001", "P0002", "42501"].includes(error.code ?? "")) return { ok: false, errors: [error.message] };
    console.error("claim import failed", { code: error.code });
    return { ok: false, errors: ["The import couldn't be saved. Nothing was imported; try again."] };
  }

  revalidatePath("/payouts");
  revalidatePath("/budgets");
  revalidatePath("/bank");
  return { ok: true, count: data as number };
}
