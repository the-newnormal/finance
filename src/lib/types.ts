// Row shapes as the app reads them (see supabase/migrations/). Money is in cents.

export type Role = "volunteer" | "lead" | "finance";
export type BudgetKind = "event" | "general";
export type ClaimKind = "reimbursement" | "invoice";
export type ClaimStatus = "pending_review" | "pending_finance" | "approved" | "rejected" | "paid";
export type PayoutType = "paynow_mobile" | "paynow_uen" | "bank";

export interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
}

export interface Division {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
}

export interface Budget {
  id: string;
  name: string;
  kind: BudgetKind;
  /** null only for the reserve, which belongs to no division (0006). */
  division_id: string | null;
  active: boolean;
  is_reserve: boolean;
}

/** budget_totals: one row per budget in the viewer's purview. */
export interface BudgetTotals {
  budget_id: string;
  name: string;
  kind: BudgetKind;
  /** null only for the reserve (0006). */
  division_id: string | null;
  active: boolean;
  guideline_cents: number;
  pending_cents: number;
  approved_cents: number;
  paid_cents: number;
  is_reserve: boolean;
  /** The reserve's funds (the sum of its additions); 0 for every other budget. */
  funded_cents: number;
  /** Funding (0010). The grant committed to the budget; 0 for the reserve. */
  grant_committed_cents: number;
  /** Grants received, loans from the reserve, and repayments to it; 0 for the reserve. */
  granted_cents: number;
  loaned_cents: number;
  repaid_cents: number;
  /** What it can still spend: its funds less approved and disbursed claims (the reserve: less loans out too). */
  available_cents: number;
  /** The reserve only: loans out, not yet repaid. */
  lent_out_cents: number;
}

export type BudgetFundKind = "grant" | "loan" | "repayment";

/** budget_funds (0010): a budget's grants, loans from the reserve and repayments. Append-only. */
export interface BudgetFund {
  id: number;
  budget_id: string;
  kind: BudgetFundKind;
  amount_cents: number;
  entry_date: string;
  note: string;
  actor_name: string;
}

export const FUND_KIND_LABEL: Record<BudgetFundKind, string> = {
  grant: "Grant received",
  loan: "Loan from the reserve",
  repayment: "Repaid to the reserve",
};

/** guideline_totals: spending against one provisioned category of one budget. */
export interface GuidelineTotals {
  budget_id: string;
  category_id: string;
  category_name: string;
  guideline_cents: number;
  pending_cents: number;
  approved_cents: number;
  paid_cents: number;
}

export interface Claim {
  id: string;
  kind: ClaimKind;
  status: ClaimStatus;
  claimant_id: string;
  claimant_name: string;
  /** null for reserve claims. */
  division_id: string | null;
  budget_id: string;
  category_id: string;
  description: string;
  amount_cents: number;
  expense_date: string | null;
  vendor_name: string | null;
  due_date: string | null;
  attachment_paths: string[];
  /** null only on imported claims, which were paid before this app. */
  payout_type: PayoutType | null;
  payout_masked: string | null;
  rejection_reason: string | null;
  payment_reference: string | null;
  /** Paid before this app existed and imported by Finance (0005). */
  imported: boolean;
  created_at: string;
  updated_at: string;
}

/** Every claims column the Data API may read (payout_enc is never granted). */
export const CLAIM_COLUMNS =
  "id, kind, status, claimant_id, claimant_name, division_id, budget_id, category_id, description, amount_cents, expense_date, vendor_name, due_date, attachment_paths, payout_type, payout_masked, rejection_reason, payment_reference, imported, created_at, updated_at";

export type ClaimRuleScope = "all" | "reimbursement" | "invoice";

/** claim_rules (0007): a notice the claim form shows. Plain text, never HTML. */
export interface ClaimRule {
  id: string;
  title: string;
  body: string;
  applies_to: ClaimRuleScope;
  link_label: string | null;
  link_url: string | null;
  sort_order: number;
  active: boolean;
}

export const RULE_SCOPE_LABEL: Record<ClaimRuleScope, string> = {
  all: "Every claim",
  reimbursement: "Reimbursements",
  invoice: "Vendor invoices",
};

export type ReceiptVerdict = "looks_right" | "check_needed" | "unreadable";

/** receipt_checks.findings (0008): what Claude read and compared. Shape: CheckResult in receipt-check.ts. */
export interface ReceiptFindings {
  documents?: { file: string; kind: string; merchant: string | null; date: string | null; total: string | null;
    reference: string | null; payment_method: string | null; items: string | null }[];
  document_kind?: "receipt" | "paid_invoice" | "vendor_invoice" | "unclear";
  fields?: { field: string; shown: "yes" | "no" | "unclear"; value: string | null }[];
  amount_matches?: "yes" | "no" | "unclear";
  date_matches?: "yes" | "no" | "unclear" | "not_given";
  missing?: string[];
  concerns?: string[];
  skipped?: { name: string; reason: string }[];
}

/** receipt_checks (0008): a reviewer's AI receipt check of a claim, advice for them alone. */
export interface ReceiptCheck {
  verdict: ReceiptVerdict;
  summary: string;
  findings: ReceiptFindings;
  files_checked: number;
  model: string;
  checked_at: string;
}

export interface ReserveAddition {
  id: number;
  amount_cents: number;
  added_on: string;
  note: string;
  actor_name: string;
}

export interface ClaimEvent {
  id: number;
  claim_id: string;
  actor_name: string;
  action: "submitted" | "reviewed" | "approved" | "rejected" | "paid" | "edited";
  note: string | null;
  at: string;
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  pending_review: "Awaiting review",
  pending_finance: "Awaiting Finance",
  approved: "Approved · to be paid",
  rejected: "Rejected",
  paid: "Paid",
};

export const PAYOUT_LABEL: Record<PayoutType, string> = {
  paynow_mobile: "PayNow (mobile)",
  paynow_uen: "PayNow (UEN)",
  bank: "Bank transfer",
};

export const ROLE_LABEL: Record<Role, string> = {
  volunteer: "Volunteer",
  lead: "Division lead",
  finance: "Finance",
};

/** Finance sees everything, gives final approval, pays, and sets everything up (private.is_finance()). */
export const isFinance = (m: Pick<Member, "role">) => m.role === "finance";
/** Who gets the Review and Budgets pages. The database decides what they see there. */
export const canReview = (m: Pick<Member, "role">) => m.role !== "volunteer";
/** Vendor invoices: leads and Finance. */
export const canInvoice = canReview;
