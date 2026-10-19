import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireFinance } from "@/lib/session";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import paid claims" };

export default async function ImportPage() {
  await requireFinance();
  return (
    <>
      <Link href="/payouts" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="size-4" /> Payouts</Link>
      <PageHeader
        title="Import paid claims"
        description="Bring in claims paid before this app. Each row becomes a paid claim for its member, counts against its budget's guideline, and comes off the bank account it was paid from."
      />
      <ImportForm />
    </>
  );
}
