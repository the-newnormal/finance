// Row shapes as the app reads them (see supabase/migrations/0001_init.sql). Money is in cents.

export type Role = "volunteer" | "core" | "admin";
export type PoolKind = "event" | "general";
export type ClaimKind = "reimbursement" | "invoice";
export type ClaimStatus = "pending_review" | "pending_finance" | "approved" | "rejected" | "paid";
export type PayoutType = "paynow_mobile" | "paynow_uen" | "bank";

export interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  finance: boolean;
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

export interface Pool {
  id: string;
  name: string;
  kind: PoolKind;
  division_id: string;
  active: boolean;
}

export interface PoolTotals {
  pool_id: string;
  name: string;
  kind: PoolKind;
  division_id: string;
  active: boolean;
  allocated_cents: number;
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
  division_id: string;
  pool_id: string;
  category_id: string;
  description: string;
  amount_cents: number;
  expense_date: string | null;
  vendor_name: string | null;
  due_date: string | null;
  attachment_paths: string[];
  payout_type: PayoutType;
  payout_masked: string;
  rejection_reason: string | null;
  payment_reference: string | null;
  created_at: string;
  updated_at: string;
}

/** Every claims column the Data API may read (payout_enc is never granted). */
export const CLAIM_COLUMNS =
  "id, kind, status, claimant_id, claimant_name, division_id, pool_id, category_id, description, amount_cents, expense_date, vendor_name, due_date, attachment_paths, payout_type, payout_masked, rejection_reason, payment_reference, created_at, updated_at";

export interface ClaimEvent {
  id: number;
  claim_id: string;
  actor_name: string;
  action: "submitted" | "reviewed" | "approved" | "rejected" | "paid";
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

/** Finance and admins see everything and process payouts (private.is_finance()). */
export const isFinance = (m: Pick<Member, "role" | "finance">) => m.finance || m.role === "admin";
export const isAdmin = (m: Pick<Member, "role">) => m.role === "admin";
/** Who gets the Review and Budgets pages. The database decides what they see there. */
export const canReview = (m: Pick<Member, "role" | "finance">) => m.role !== "volunteer" || m.finance;
