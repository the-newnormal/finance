// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadable } from "@/lib/receipt-upload";
import { createClient } from "@/lib/supabase/client";
import { submitClaim } from "../actions";
import { precheckClaim } from "../precheck-actions";
import { ClaimForm } from "./claim-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../actions", () => ({ submitClaim: vi.fn(), forgetSavedPayout: vi.fn() }));
vi.mock("../precheck-actions", () => ({ precheckClaim: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/receipt-upload", async (original) => ({ ...await original(), uploadable: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rules = [
  { id: "r1", title: "Accuracy and processing time", body: "May take up to 15 working days.", applies_to: "all" as const, link_label: null, link_url: null },
  { id: "r2", title: "Invoices only", body: "For vendors.", applies_to: "invoice" as const, link_label: null, link_url: null },
];

let root: Root;
let el: HTMLDivElement;

async function render(aiCheck: boolean) {
  await act(async () => root.render(
    <ClaimForm uid="u1" today="2026-10-20" canInvoice={false} goesStraightToFinance={false} budgets={[]} provisions={[]}
      categories={[]} savedPayout={null} rules={rules} aiCheck={aiCheck} />,
  ));
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(uploadable).mockImplementation(async (f) => f);
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await render(false);
});

afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

const radio = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === name)!;
const fileInputs = () => [...el.querySelectorAll<HTMLInputElement>('input[type="file"]')];

async function attach(input: HTMLInputElement, name: string, type = "image/jpeg") {
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], name, { type })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

// Skips the browser's own checks of required fields, to reach the form's.
async function submit() {
  await act(async () => el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

// A reimbursement with a receipt, ready to submit; uploads succeed and the claim goes in.
async function fill() {
  vi.mocked(createClient).mockReturnValue({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } } as never);
  vi.mocked(submitClaim).mockResolvedValue({ ok: true, id: "claim-1", payoutSaved: true });
  await attach(fileInputs()[0], "receipt.jpg");
  const set = (name: string, value: string) => { el.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value; };
  set("amount", "42.50");
  set("expenseDate", "2026-10-01");
  set("description", "Snacks for volunteers");
  set("payeeName", "Tan Ah Kow");
  set("proxy", "9123 4567");
  el.querySelector<HTMLInputElement>('input[name="agreed"]')!.checked = true;
}

const submitButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!;

// Types into a field as a person would, so React sees the change.
async function type(name: string, value: string) {
  const input = el.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ClaimForm", () => {
  it("shows the rules for the claim in its declaration, and must be agreed to", () => {
    const declaration = el.textContent!;
    expect(declaration).toContain("May take up to 15 working days.");
    expect(declaration).not.toContain("For vendors.");
    const agreed = el.querySelector<HTMLInputElement>('input[name="agreed"]')!;
    expect(agreed.required).toBe(true);
    expect(agreed.closest("label")!.textContent).toContain("I understand the processing timeline and terms above.");
  });

  it("lists the budget's categories under their groups", async () => {
    await act(async () => root.render(
      <ClaimForm uid="u1" today="2026-10-20" canInvoice={false} goesStraightToFinance={false}
        budgets={[{ id: "b1", name: "Youth Day", kind: "event", is_reserve: false }]}
        provisions={[{ budget_id: "b1", category_id: "c1" }, { budget_id: "b1", category_id: "c2" }, { budget_id: "b1", category_id: "c3" }]}
        categories={[
          { id: "c1", name: "Transport & Logistics", category_group: "operations" },
          { id: "c2", name: "F&B – Participants", category_group: "programme" },
          { id: "c3", name: "Admin & Fees", category_group: "operations" },
          { id: "c4", name: "Prizes & Gifts", category_group: "programme" },
        ]}
        savedPayout={null} rules={rules} aiCheck={false} />,
    ));
    const budget = el.querySelector<HTMLSelectElement>('select[name="budgetId"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(budget, "b1");
      budget.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const groups = [...el.querySelectorAll<HTMLOptGroupElement>('select[name="categoryId"] optgroup')];
    expect(groups.map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.textContent)])).toEqual([
      ["Programme", ["F&B – Participants"]],
      ["Operations & Admin", ["Admin & Fees", "Transport & Logistics"]],
    ]);
  });

  it("asks for a receipt, or for an invoice and its proof of payment separately", async () => {
    expect(fileInputs()).toHaveLength(1);
    await act(async () => radio("Invoice I've paid").click());
    expect(fileInputs().map((i) => i.getAttribute("aria-label"))).toEqual(["Add invoice(s)", "Add proof(s) of payment"]);
    expect(el.textContent).toContain("Proof(s) of payment");
    expect(el.textContent).toContain("Proof Of Payment — Payee");
  });

  it("says the AI will verify the mandatory fields, and which files it reads, only when the check is on", async () => {
    expect(el.textContent).toContain("Receipt — must show these mandatory fields:");
    expect(el.textContent).not.toContain("Anthropic");
    await render(true);
    expect(el.textContent).toContain("Receipt — AI will verify these mandatory fields:");
    expect(el.textContent).toContain("reviewers may have it read them again");
  });

  it("won't send an invoice they paid without its proof of payment", async () => {
    await act(async () => radio("Invoice I've paid").click());
    await attach(fileInputs()[0], "invoice.jpg");
    await submit();
    expect(el.textContent).toContain("Attach the proof of payment");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uploads the receipt to the member's folder and sends the claim with the agreement", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    vi.mocked(createClient).mockReturnValue({ storage: { from: () => ({ upload }) } } as never);
    vi.mocked(submitClaim).mockResolvedValue({ ok: true, id: "claim-1", payoutSaved: true });
    await attach(fileInputs()[0], "receipt.jpg");
    const set = (name: string, value: string) => { el.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value; };
    set("amount", "42.50");
    set("expenseDate", "2026-10-01");
    set("description", "Snacks for volunteers");
    set("payeeName", "Tan Ah Kow");
    set("proxy", "9123 4567");
    el.querySelector<HTMLInputElement>('input[name="agreed"]')!.checked = true;
    await submit();
    const path = expect.stringMatching(/^u1\/[0-9a-f-]+\/[0-9a-f]{8}-receipt\.jpg$/);
    expect(upload).toHaveBeenCalledWith(path, expect.any(File), { contentType: "image/jpeg", upsert: false });
    expect(submitClaim).toHaveBeenCalledWith(expect.objectContaining({
      kind: "reimbursement", amount: "42.50", expenseDate: "2026-10-01", description: "Snacks for volunteers",
      attachmentPaths: [path], payout: { type: "paynow_mobile", name: "Tan Ah Kow", proxy: "9123 4567" }, agreed: true,
    }));
    expect(precheckClaim).not.toHaveBeenCalled();
  });

  it("uploads a HEIC photo as a JPEG, even when the browser gives it no type", async () => {
    const jpeg = new File(["jpeg"], "IMG_1234.jpg", { type: "image/jpeg" });
    vi.mocked(uploadable).mockResolvedValue(jpeg);
    await fill();
    await attach(fileInputs()[0], "IMG_1234.HEIC", "");
    expect(el.textContent).toContain("IMG_1234.jpg");
    const upload = vi.fn(async () => ({ error: null }));
    vi.mocked(createClient).mockReturnValue({ storage: { from: () => ({ upload }) } } as never);
    await submit();
    expect(upload).toHaveBeenLastCalledWith(expect.stringMatching(/-IMG_1234\.jpg$/), jpeg, { contentType: "image/jpeg", upsert: false });
  });

  it("says which photo couldn't be converted, and leaves it out", async () => {
    vi.mocked(uploadable).mockRejectedValue(new Error("unsupported"));
    await attach(fileInputs()[0], "IMG_1234.HEIC", "image/heic");
    expect(el.textContent).toContain("IMG_1234.HEIC couldn't be converted to a JPEG");
    expect(el.querySelector('[aria-label="Remove IMG_1234.HEIC"]')).toBeNull();
  });

  it("with the AI check on, shows what to fix before sending, then sends it as it is if they choose", async () => {
    await render(true);
    await fill();
    vi.mocked(precheckClaim).mockResolvedValue({ ok: true, fixes: ["The receipt doesn't show: Payment Method."] });
    await submit();
    expect(precheckClaim).toHaveBeenCalledWith({
      kind: "reimbursement", budgetId: "", categoryId: "", description: "Snacks for volunteers", amount: "42.50",
      expenseDate: "2026-10-01", vendorName: undefined, attachmentPaths: [expect.stringMatching(/^u1\//)],
    });
    expect(submitClaim).not.toHaveBeenCalled();
    expect(el.textContent).toContain("The receipt doesn't show: Payment Method.");
    expect(submitButton().textContent).toBe("Submit as it is");
    // Payout details aren't read by the check, so editing them still sends the claim as it is.
    await type("payeeName", "Tan Ah Kow Jr");
    expect(submitButton().textContent).toBe("Submit as it is");
    await submit();
    expect(precheckClaim).toHaveBeenCalledTimes(1);
    expect(submitClaim).toHaveBeenCalledTimes(1);
  });

  it("with the AI check on, locks what was entered while the files are read", async () => {
    await render(true);
    await fill();
    let finish!: (r: { ok: true; fixes: string[] }) => void;
    vi.mocked(precheckClaim).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const locked = () => el.querySelector('[name="amount"]')!.closest("fieldset")!.disabled;
    expect(locked()).toBe(false);
    await submit();
    expect(submitButton().textContent).toBe("Checking your receipts…");
    expect(locked()).toBe(true);
    await act(async () => finish({ ok: true, fixes: ["The receipt doesn't show: Payment Method."] }));
    expect(locked()).toBe(false);
  });

  it("with the AI check on, checks again once something it reads has changed", async () => {
    await render(true);
    await fill();
    vi.mocked(precheckClaim).mockResolvedValue({ ok: true, fixes: ["The total on the documents doesn't match the amount claimed."] });
    await submit();
    await type("amount", "43.00");
    expect(submitButton().textContent).toBe("Submit claim");
    vi.mocked(precheckClaim).mockResolvedValue({ ok: true, fixes: [] });
    await submit();
    expect(precheckClaim).toHaveBeenCalledTimes(2);
    expect(precheckClaim).toHaveBeenLastCalledWith(expect.objectContaining({ amount: "43.00" }));
    expect(submitClaim).toHaveBeenCalledTimes(1);
  });

  it("with the AI check on, sends straight away when there's nothing to fix or the check can't run", async () => {
    await render(true);
    await fill();
    vi.mocked(precheckClaim).mockResolvedValue({ ok: true, fixes: [] });
    await submit();
    expect(submitClaim).toHaveBeenCalledTimes(1);
    vi.mocked(precheckClaim).mockRejectedValue(new Error("offline"));
    el.querySelector<HTMLInputElement>('[name="amount"]')!.value = "43.00";
    await submit();
    expect(precheckClaim).toHaveBeenCalledTimes(2);
    expect(submitClaim).toHaveBeenCalledTimes(2);
    // A retry of the same claim (say, after submitClaim refused it) isn't checked again, even after a check that failed.
    await submit();
    expect(precheckClaim).toHaveBeenCalledTimes(2);
    expect(submitClaim).toHaveBeenCalledTimes(3);
  });

  it("clears the files when they change what they're attaching, but not on a repeat tap", async () => {
    await act(async () => radio("Invoice I've paid").click());
    await attach(fileInputs()[0], "invoice.jpg");
    await attach(fileInputs()[1], "paynow.jpg");
    await act(async () => radio("Invoice I've paid").click());
    expect(el.textContent).toContain("invoice.jpg");
    await act(async () => radio("Receipt").click());
    expect(el.textContent).not.toContain("invoice.jpg");
    expect(el.textContent).not.toContain("paynow.jpg");
  });
});
