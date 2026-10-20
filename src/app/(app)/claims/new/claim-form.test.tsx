// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/client";
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

beforeEach(async () => {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(
    <ClaimForm uid="u1" today="2026-10-20" canInvoice={false} goesStraightToFinance={false} budgets={[]} provisions={[]}
      categories={[]} savedPayout={null} rules={rules} />,
  ));
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

  it("won't send an invoice they paid without its proof of payment", async () => {
    await act(async () => radio("Invoice I've paid").click());
    await attach(fileInputs()[0], "invoice.jpg");
    await submit();
    expect(el.textContent).toContain("Attach the proof of payment");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("drops the proof of payment when they switch to a receipt", async () => {
    await act(async () => radio("Invoice I've paid").click());
    await attach(fileInputs()[1], "paynow.jpg");
    expect(el.textContent).toContain("paynow.jpg");
    await act(async () => radio("Receipt").click());
    await act(async () => radio("Invoice I've paid").click());
    expect(el.textContent).not.toContain("paynow.jpg");
  });
});
