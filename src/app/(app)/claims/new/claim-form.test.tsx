// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/client";
import { submitClaim } from "../actions";
import { ClaimForm } from "./claim-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../actions", () => ({ submitClaim: vi.fn(), forgetSavedPayout: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

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

async function attach(input: HTMLInputElement, name: string) {
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], name, { type: "image/jpeg" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

// Skips the browser's own checks of required fields, to reach the form's.
async function submit() {
  await act(async () => el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
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
    expect(el.textContent).toContain("JPG, PNG or PDF work best");
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
