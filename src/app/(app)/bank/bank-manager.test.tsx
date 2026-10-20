// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BankManager, type Entry } from "./bank-manager";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ addAccount: vi.fn(), recordEntry: vi.fn(), setAccountActive: vi.fn(), transfer: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT = "40000000-0000-4000-8000-000000000001";

let root: Root;
let el: HTMLDivElement;

const entry = (e: Partial<Entry>): Entry => ({
  id: 1, account_id: ACCOUNT, kind: "payout", amount_cents: -1500, entry_date: "2026-10-01",
  note: null, paid_for: null, actor_name: "Fin Ance", created_at: "2026-10-01T00:00:00Z", ...e,
});

async function render(entries: Entry[]) {
  await act(async () => root.render(
    <BankManager
      accounts={[{ account_id: ACCOUNT, name: "Main", bank: "DBS", last4: "1234", active: true, balance_cents: 0, last_entry_date: null }]}
      entries={entries}
      ledger={{ account: null, page: 0, hasOlder: false }}
      today="2026-10-20"
    />,
  ));
}

const noteCells = () => [...el.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td")[3]);

beforeEach(() => {
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
    await render([entry({ paid_for: "Snacks for volunteers", note: "Vol One · PAYNOW123" })]);
    const [cell] = noteCells();
    expect([...cell.querySelectorAll("div")].map((d) => d.textContent)).toEqual(["Snacks for volunteers", "Vol One · PAYNOW123"]);
  });

  it("shows the note alone for any other entry", async () => {
    await render([entry({ id: 2, kind: "adjustment", amount_cents: 500, note: "Bank interest" })]);
    const [cell] = noteCells();
    expect(cell.textContent).toBe("Bank interest");
    expect(cell.querySelector("div")).toBeNull();
  });
});
