// What each kind of document must show: the mandatory fields TRP's finance system asks for, word
// for word. The claim form lists the ones that apply; reviewers check them.

/** A reimbursement is backed by a receipt, or by an invoice the claimant paid; a vendor invoice is unpaid. */
export type DocumentKind = "receipt" | "paid_invoice" | "vendor_invoice";

export const DOCUMENT_FIELDS: Record<DocumentKind, { label: string; fields: readonly string[] }> = {
  receipt: {
    label: "Receipt",
    fields: ["Date Of Transaction", "Location Of Transaction", "Products/Services Bought", "Receipt/Reference Number", "Total Cost", "Payment Method"],
  },
  // An invoice the claimant paid themselves, so with proof that they paid it.
  paid_invoice: {
    label: "Invoice",
    fields: [
      "Date Of Invoice", "Products/Services Bought", "Invoice/Reference Number", "Total Cost", "Payment Method",
      "Proof Of Payment — Date Of Transaction", "Proof Of Payment — Payee", "Proof Of Payment — Total Amount Paid",
    ],
  },
  // A vendor's invoice that Finance will pay: nothing is paid yet, so there's no proof of payment.
  vendor_invoice: {
    label: "Invoice",
    fields: ["Date Of Invoice", "Products/Services Bought", "Invoice/Reference Number", "Total Cost", "Payment Method"],
  },
};
