import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const envContents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of envContents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.ADMIN_EMAIL;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const defaultContentPath = path.join(process.cwd(), "src", "data", "default-content.json");
const defaultContent = JSON.parse(fs.readFileSync(defaultContentPath, "utf8"));

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function toSnakeCaseSiteSettings(settings) {
  return {
    id: 1,
    site_name: settings.siteName,
    site_url: settings.siteUrl,
    logo_url: settings.logoUrl,
    email: settings.email,
    facebook_url: settings.facebookUrl,
    instagram_url: settings.instagramUrl,
    address: settings.address,
    address_note: settings.addressNote,
    map_embed_url: settings.mapEmbedUrl,
    map_google_url: settings.mapGoogleUrl,
    map_apple_url: settings.mapAppleUrl,
    footer_copyright: settings.footerCopyright,
    footer_developer: settings.footerDeveloper,
    analytics_id: settings.analyticsId,
    footer_admin_label: settings.footerAdminLabel
  };
}

async function resetTable(tableName) {
  const deleteColumn = {
    site_settings: "id",
    page_content: "slug",
    groups: "slug",
    contact_sections: "title",
    songs: "title",
    posts: "title",
    contact_messages: "id"
  }[tableName];

  const { error } = await supabase.from(tableName).delete().not(deleteColumn, "is", null);

  if (error) {
    throw error;
  }
}

async function seed() {
  await supabase.from("site_settings").upsert(toSnakeCaseSiteSettings(defaultContent.siteSettings));

  await resetTable("page_content");
  const pageRows = Object.entries(defaultContent.pages).map(([slug, data]) => ({
    slug,
    data
  }));
  if (pageRows.length) {
    const { error } = await supabase.from("page_content").insert(pageRows);
    if (error) throw error;
  }

  await resetTable("groups");
  if (defaultContent.groups.length) {
    const { error } = await supabase.from("groups").insert(
      defaultContent.groups.map((group) => ({
        slug: group.slug,
        name: group.name,
        theme_key: group.themeKey,
        age_range: group.ageRange,
        birth_years: group.birthYears,
        school_years: group.schoolYears,
        description: group.description,
        image_url: group.imageUrl,
        image_alt: group.imageAlt,
        sort_order: group.sortOrder,
        leaders: group.leaders
      }))
    );
    if (error) throw error;
  }

  await resetTable("contact_sections");
  if (defaultContent.contactSections.length) {
    const { error } = await supabase.from("contact_sections").insert(
      defaultContent.contactSections.map((section) => ({
        title: section.title,
        accent_color: section.accentColor,
        sort_order: section.sortOrder,
        people: section.people
      }))
    );
    if (error) throw error;
  }

  await resetTable("songs");
  if (defaultContent.songs.length) {
    const { error } = await supabase.from("songs").insert(
      defaultContent.songs.map((song) => ({
        title: song.title,
        lyrics: song.lyrics,
        sort_order: song.sortOrder
      }))
    );
    if (error) throw error;
  }

  await resetTable("posts");
  if (defaultContent.posts.length) {
    const { error } = await supabase.from("posts").insert(
      defaultContent.posts.map((post) => ({
        title: post.title,
        summary: post.summary,
        body: post.body,
        event_date: post.eventDate || null,
        published: post.published,
        featured: post.featured
      }))
    );
    if (error) throw error;
  }

  await resetTable("contact_messages");

  if (adminEmail) {
    const { data: users, error: userError } = await supabase.auth.admin.listUsers();
    if (userError) {
      throw userError;
    }

    const adminUser = users.users.find((user) => user.email?.toLowerCase() === adminEmail.toLowerCase());
    if (adminUser) {
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(
          { user_id: adminUser.id, email: adminUser.email ?? adminEmail, role: "admin" },
          { onConflict: "user_id" }
        );

      if (profileError) {
        throw profileError;
      }
    }
  }
}

seed()
  .then(() => {
    console.log("Supabase seeded successfully.");
  })
  .catch((error) => {
    console.error("Seeding failed.", error);
    process.exit(1);
  });
