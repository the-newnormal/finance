import { CATEGORY_GROUP_LABEL, type CategoryGroup } from "@/lib/types";

const GROUPS = Object.keys(CATEGORY_GROUP_LABEL) as CategoryGroup[];

/**
 * Categories in their groups (0011), in the groups' order and each group's by name, for a list or an
 * <optgroup>. Any not grouped yet come last, as "Other". Groups with none are left out.
 */
export function byGroup<T extends { name: string; category_group: CategoryGroup | null }>(categories: T[]) {
  return [...GROUPS, null]
    .map((group) => ({
      group,
      label: group ? CATEGORY_GROUP_LABEL[group] : "Other",
      categories: categories.filter((c) => c.category_group === group).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.categories.length > 0);
}
