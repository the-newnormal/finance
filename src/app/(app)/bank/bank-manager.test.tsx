// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editEntry } from "./actions";
import { BankManager, type Entry } from "./bank-manager";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ addAccount: vi.fn(), recordEntry: vi.fn(), setAccountActive: vi.fn(), transfer: vi.fn(), editEntry: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT = "40000000-0000-4000-8000-000000000001";
const SECOND = "40000000-0000-4000-8000-000000000002";

let root: Root;
let el: HTMLDivElement;

const entry = (e: Partial<Entry>): Entry => ({
  id: 1, account_id: ACCOUNT, kind: "payout", amount_cents: -1500, entry_date: "2026-10-01",
  note: null, claim_id: null, paid_for: null, reference: null, edits: [], actor_name: "Fin Ance", created_at: "2026-10-01T00:00:00Z", ...e,
});

async function render(entries: Entry[]) {
  await act(async () => root.render(
    <BankManager
      accounts={[
        { account_id: ACCOUNT, name: "Main", bank: "DBS", last4: "1234", active: true, balance_cents: 0, last_entry_date: null },
        { account_id: SECOND, name: "Second", bank: "DBS", last4: "5678", active: true, balance_cents: 0, last_entry_date: null },
      ]}
      entries={entries}
      ledger={{ account: null, page: 0, hasOlder: false }}
      today="2026-10-20"
    />,
  ));
}

const noteCells = () => [...el.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td")[3]);

beforeEach(() => {
  vi.mocked(editEntry).mockReset().mockResolvedValue({ ok: true });
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});

afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

describe("BankManager's ledger", () => {
  it("names a payout by what it paid for, with its note beneath", async () => {
    await render([entry({ claim_id: "c1", paid_for: "Snacks for volunteers", note: "Vol One · PAYNOW123" })]);
    const [cell] = noteCells();
    const link = cell.querySelector("a")!;
    expect([link.textContent, link.getAttribute("href")]).toEqual(["Snacks for volunteers", "/claims/c1"]);
    expect([...cell.querySelectorAll("div")].map((d) => d.textContent)).toEqual(["Vol One · PAYNOW123"]);
  });

  it("shows the note alone for any other entry", async () => {
    await render([entry({ id: 2, kind: "adjustment", amount_cents: 500, note: "Bank interest" })]);
    const [cell] = noteCells();
    expect(cell.textContent).toBe("Bank interest");
    expect(cell.querySelector("div")).toBeNull();
  });
});

// Sets a controlled input's value the way React notices.
function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
const field = (label: string) => [...el.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))!
  .querySelector("input, select") as HTMLInputElement | HTMLSelectElement;
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;

describe("editing a ledger entry", () => {
  it("corrects a payout's amount, account and reference, with a reason", async () => {
    await render([entry({ id: 7, claim_id: "c1", paid_for: "Snacks", note: "Vol One · TXN-1", reference: "TXN-1" })]);
    await act(async () => button("Edit").click());
    expect(el.textContent).toContain("Correcting a payout corrects its claim too");
    await act(async () => {
      type(field("Account"), SECOND);
      type(field("Amount"), "30.00");
      type(field("Bank reference"), "TXN-2");
      type(field("Why"), "paid 30 not 15");
    });
    await act(async () => el.querySelector("form")!.requestSubmit());
    expect(editEntry).toHaveBeenCalledWith({
      entryId: 7, kind: "payout", accountId: SECOND, direction: "out", amount: "30.00", date: "2026-10-01",
      note: undefined, reference: "TXN-2", reason: "paid 30 not 15",
    });
  });

  it("keeps an opening balance and a transfer on their accounts", async () => {
    await render([entry({ id: 8, kind: "transfer_out", amount_cents: -5000, note: "Transfer to Second" })]);
    await act(async () => button("Edit").click());
    expect(el.textContent).toContain("Both sides of the transfer change together.");
    expect([...el.querySelectorAll("label")].some((l) => l.textContent?.startsWith("Account"))).toBe(false);
  });

  it("shows what each edit changed, who made it and why", async () => {
    await render([entry({
      kind: "grant", amount_cents: 3000, note: "NAC grant",
      edits: [{ actor_name: "Fin Ance", reason: "typo", at: "2026-10-02T03:00:00Z",
        before: { account_id: ACCOUNT, amount_cents: 2000, entry_date: "2026-10-01", note: "NAC grant" },
        after: { account_id: SECOND, amount_cents: 3000, entry_date: "2026-10-01", note: "NAC grant" } }],
    })]);
    const history = el.querySelector("details")!;
    expect(history.querySelector("summary")!.textContent).toBe("Edited once");
    expect(history.textContent).toContain("2 Oct 2026 · Fin Ance: typo");
    expect(history.textContent).toContain("Amount +$20.00 → +$30.00 · Account Main → Second");
  });
});
