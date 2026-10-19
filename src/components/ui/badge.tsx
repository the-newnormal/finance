import { cn } from "@/lib/utils";
import { STATUS_LABEL, type ClaimStatus } from "@/lib/types";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)}>{children}</span>;
}

const tone: Record<ClaimStatus, string> = {
  pending_review: "bg-lavender/60 text-ink",
  pending_finance: "bg-yellow/60 text-ink",
  approved: "bg-teal/70 text-ink",
  paid: "bg-brand-deep text-white",
  rejected: "bg-orange/40 text-ink",
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return <Badge className={tone[status]}>{STATUS_LABEL[status]}</Badge>;
}
