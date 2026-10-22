"use client";

import { Download, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { importPaidClaims } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { csvCell } from "@/lib/csv";
import { IMPORT_COLUMNS, MAX_IMPORT_CHARS, parseImport, type ImportRow } from "@/lib/import-claims";
import { formatDate, formatSGD } from "@/lib/money";

const TEMPLATE = [
  IMPORT_COLUMNS.map(csvCell).join(","),
  ["volunteer@example.com", "Community Iftar 2026", "Food & beverages", "Dates and water for 40 volunteers", "42.50", "2026-03-01", "2026-03-05", "DBS 1234567", "Joint Account A"].map(csvCell).join(","),
].join("\r\n");

export function ImportForm() {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(file: File | undefined) {
    setDone(null);
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    if (text.length > MAX_IMPORT_CHARS) {
      setCsv(null);
      setRows([]);
      setErrors(["The file is too large. Split it and import a part at a time."]);
      return;
    }
    const parsed = parseImport(text);
    setCsv(parsed.ok ? text : null);
    setRows(parsed.ok ? parsed.rows : []);
    setErrors(parsed.ok ? [] : parsed.errors);
  }

  async function submit() {
    if (!csv) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await importPaidClaims(csv);
      if (!res.ok) setErrors(res.errors);
      else {
        setDone(res.count);
        setCsv(null);
        setRows([]);
        router.refresh();
      }
    } catch {
      setErrors(["The import couldn't be sent. Check your connection and try again; nothing was imported."]);
    }
    setBusy(false);
  }

  const total = rows.reduce((s, r) => s + r.amount_cents, 0);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Fill in the template</CardTitle>
          <CardDescription>
            One row per claim. Members must already have an account; budget, category and bank account are the names shown in the app.
            Dates can be 2026-03-05 or 5/3/2026. Payments dated before an account&apos;s opening balance are refused: they&apos;re already in it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="import-paid-claims.csv"><Download /> Download template</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Choose the file</CardTitle>
          <CardDescription>Save it from your spreadsheet as CSV. Nothing is saved until you import.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label aria-disabled={busy} className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-ink/25 bg-canvas/60 px-4 py-6 text-sm hover:bg-canvas aria-disabled:pointer-events-none aria-disabled:opacity-50">
            <FileText className="size-5 text-brand-deep" />
            <span className="font-medium">{fileName || "Choose a CSV file"}</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy}
              onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {errors.length > 0 && (
            <Alert>
              <p className="font-medium">Nothing was imported. Fix these and choose the file again:</p>
              <ul className="mt-1 list-disc pl-5">{errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>
              {errors.length > 20 && <p className="mt-1">…and {errors.length - 20} more.</p>}
            </Alert>
          )}
          {done !== null && <Alert tone="success">Imported {done} reimbursed claim{done === 1 ? "" : "s"}.</Alert>}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Check and import · {rows.length} claim{rows.length === 1 ? "" : "s"} · {formatSGD(total)}</CardTitle>
            <CardDescription>All of them are saved together, or none if any row is refused. A row already imported is refused, so importing again is safe.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Table>
              <THead>
                <tr><TH>Disbursed</TH><TH>Member</TH><TH>Budget</TH><TH>Category</TH><TH>Description</TH><TH className="text-right">Amount</TH><TH>Account</TH></tr>
              </THead>
              <TBody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <TD className="whitespace-nowrap">{formatDate(r.paid_on)}</TD>
                    <TD className="whitespace-nowrap">{r.email}</TD>
                    <TD className="whitespace-nowrap">{r.budget}</TD>
                    <TD className="whitespace-nowrap">{r.category}</TD>
                    <TD className="min-w-40">{r.description}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{formatSGD(r.amount_cents)}</TD>
                    <TD className="whitespace-nowrap">{r.account}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
            {rows.length > 200 && <p className="text-sm text-ink-soft">Showing the first 200 rows.</p>}
            <Button className="justify-self-start" size="lg" disabled={busy} onClick={submit}>
              {busy ? "Importing…" : `Import ${rows.length} reimbursed claim${rows.length === 1 ? "" : "s"}`}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
