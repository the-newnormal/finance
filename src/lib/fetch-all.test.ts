import { describe, expect, it, vi } from "vitest";
import { fetchAll } from "./fetch-all";

describe("fetchAll", () => {
  it("reads page after page until a short one", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => i);
    const page = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    expect(await fetchAll(page)).toEqual(rows);
    expect(page.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops after an exactly full last page", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const page = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    expect(await fetchAll(page)).toHaveLength(1000);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("throws instead of returning a partial list", async () => {
    await expect(fetchAll(async () => ({ data: null, error: { code: "57014" } }))).rejects.toThrow("read failed: 57014");
  });
});
