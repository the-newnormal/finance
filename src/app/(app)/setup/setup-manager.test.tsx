// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCategoryGroup } from "./actions";
import { SetupManager } from "./setup-manager";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  addCategory: vi.fn(), addDivision: vi.fn(), saveBudget: vi.fn(),
  setBudgetActive: vi.fn(), setCategoryActive: vi.fn(), setCategoryGroup: vi.fn(async () => ({ ok: true })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let el: HTMLDivElement;

beforeEach(async () => {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(
    <SetupManager divisions={[]} budgets={[]} categories={[
      { id: "c1", name: "Transport & Logistics", active: true, category_group: "operations" },
      { id: "c2", name: "Logistics", active: true, category_group: null },
      { id: "c3", name: "Venue & Rental", active: true, category_group: "venue_production" },
    ]} />,
  ));
});

afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

describe("SetupManager categories", () => {
  it("lists categories under their groups, with any not grouped yet last", () => {
    const card = [...el.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Claim categories"))!;
    const text = card.textContent!;
    expect(text.indexOf("Venue & Rental")).toBeLessThan(text.indexOf("Transport & Logistics"));
    expect(text.indexOf("Transport & Logistics")).toBeLessThan(text.indexOf("Not grouped yet"));
    expect(text.indexOf("Not grouped yet")).toBeLessThan(text.indexOf("Logistics", text.indexOf("Not grouped yet")));
  });

  it("gives a category not grouped yet its group", async () => {
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Group of Logistics"]')!;
    expect(select.value).toBe("");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "operations");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setCategoryGroup).toHaveBeenCalledWith("c2", "operations");
  });
});
