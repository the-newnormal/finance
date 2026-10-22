import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireFinance } from "@/lib/session";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import past claims" };

export default async function ImportPage() {
  await requireFinance();
  return (
    <>
      <Link href="/payouts" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="size-4" /> Disbursements</Link>
      <PageHeader
        title="Import past claims"
        description="Bring in claims reimbursed before this app. Each row becomes a reimbursed claim for its member, counts against its budget's guideline, and comes off the bank account it was disbursed from."
      />
      <ImportForm />
    </>
  );
}
