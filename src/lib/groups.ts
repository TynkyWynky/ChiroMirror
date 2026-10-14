import type { SupabaseClient } from "@supabase/supabase-js";
import type { Group } from "../types/content";

export function prepareGroupRows(groups: Group[]): Record<string, unknown>[] {
  const slugs = new Set<string>();

  return groups.map((group, index) => {
    const name = group.name.trim();
    if (!name) {
      throw new Error(`Geef groep ${index + 1} een naam voordat je opslaat.`);
    }

    const slug = (group.slug.trim() || name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!slug) {
      throw new Error(`Geef de groep “${name}” een slug met letters of cijfers.`);
    }
    if (slugs.has(slug)) {
      throw new Error(`De slug “${slug}” wordt meer dan één keer gebruikt. Geef elke groep een unieke slug.`);
    }
    slugs.add(slug);

    return {
      ...(group.id && !group.id.startsWith("temp-") ? { id: group.id } : {}),
      slug,
      name,
      theme_key: group.themeKey,
      age_range: group.ageRange,
      birth_years: group.birthYears,
      school_years: group.schoolYears,
      description: group.description,
      image_url: group.imageUrl,
      image_alt: group.imageAlt,
      sort_order: group.sortOrder,
      leaders: group.leaders
    };
  });
}

export async function upsertGroupRows(client: SupabaseClient, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    return { data: [], error: null };
  }

  // Mixed batches contain existing IDs and new rows without an ID. Use the
  // database UUID default for new rows instead of PostgREST's implicit null.
  return client.from("groups").upsert(rows, { defaultToNull: false }).select("*");
}
