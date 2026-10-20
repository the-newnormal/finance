// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideClaim } from "./actions";
import { ReviewActions } from "./claim-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ decideClaim: vi.fn(), markPaid: vi.fn(), attachClaimFiles: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let el: HTMLDivElement;

async function render(suggestedReason: string | null) {
  await act(async () => root.render(
    <ReviewActions claimId="c1" canApprove canReject approveLabel="Approve" suggestedReason={suggestedReason} />,
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});

afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

const button = (name: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === name);
const click = (name: string) => act(async () => button(name)!.click());

describe("ReviewActions", () => {
  it("fills the reason from the AI check's findings, for the reviewer to edit and send", async () => {
    vi.mocked(decideClaim).mockResolvedValue({ ok: true });
    await render("The receipt doesn't show: Payment Method.");
    await click("Reject…");
    expect(el.textContent).toContain("the AI can be wrong");
    await click("Use the AI check's findings");
    expect(el.querySelector("textarea")!.value).toBe("The receipt doesn't show: Payment Method.");
    expect(button("Use the AI check's findings")).toBeUndefined();
    await click("Reject claim");
    expect(decideClaim).toHaveBeenCalledWith("c1", false, "The receipt doesn't show: Payment Method.");
  });

  it("keeps a filled reason in step with a re-check, but never the reviewer's own words", async () => {
    await render("The receipt doesn't show: Payment Method.");
    await click("Reject…");
    await click("Use the AI check's findings");
    await render("The total on the documents doesn't match the amount claimed.");
    expect(el.querySelector("textarea")!.value).toBe("The total on the documents doesn't match the amount claimed.");
    await render(null);
    expect(el.querySelector("textarea")!.value).toBe("");

    await render("The receipt doesn't show: Payment Method.");
    await click("Use the AI check's findings");
    const textarea = el.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Please re-upload the receipt.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render(null);
    expect(el.querySelector("textarea")!.value).toBe("Please re-upload the receipt.");
  });

  it("offers nothing to fill in without findings", async () => {
    await render(null);
    await click("Reject…");
    expect(button("Use the AI check's findings")).toBeUndefined();
    expect(el.textContent).not.toContain("the AI can be wrong");
  });
});
