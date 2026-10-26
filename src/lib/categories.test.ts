import { describe, expect, it } from "vitest";
import { byGroup } from "./categories";

describe("byGroup", () => {
  it("lists categories in their groups' order, by name, with ungrouped ones last and empty groups left out", () => {
    const groups = byGroup([
      { name: "Transport & Logistics", category_group: "operations" as const },
      { name: "Logistics", category_group: null },
      { name: "Admin & Fees", category_group: "operations" as const },
      { name: "Venue & Rental", category_group: "venue_production" as const },
    ]);
    expect(groups.map((g) => [g.label, g.categories.map((c) => c.name)])).toEqual([
      ["Venue & Production", ["Venue & Rental"]],
      ["Operations & Admin", ["Admin & Fees", "Transport & Logistics"]],
      ["Other", ["Logistics"]],
    ]);
  });

  it("leaves the list it was given as it was", () => {
    const list = [{ name: "B", category_group: "people" as const }, { name: "A", category_group: "people" as const }];
    byGroup(list);
    expect(list.map((c) => c.name)).toEqual(["B", "A"]);
  });
});
