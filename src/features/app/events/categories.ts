const labels: Record<string, string> = {
  ACTIVITY: "Activiteit", MEETING: "Vergadering", EVENT: "Evenement",
  WEEKEND: "Weekend", CAMP: "Kamp", DEADLINE: "Deadline", OTHER: "Overig"
};

// Older installations still return French labels for these built-in categories.
// Preserve unknown categories and user-authored content.
export function localizeCategories<T extends { key: string; label: string }>(categories: T[]): T[] {
  return categories.map(category => ({ ...category, label: labels[category.key] ?? category.label }))
    .sort((a, b) => a.label.localeCompare(b.label, "nl-BE"));
}
