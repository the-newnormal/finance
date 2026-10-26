// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadable } from "@/lib/receipt-upload";
import { createClient } from "@/lib/supabase/client";
import { submitClaim } from "../actions";
import { precheckClaim, type PrecheckResult } from "../precheck-actions";
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
const upload = vi.fn();

async function render(aiCheck: boolean) {
  await act(async () => root.render(
    <ClaimForm uid="u1" today="2026-10-20" canInvoice={false} goesStraightToFinance={false} budgets={[]} provisions={[]}
      categories={[]} savedPayout={null} rules={rules} aiCheck={aiCheck} />,
  ));
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(uploadable).mockImplementation(async (f) => f);
  // Files upload as they're attached.
  upload.mockReset().mockResolvedValue({ error: null });
  vi.mocked(createClient).mockReturnValue({ storage: { from: () => ({ upload }) } } as never);
  vi.mocked(submitClaim).mockResolvedValue({ ok: true, id: "claim-1", payoutSaved: true });
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

// A reimbursement with a receipt, ready to submit.
async function fill() {
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
// The pop-up renders outside the form (a portal), so it's found in the document.
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const dialogButton = (name: string) => [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === name)!;

const water = { description: "Bottled water", amount_cents: 4250, category_id: "c1" };
const readFound = (fixes: string[], total = 4250, date = "2026-10-01"): PrecheckResult => ({
  ok: true, fixes, documents: [{ kind: "receipt", total_cents: total, date }], items: [water],
});

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

  it("says the AI will verify the mandatory fields, and that it reads the files as they're attached, only when the check is on", async () => {
    expect(el.textContent).toContain("Receipt — must show these mandatory fields:");
    expect(el.textContent).not.toContain("Anthropic");
    await render(true);
    expect(el.textContent).toContain("Receipt — AI will verify these mandatory fields:");
    expect(el.textContent).toContain("As you attach them, an AI service (Anthropic's Claude) reads them to check they show what's needed and to list what was bought");
  });

  it("won't send an invoice they paid without its proof of payment", async () => {
    await act(async () => radio("Invoice I've paid").click());
    await attach(fileInputs()[0], "invoice.jpg");
    await submit();
    expect(el.textContent).toContain("Attach the proof of payment");
    expect(submitClaim).not.toHaveBeenCalled();
  });

  it("uploads each file to the member's folder as it's attached, and sends the claim with the agreement", async () => {
    await fill();
    const path = expect.stringMatching(/^u1\/[0-9a-f-]+\/[0-9a-f]{8}-receipt\.jpg$/);
    expect(upload).toHaveBeenCalledWith(path, expect.any(File), { contentType: "image/jpeg", upsert: false });
    await submit();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(submitClaim).toHaveBeenCalledWith(expect.objectContaining({
      kind: "reimbursement", amount: "42.50", expenseDate: "2026-10-01", description: "Snacks for volunteers",
      attachmentPaths: [path], payout: { type: "paynow_mobile", name: "Tan Ah Kow", proxy: "9123 4567" }, agreed: true, items: undefined,
    }));
    expect(precheckClaim).not.toHaveBeenCalled();
  });

  it("says when a file couldn't be uploaded, leaves it out, and clears the message when a retry works", async () => {
    upload.mockResolvedValue({ error: { message: "offline" } });
    await attach(fileInputs()[0], "receipt.jpg");
    expect(el.textContent).toContain("receipt.jpg couldn't be uploaded");
    expect(el.querySelector('[aria-label="Remove receipt.jpg"]')).toBeNull();
    upload.mockResolvedValue({ error: null });
    await attach(fileInputs()[0], "receipt.jpg");
    expect(el.textContent).not.toContain("couldn't be uploaded");
    expect(el.querySelector('[aria-label="Remove receipt.jpg"]')).not.toBeNull();
  });

  it("lets files be attached again after something unexpected goes wrong", async () => {
    vi.mocked(createClient).mockImplementationOnce(() => { throw new Error("no Supabase settings"); });
    await attach(fileInputs()[0], "receipt.jpg");
    expect(el.textContent).toContain("The files couldn't be attached. Try again.");
    expect(fileInputs()[0].disabled).toBe(false);
    expect(submitButton().disabled).toBe(false);
  });

  it("uploads a HEIC photo as a JPEG, even when the browser gives it no type", async () => {
    const jpeg = new File(["jpeg"], "IMG_1234.jpg", { type: "image/jpeg" });
    vi.mocked(uploadable).mockResolvedValue(jpeg);
    await attach(fileInputs()[0], "IMG_1234.HEIC", "");
    expect(el.textContent).toContain("IMG_1234.jpg");
    expect(upload).toHaveBeenLastCalledWith(expect.stringMatching(/-IMG_1234\.jpg$/), jpeg, { contentType: "image/jpeg", upsert: false });
  });

  it("says which photo couldn't be converted, and leaves it out", async () => {
    vi.mocked(uploadable).mockRejectedValue(new Error("unsupported"));
    await attach(fileInputs()[0], "IMG_1234.HEIC", "image/heic");
    expect(el.textContent).toContain("IMG_1234.HEIC couldn't be converted to a JPEG");
    expect(el.querySelector('[aria-label="Remove IMG_1234.HEIC"]')).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("with the AI check on, reads the files as they're attached, and holds the claim until the read is back", async () => {
    await render(true);
    let finish!: (r: PrecheckResult) => void;
    vi.mocked(precheckClaim).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await fill();
    expect(precheckClaim).toHaveBeenCalledWith({ kind: "reimbursement", attachmentPaths: [expect.stringMatching(/^u1\//)] });
    expect(submitButton().textContent).toBe("Reading your receipts…");
    expect(submitButton().disabled).toBe(true);
    // The rest of the form can still be filled in meanwhile.
    expect(el.querySelector<HTMLInputElement>('[name="amount"]')!.closest("fieldset")!.disabled).toBe(false);
    await act(async () => finish(readFound([])));
    expect(submitButton().textContent).toBe("Submit claim");
    expect(submitButton().disabled).toBe(false);
  });

  it("with the AI check on, sends straight away with the items read when there's nothing to fix", async () => {
    await render(true);
    vi.mocked(precheckClaim).mockResolvedValue(readFound([]));
    await fill();
    await submit();
    expect(dialog()).toBeNull();
    expect(submitClaim).toHaveBeenCalledWith(expect.objectContaining({ items: [water] }));
  });

  it("with the AI check on, shows what to fix in a pop-up as they submit, and sends it anyway if they choose", async () => {
    await render(true);
    vi.mocked(precheckClaim).mockResolvedValue(readFound(["The receipt doesn't show: Payment Method."], 4400, "2026-09-30"));
    await fill();
    await submit();
    expect(submitClaim).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain("The receipt doesn't show: Payment Method.");
    // The total and date are compared with what was entered, as it's sent.
    expect(dialog()!.textContent).toContain("The total on the documents doesn't match the amount claimed.");
    expect(dialog()!.textContent).toContain("The date on the documents doesn't match the date on the claim.");
    await act(async () => dialogButton("Go back and fix").click());
    expect(dialog()).toBeNull();
    expect(submitClaim).not.toHaveBeenCalled();
    // Fixing the amount and date leaves only what the files themselves lack.
    await type("amount", "44.00");
    await type("expenseDate", "2026-09-30");
    await submit();
    expect(dialog()!.textContent).not.toContain("doesn't match");
    await act(async () => dialogButton("Submit anyway").click());
    expect(submitClaim).toHaveBeenCalledTimes(1);
    expect(submitClaim).toHaveBeenCalledWith(expect.objectContaining({ amount: "44.00", items: [water] }));
  });

  it("with the AI check on, reads again when the files change, and sends as usual when the read can't run", async () => {
    await render(true);
    vi.mocked(precheckClaim).mockResolvedValue({ ok: false });
    await fill();
    await attach(fileInputs()[0], "second.jpg");
    expect(precheckClaim).toHaveBeenCalledTimes(2);
    expect(vi.mocked(precheckClaim).mock.calls[1][0].attachmentPaths).toHaveLength(2);
    await submit();
    expect(dialog()).toBeNull();
    expect(submitClaim).toHaveBeenCalledWith(expect.objectContaining({ items: undefined }));
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
