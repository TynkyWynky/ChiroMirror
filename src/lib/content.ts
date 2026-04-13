import { defaultContent } from "@/lib/default-content";
import { createServerSupabaseClient } from "@/lib/supabase";
import type {
  ActivitiesPage,
  CampPage,
  ContactPage,
  ContactSection,
  Group,
  GroupsPage,
  HomePage,
  Post,
  SimplePage,
  SiteContent,
  SiteSettings,
  Song,
  SongsPage,
  RegistrationPage
} from "@/types/content";

type PageSlug = keyof SiteContent["pages"];

function getPage<T>(pages: Record<string, unknown>, slug: PageSlug, fallback: T) {
  const value = pages[slug];
  if (!value || typeof value !== "object") {
    return fallback;
  }

  return {
    ...fallback,
    ...(value as Record<string, unknown>)
  } as T;
}

function mapSiteSettings(row: Record<string, unknown> | null | undefined): SiteSettings {
  if (!row) {
    return defaultContent.siteSettings;
  }

  return {
    siteName: String(row.site_name ?? defaultContent.siteSettings.siteName),
    siteUrl: String(row.site_url ?? defaultContent.siteSettings.siteUrl),
    logoUrl: String(row.logo_url ?? defaultContent.siteSettings.logoUrl),
    email: String(row.email ?? defaultContent.siteSettings.email),
    facebookUrl: String(row.facebook_url ?? defaultContent.siteSettings.facebookUrl),
    instagramUrl: String(row.instagram_url ?? defaultContent.siteSettings.instagramUrl),
    address: String(row.address ?? defaultContent.siteSettings.address),
    addressNote: String(row.address_note ?? defaultContent.siteSettings.addressNote),
    mapEmbedUrl: String(row.map_embed_url ?? defaultContent.siteSettings.mapEmbedUrl),
    mapGoogleUrl: String(row.map_google_url ?? defaultContent.siteSettings.mapGoogleUrl),
    mapAppleUrl: String(row.map_apple_url ?? defaultContent.siteSettings.mapAppleUrl),
    footerCopyright: String(
      row.footer_copyright ?? defaultContent.siteSettings.footerCopyright
    ),
    footerDeveloper: String(row.footer_developer ?? defaultContent.siteSettings.footerDeveloper),
    analyticsId: String(row.analytics_id ?? defaultContent.siteSettings.analyticsId),
    footerAdminLabel: String(
      row.footer_admin_label ?? defaultContent.siteSettings.footerAdminLabel
    )
  };
}

function mapGroup(row: Record<string, unknown>): Group {
  return {
    id: String(row.id ?? ""),
    slug: String(row.slug ?? ""),
    name: String(row.name ?? ""),
    themeKey: String(row.theme_key ?? ""),
    ageRange: String(row.age_range ?? ""),
    birthYears: String(row.birth_years ?? ""),
    schoolYears: String(row.school_years ?? ""),
    description: String(row.description ?? ""),
    imageUrl: String(row.image_url ?? ""),
    imageAlt: String(row.image_alt ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    leaders: Array.isArray(row.leaders) ? (row.leaders as Group["leaders"]) : []
  };
}

function mapContactSection(row: Record<string, unknown>): ContactSection {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    accentColor: String(row.accent_color ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    people: Array.isArray(row.people) ? (row.people as ContactSection["people"]) : []
  };
}

function mapSong(row: Record<string, unknown>): Song {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    lyrics: String(row.lyrics ?? ""),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

function mapPost(row: Record<string, unknown>): Post {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    body: String(row.body ?? ""),
    eventDate: String(row.event_date ?? ""),
    published: Boolean(row.published),
    featured: Boolean(row.featured),
    createdAt: String(row.created_at ?? "")
  };
}

export async function loadSiteContent(): Promise<SiteContent> {
  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return defaultContent;
  }

  try {
    const [
      siteSettingsResult,
      pageContentResult,
      groupsResult,
      contactSectionsResult,
      songsResult,
      postsResult
    ] = await Promise.all([
      supabase.from("site_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("page_content").select("slug, data"),
      supabase.from("groups").select("*").order("sort_order", { ascending: true }),
      supabase.from("contact_sections").select("*").order("sort_order", { ascending: true }),
      supabase.from("songs").select("*").order("sort_order", { ascending: true }),
      supabase.from("posts").select("*").order("event_date", { ascending: false })
    ]);

    if (
      siteSettingsResult.error ||
      pageContentResult.error ||
      groupsResult.error ||
      contactSectionsResult.error ||
      songsResult.error ||
      postsResult.error
    ) {
      return defaultContent;
    }

    const pageMap = Object.fromEntries(
      (pageContentResult.data ?? []).map((row) => [String(row.slug), row.data ?? {}])
    );

    const siteSettings = mapSiteSettings(
      (siteSettingsResult.data as Record<string, unknown> | null) ?? null
    );
    const groups = ((groupsResult.data as Record<string, unknown>[] | null) ?? []).length
      ? (((groupsResult.data as Record<string, unknown>[] | null) ?? []).map(mapGroup) as Group[])
      : defaultContent.groups;
    const contactSections = ((contactSectionsResult.data as Record<string, unknown>[] | null) ?? []).length
      ? (((contactSectionsResult.data as Record<string, unknown>[] | null) ?? []).map(
          mapContactSection
        ) as ContactSection[])
      : defaultContent.contactSections;
    const songs = ((songsResult.data as Record<string, unknown>[] | null) ?? []).length
      ? (((songsResult.data as Record<string, unknown>[] | null) ?? []).map(mapSong) as Song[])
      : defaultContent.songs;
    const posts = ((postsResult.data as Record<string, unknown>[] | null) ?? [])
      .map(mapPost)
      .filter((post) => post.published);

    return {
      siteSettings,
      pages: {
        home: getPage<HomePage>(pageMap, "home", defaultContent.pages.home),
        groups: getPage<GroupsPage>(pageMap, "groups", defaultContent.pages.groups),
        contact: getPage<ContactPage>(pageMap, "contact", defaultContent.pages.contact),
        songs: getPage<SongsPage>(pageMap, "songs", defaultContent.pages.songs),
        activities: getPage<ActivitiesPage>(pageMap, "activities", defaultContent.pages.activities),
        registration: getPage<RegistrationPage>(
          pageMap,
          "registration",
          defaultContent.pages.registration
        ),
        camp: getPage<CampPage>(pageMap, "camp", defaultContent.pages.camp),
        rental: getPage<SimplePage>(pageMap, "rental", defaultContent.pages.rental),
        insurance: getPage<SimplePage>(pageMap, "insurance", defaultContent.pages.insurance),
        privacy: getPage<SimplePage>(pageMap, "privacy", defaultContent.pages.privacy)
      },
      groups,
      contactSections,
      songs,
      posts: posts.length ? posts : defaultContent.posts,
      contactMessages: defaultContent.contactMessages
    };
  } catch (error) {
    console.error("Falling back to local content because Supabase could not be reached.", error);
    return defaultContent;
  }
}
