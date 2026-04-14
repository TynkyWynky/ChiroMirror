import { useEffect, useState } from "preact/hooks";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { adminDefaultContent } from "@/lib/admin-default-content";
import type {
  CampChecklistSection,
  CampOverviewItem,
  CampStep,
  ContactMessage,
  ContactSection,
  Group,
  HomePage,
  LinkAction,
  PageCard,
  Person,
  Post,
  SitePages,
  SiteSettings,
  Song
} from "@/types/content";

type Role = "admin" | "editor";
type AuthMode = "login" | "recovery";
const AUTH_TIMEOUT_MS = 4000;
const DASHBOARD_STALL_MS = 5000;
const DASHBOARD_TIMEOUT_MS = 12000;
type TabId =
  | "overview"
  | "site"
  | "home"
  | "groups"
  | "contact"
  | "songs"
  | "posts"
  | "registration"
  | "camp"
  | "pages"
  | "messages"
  | "team";

interface Profile {
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
}

type Notice = { type: "success" | "error"; message: string } | null;
type AdminLoadingStep = {
  label: string;
  detail: string;
  delayedDetail?: string;
};

const publicSupabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const publicSupabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const REMEMBER_LOGIN_STORAGE_KEY = "chiro-admin-remember-login";
const REMEMBERED_EMAIL_STORAGE_KEY = "chiro-admin-remembered-email";

function cloneDefaults() {
  if (typeof structuredClone === "function") {
    return structuredClone(adminDefaultContent);
  }

  return JSON.parse(JSON.stringify(adminDefaultContent));
}

function mergePage<T extends object>(fallback: T, value: unknown) {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  return {
    ...fallback,
    ...(value as Record<string, unknown>)
  } as T;
}

function tempId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `temp-${prefix}-${randomId}`;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(values: string[]) {
  return values.join("\n");
}

function formatDateInput(value: string) {
  return value ? value.slice(0, 10) : "";
}

function detectAuthMode() {
  if (typeof window === "undefined") {
    return "login" as AuthMode;
  }

  const authState = `${window.location.search}${window.location.hash}`.toLowerCase();
  if (authState.includes("type=recovery") || authState.includes("type=invite")) {
    return "recovery" as AuthMode;
  }

  return "login" as AuthMode;
}

function clearAuthUrlState() {
  if (typeof window === "undefined") {
    return;
  }

  if (!window.location.search && !window.location.hash) {
    return;
  }

  window.history.replaceState({}, document.title, window.location.pathname);
}

function getSupabaseStorageKey(url: string) {
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "sb-admin-auth-token";
  }
}

const supabaseStorageKey = publicSupabaseUrl
  ? getSupabaseStorageKey(publicSupabaseUrl)
  : "sb-admin-auth-token";

function createMemoryStorage() {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    }
  };
}

const fallbackAuthStorage = createMemoryStorage();

function getBrowserStorage(kind: "local" | "session") {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function getRememberLoginPreference() {
  const storage = getBrowserStorage("local");

  try {
    return storage?.getItem(REMEMBER_LOGIN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getRememberedLoginEmail() {
  const storage = getBrowserStorage("local");

  try {
    return storage?.getItem(REMEMBERED_EMAIL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function syncRememberedLogin(rememberLogin: boolean, email: string) {
  const storage = getBrowserStorage("local");

  if (!storage) {
    return;
  }

  try {
    if (!rememberLogin) {
      storage.removeItem(REMEMBER_LOGIN_STORAGE_KEY);
      storage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY);
      return;
    }

    const trimmedEmail = email.trim();
    storage.setItem(REMEMBER_LOGIN_STORAGE_KEY, "true");

    if (trimmedEmail) {
      storage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, trimmedEmail);
    } else {
      storage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY);
    }
  } catch {
    // Negeer opslagfouten en laat de login gewoon verder werken.
  }
}

function resolveAdminAuthStorage() {
  const localStorageRef = getBrowserStorage("local");
  const sessionStorageRef = getBrowserStorage("session");

  if (getRememberLoginPreference()) {
    return localStorageRef ?? sessionStorageRef ?? fallbackAuthStorage;
  }

  return sessionStorageRef ?? localStorageRef ?? fallbackAuthStorage;
}

function createAdminAuthStorage() {
  return {
    getItem(key: string) {
      return resolveAdminAuthStorage().getItem(key);
    },
    setItem(key: string, value: string) {
      resolveAdminAuthStorage().setItem(key, value);
    },
    removeItem(key: string) {
      resolveAdminAuthStorage().removeItem(key);
    }
  };
}

function clearStoredAdminAuth(storageKey: string) {
  const storageAreas = [getBrowserStorage("local"), getBrowserStorage("session")];

  for (const storage of storageAreas) {
    if (!storage) {
      continue;
    }

    try {
      storage.removeItem(storageKey);
      storage.removeItem(`${storageKey}-code-verifier`);
      storage.removeItem(`${storageKey}-user`);
    } catch {
      // Als een opslagmedium niet beschikbaar is, laten we de rest gewoon verder lopen.
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function AdminLoadingScreen(props: {
  eyebrow: string;
  title: string;
  body: string;
  hint?: string;
  stalled?: boolean;
  steps: AdminLoadingStep[];
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 160);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [props.title, props.body]);

  const steps = props.steps.length
    ? props.steps
    : [{ label: "Voorbereiden", detail: props.body }];
  const elapsedSeconds = Math.max(1, Math.ceil(elapsedMs / 1000));
  const stepDurationMs = 1800;
  const rawStep = elapsedMs / stepDurationMs;
  const activeIndex = Math.min(steps.length - 1, Math.floor(rawStep));
  const segmentStart = 16 + activeIndex * (68 / steps.length);
  const segmentEnd =
    activeIndex === steps.length - 1
      ? props.stalled
        ? 96
        : 92
      : 16 + (activeIndex + 1) * (68 / steps.length);
  const segmentProgress = Math.min(rawStep - activeIndex, activeIndex === steps.length - 1 ? 0.28 : 1);
  const progress = Math.round(
    segmentStart + (segmentEnd - segmentStart) * Math.max(0, segmentProgress)
  );
  const currentStep = steps[activeIndex];
  const currentDetail = props.stalled
    ? currentStep.delayedDetail ?? props.hint ?? currentStep.detail
    : currentStep.detail;

  return (
    <div class="admin-app admin-shell">
      <div class="admin-splash">
        <div class="admin-splash-mark" aria-hidden="true">
          9M
        </div>
        <p class="admin-kicker">{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p class="muted">{props.body}</p>
        <div class="admin-loader-meta" aria-live="polite">
          <span>{props.stalled ? "Verbinding reageert traag" : "Live voortgang"}</span>
          <strong>{progress}%</strong>
        </div>
        <div
          class="admin-loader"
          role="progressbar"
          aria-label="Laadstatus admin"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span class="admin-loader-bar" style={{ width: `${progress}%` }} />
        </div>
        <div class="admin-loader-status" aria-live="polite">
          <strong>{currentStep.label}</strong>
          <span>{currentDetail}</span>
        </div>
        <ul class="admin-loader-steps">
          {steps.map((step, index) => {
            const stateClass =
              index < activeIndex
                ? "is-complete"
                : index === activeIndex
                  ? "is-active"
                  : "is-pending";
            const stateLabel =
              index < activeIndex
                ? "Klaar"
                : index === activeIndex
                  ? props.stalled
                    ? "Wachten"
                    : "Actief"
                  : "Straks";

            return (
              <li class={`admin-loader-step ${stateClass}`} key={step.label}>
                <span class="admin-loader-step-dot" aria-hidden="true" />
                <div class="admin-loader-step-copy">
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <span class="admin-loader-step-state">{stateLabel}</span>
              </li>
            );
          })}
        </ul>
        <div class="admin-loader-foot">
          {props.hint && <p class="admin-loading-hint">{props.hint}</p>}
          <p class="admin-loader-elapsed">Bezig sinds {elapsedSeconds}s</p>
        </div>
      </div>
    </div>
  );
}

function mapSiteSettings(row: Record<string, unknown> | null | undefined): SiteSettings {
  if (!row) {
    return cloneDefaults().siteSettings;
  }

  return {
    siteName: String(row.site_name ?? adminDefaultContent.siteSettings.siteName),
    siteUrl: String(row.site_url ?? adminDefaultContent.siteSettings.siteUrl),
    logoUrl: String(row.logo_url ?? adminDefaultContent.siteSettings.logoUrl),
    email: String(row.email ?? adminDefaultContent.siteSettings.email),
    facebookUrl: String(row.facebook_url ?? adminDefaultContent.siteSettings.facebookUrl),
    instagramUrl: String(row.instagram_url ?? adminDefaultContent.siteSettings.instagramUrl),
    address: String(row.address ?? adminDefaultContent.siteSettings.address),
    addressNote: String(row.address_note ?? adminDefaultContent.siteSettings.addressNote),
    mapEmbedUrl: String(row.map_embed_url ?? adminDefaultContent.siteSettings.mapEmbedUrl),
    mapGoogleUrl: String(row.map_google_url ?? adminDefaultContent.siteSettings.mapGoogleUrl),
    mapAppleUrl: String(row.map_apple_url ?? adminDefaultContent.siteSettings.mapAppleUrl),
    footerCopyright: String(
      row.footer_copyright ?? adminDefaultContent.siteSettings.footerCopyright
    ),
    footerDeveloper: String(
      row.footer_developer ?? adminDefaultContent.siteSettings.footerDeveloper
    ),
    analyticsId: String(row.analytics_id ?? adminDefaultContent.siteSettings.analyticsId),
    footerAdminLabel: String(
      row.footer_admin_label ?? adminDefaultContent.siteSettings.footerAdminLabel
    )
  };
}

function toSiteSettingsRow(settings: SiteSettings) {
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

function mapGroup(row: Record<string, unknown>): Group {
  return {
    id: String(row.id ?? ""),
    slug: String(row.slug ?? ""),
    name: String(row.name ?? ""),
    themeKey: String(row.theme_key ?? "ribbels"),
    ageRange: String(row.age_range ?? ""),
    birthYears: String(row.birth_years ?? ""),
    schoolYears: String(row.school_years ?? ""),
    description: String(row.description ?? ""),
    imageUrl: String(row.image_url ?? ""),
    imageAlt: String(row.image_alt ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    leaders: Array.isArray(row.leaders) ? (row.leaders as Person[]) : []
  };
}

function toGroupRow(group: Group) {
  const row: Record<string, unknown> = {
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
  };

  if (group.id && !group.id.startsWith("temp-")) {
    row.id = group.id;
  }

  return row;
}

function mapContactSection(row: Record<string, unknown>): ContactSection {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    accentColor: String(row.accent_color ?? "#94a3b8"),
    sortOrder: Number(row.sort_order ?? 0),
    people: Array.isArray(row.people) ? (row.people as Person[]) : []
  };
}

function toContactSectionRow(section: ContactSection) {
  const row: Record<string, unknown> = {
    title: section.title,
    accent_color: section.accentColor,
    sort_order: section.sortOrder,
    people: section.people
  };

  if (section.id && !section.id.startsWith("temp-")) {
    row.id = section.id;
  }

  return row;
}

function mapSong(row: Record<string, unknown>): Song {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    lyrics: String(row.lyrics ?? ""),
    sortOrder: Number(row.sort_order ?? 0)
  };
}

function toSongRow(song: Song) {
  const row: Record<string, unknown> = {
    title: song.title,
    lyrics: song.lyrics,
    sort_order: song.sortOrder
  };

  if (song.id && !song.id.startsWith("temp-")) {
    row.id = song.id;
  }

  return row;
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

function toPostRow(post: Post) {
  const row: Record<string, unknown> = {
    title: post.title,
    summary: post.summary,
    body: post.body,
    event_date: post.eventDate || null,
    published: post.published,
    featured: post.featured
  };

  if (post.id && !post.id.startsWith("temp-")) {
    row.id = post.id;
  }

  return row;
}

function getTodayDateInputValue() {
  const now = new Date();
  return formatDateInput(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString());
}

function createEmptyPost(): Post {
  return {
    id: tempId("post"),
    title: "",
    summary: "",
    body: "",
    eventDate: getTodayDateInputValue(),
    published: false,
    featured: false
  };
}

function normalizePost(post: Post, overrides: Partial<Post> = {}): Post {
  const nextPost = {
    ...post,
    ...overrides
  };

  return {
    ...nextPost,
    title: nextPost.title.trim(),
    summary: nextPost.summary.trim(),
    body: nextPost.body.trim(),
    eventDate: formatDateInput(nextPost.eventDate)
  };
}

function getPostPublishError(post: Post) {
  if (!post.title) {
    return "Geef je post eerst een titel voor je hem publiceert.";
  }

  if (!post.body) {
    return "Schrijf eerst inhoud voor je deze post publiceert.";
  }

  return null;
}

function mapContactMessage(row: Record<string, unknown>): ContactMessage {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    subject: String(row.subject ?? ""),
    category: String(row.category ?? ""),
    message: String(row.message ?? ""),
    createdAt: String(row.created_at ?? "")
  };
}

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    user_id: String(row.user_id ?? ""),
    email: String(row.email ?? ""),
    full_name: String(row.full_name ?? ""),
    role: (row.role as Role) ?? "editor",
    created_at: String(row.created_at ?? "")
  };
}

async function uploadAsset(client: SupabaseClient, file: File, folder: string) {
  const extension = file.name.split(".").pop() ?? "jpg";
  const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "beeld";
  const path = `${folder}/${Date.now()}-${base}.${extension}`;
  const { error } = await client.storage.from("site-media").upload(path, file, {
    upsert: true
  });

  if (error) {
    throw error;
  }

  const { data } = client.storage.from("site-media").getPublicUrl(path);
  return data.publicUrl;
}

function TextField(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: string;
  name?: string;
  autoComplete?: string;
}) {
  return (
    <label class="admin-field">
      <span>{props.label}</span>
      <input
        type={props.type ?? "text"}
        name={props.name}
        autoComplete={props.autoComplete}
        value={props.value}
        onInput={(event) => props.onInput((event.currentTarget as HTMLInputElement).value)}
      />
    </label>
  );
}

function TextAreaField(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  rows?: number;
}) {
  return (
    <label class="admin-field">
      <span>{props.label}</span>
      <textarea
        rows={props.rows ?? 5}
        value={props.value}
        onInput={(event) => props.onInput((event.currentTarget as HTMLTextAreaElement).value)}
      />
    </label>
  );
}

function CheckboxField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="admin-checkbox">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange((event.currentTarget as HTMLInputElement).checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function ImageField(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  client: SupabaseClient | null;
  folder: string;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !props.client) {
      return;
    }

    setUploading(true);
    try {
      const url = await uploadAsset(props.client, file, props.folder);
      props.onInput(url);
    } catch (error) {
      console.error("Image upload failed.", error);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div class="admin-image-field">
      <TextField label={props.label} value={props.value} onInput={props.onInput} />
      <div class="admin-image-row">
        <input type="file" accept="image/*" onChange={handleFileChange} />
        <span class="muted-small">{uploading ? "Upload bezig..." : "Upload naar site-media"}</span>
      </div>
      {props.value && <img class="admin-image-preview" src={props.value} alt="" />}
    </div>
  );
}

function FileField(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  client: SupabaseClient | null;
  folder: string;
  accept?: string;
  fileName?: string;
  onFileNameInput?: (value: string) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !props.client) {
      return;
    }

    setUploading(true);
    try {
      const url = await uploadAsset(props.client, file, props.folder);
      props.onInput(url);
      props.onFileNameInput?.(file.name);
    } catch (error) {
      console.error("File upload failed.", error);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div class="admin-image-field">
      <TextField label={props.label} value={props.value} onInput={props.onInput} />
      {props.onFileNameInput && (
        <TextField
          label="Bestandsnaam download"
          value={props.fileName ?? ""}
          onInput={props.onFileNameInput}
        />
      )}
      <div class="admin-image-row">
        <input type="file" accept={props.accept ?? "*/*"} onChange={handleFileChange} />
        <span class="muted-small">{uploading ? "Upload bezig..." : "Upload naar site-media"}</span>
      </div>
      {props.value && (
        <p class="muted-small">
          Huidig bestand: <a href={props.value} target="_blank" rel="noreferrer">{props.fileName || "Open bestand"}</a>
        </p>
      )}
    </div>
  );
}

function PeopleEditor(props: {
  title: string;
  people: Person[];
  onChange: (people: Person[]) => void;
}) {
  return (
    <div class="admin-subpanel">
      <div class="admin-subpanel-head">
        <h4>{props.title}</h4>
        <button
          class="btn btn-light"
          type="button"
          onClick={() => props.onChange([...props.people, { name: "", phone: "" }])}
        >
          Persoon toevoegen
        </button>
      </div>
      {props.people.map((person, index) => (
        <div class="admin-inline-grid" key={`${person.name}-${index}`}>
          <TextField
            label="Naam"
            value={person.name}
            onInput={(value) =>
              props.onChange(
                props.people.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, name: value } : current
                )
              )
            }
          />
          <TextField
            label="Telefoon"
            value={person.phone}
            onInput={(value) =>
              props.onChange(
                props.people.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, phone: value } : current
                )
              )
            }
          />
          <button
            class="admin-remove"
            type="button"
            onClick={() => props.onChange(props.people.filter((_, currentIndex) => currentIndex !== index))}
          >
            Verwijderen
          </button>
        </div>
      ))}
    </div>
  );
}

function LinkActionsEditor(props: {
  title: string;
  items: LinkAction[];
  onChange: (items: LinkAction[]) => void;
}) {
  return (
    <div class="admin-subpanel">
      <div class="admin-subpanel-head">
        <h4>{props.title}</h4>
        <button
          class="btn btn-light"
          type="button"
          onClick={() => props.onChange([...props.items, { label: "", href: "" }])}
        >
          Actie toevoegen
        </button>
      </div>
      {props.items.map((item, index) => (
        <div class="admin-inline-grid" key={`${item.label}-${index}`}>
          <TextField
            label="Label"
            value={item.label}
            onInput={(value) =>
              props.onChange(
                props.items.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, label: value } : current
                )
              )
            }
          />
          <TextField
            label="Link"
            value={item.href}
            onInput={(value) =>
              props.onChange(
                props.items.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, href: value } : current
                )
              )
            }
          />
          <button
            class="admin-remove"
            type="button"
            onClick={() => props.onChange(props.items.filter((_, currentIndex) => currentIndex !== index))}
          >
            Verwijderen
          </button>
        </div>
      ))}
    </div>
  );
}

function CardsEditor(props: {
  title: string;
  cards: PageCard[];
  onChange: (cards: PageCard[]) => void;
}) {
  return (
    <div class="admin-subpanel">
      <div class="admin-subpanel-head">
        <h4>{props.title}</h4>
        <button
          class="btn btn-light"
          type="button"
          onClick={() => props.onChange([...props.cards, { title: "", body: "", span: 12 }])}
        >
          Kaart toevoegen
        </button>
      </div>
      {props.cards.map((card, index) => (
        <div class="admin-card-editor" key={`${card.title}-${index}`}>
          <TextField
            label="Titel"
            value={card.title}
            onInput={(value) =>
              props.onChange(
                props.cards.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, title: value } : current
                )
              )
            }
          />
          <TextAreaField
            label="Inhoud (Markdown)"
            value={card.body}
            rows={6}
            onInput={(value) =>
              props.onChange(
                props.cards.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, body: value } : current
                )
              )
            }
          />
          <label class="admin-field">
            <span>Breedte</span>
            <select
              value={String(card.span)}
              onInput={(event) =>
                props.onChange(
                  props.cards.map((current, currentIndex) =>
                    currentIndex === index
                      ? { ...current, span: Number((event.currentTarget as HTMLSelectElement).value) }
                      : current
                  )
                )
              }
            >
              <option value="6">Half</option>
              <option value="12">Volledig</option>
            </select>
          </label>
          <button
            class="admin-remove"
            type="button"
            onClick={() => props.onChange(props.cards.filter((_, currentIndex) => currentIndex !== index))}
          >
            Kaart verwijderen
          </button>
        </div>
      ))}
    </div>
  );
}

function GalleryEditor(props: {
  items: HomePage["gallery"];
  onChange: (items: HomePage["gallery"]) => void;
  client: SupabaseClient | null;
}) {
  return (
    <div class="admin-subpanel">
      <div class="admin-subpanel-head">
        <h4>Fotogalerij</h4>
        <button
          class="btn btn-light"
          type="button"
          onClick={() =>
            props.onChange([...props.items, { imageUrl: "", alt: "", span: 4 }])
          }
        >
          Foto toevoegen
        </button>
      </div>
      {props.items.map((item, index) => (
        <div class="admin-card-editor" key={`${item.alt}-${index}`}>
          <ImageField
            label="Afbeelding"
            value={item.imageUrl}
            folder="gallery"
            client={props.client}
            onInput={(value) =>
              props.onChange(
                props.items.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, imageUrl: value } : current
                )
              )
            }
          />
          <TextField
            label="Alt-tekst"
            value={item.alt}
            onInput={(value) =>
              props.onChange(
                props.items.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, alt: value } : current
                )
              )
            }
          />
          <label class="admin-field">
            <span>Breedte</span>
            <select
              value={String(item.span)}
              onInput={(event) =>
                props.onChange(
                  props.items.map((current, currentIndex) =>
                    currentIndex === index
                      ? { ...current, span: Number((event.currentTarget as HTMLSelectElement).value) }
                      : current
                  )
                )
              }
            >
              <option value="4">Derde</option>
              <option value="6">Half</option>
              <option value="12">Volledig</option>
            </select>
          </label>
          <button
            class="admin-remove"
            type="button"
            onClick={() => props.onChange(props.items.filter((_, currentIndex) => currentIndex !== index))}
          >
            Foto verwijderen
          </button>
        </div>
      ))}
    </div>
  );
}

function PairsEditor<T extends object>(props: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  createItem: () => T;
  firstKey: keyof T;
  secondKey: keyof T;
  firstLabel: string;
  secondLabel: string;
}) {
  return (
    <div class="admin-subpanel">
      <div class="admin-subpanel-head">
        <h4>{props.title}</h4>
        <button class="btn btn-light" type="button" onClick={() => props.onChange([...props.items, props.createItem()])}>
          Rij toevoegen
        </button>
      </div>
      {props.items.map((item, index) => (
        <div class="admin-inline-grid" key={`${index}`}>
          <TextField
            label={props.firstLabel}
            value={String(item[props.firstKey] ?? "")}
            onInput={(value) =>
              props.onChange(
                props.items.map((current, currentIndex) =>
                  currentIndex === index
                    ? ({ ...current, [props.firstKey]: value } as T)
                    : current
                )
              )
            }
          />
          <TextField
            label={props.secondLabel}
            value={String(item[props.secondKey] ?? "")}
            onInput={(value) =>
              props.onChange(
                props.items.map((current, currentIndex) =>
                  currentIndex === index
                    ? ({ ...current, [props.secondKey]: value } as T)
                    : current
                )
              )
            }
          />
          <button
            class="admin-remove"
            type="button"
            onClick={() => props.onChange(props.items.filter((_, currentIndex) => currentIndex !== index))}
          >
            Verwijderen
          </button>
        </div>
      ))}
    </div>
  );
}

function ChecklistEditor(props: {
  sections: CampChecklistSection[];
  onChange: (sections: CampChecklistSection[]) => void;
}) {
  return (
    <div class="admin-subpanel">
      <div class="admin-subpanel-head">
        <h4>Checklistblokken</h4>
        <button
          class="btn btn-light"
          type="button"
          onClick={() =>
            props.onChange([...props.sections, { title: "", note: "", items: [] }])
          }
        >
          Blok toevoegen
        </button>
      </div>
      {props.sections.map((section, index) => (
        <div class="admin-card-editor" key={`${section.title}-${index}`}>
          <TextField
            label="Titel"
            value={section.title}
            onInput={(value) =>
              props.onChange(
                props.sections.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, title: value } : current
                )
              )
            }
          />
          <TextAreaField
            label="Korte noot"
            value={section.note}
            rows={3}
            onInput={(value) =>
              props.onChange(
                props.sections.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, note: value } : current
                )
              )
            }
          />
          <TextAreaField
            label="Items (1 per regel)"
            value={joinLines(section.items)}
            rows={6}
            onInput={(value) =>
              props.onChange(
                props.sections.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, items: splitLines(value) } : current
                )
              )
            }
          />
          <button
            class="admin-remove"
            type="button"
            onClick={() => props.onChange(props.sections.filter((_, currentIndex) => currentIndex !== index))}
          >
            Blok verwijderen
          </button>
        </div>
      ))}
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authLoading, setAuthLoading] = useState(true);
  const [authStalled, setAuthStalled] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataStalled, setDataStalled] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(cloneDefaults().siteSettings);
  const [pages, setPages] = useState<SitePages>(cloneDefaults().pages);
  const [groups, setGroups] = useState<Group[]>(cloneDefaults().groups);
  const [contactSections, setContactSections] = useState<ContactSection[]>(cloneDefaults().contactSections);
  const [songs, setSongs] = useState<Song[]>(cloneDefaults().songs);
  const [posts, setPosts] = useState<Post[]>(cloneDefaults().posts);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [deletedGroupIds, setDeletedGroupIds] = useState<string[]>([]);
  const [deletedContactSectionIds, setDeletedContactSectionIds] = useState<string[]>([]);
  const [deletedSongIds, setDeletedSongIds] = useState<string[]>([]);
  const [deletedPostIds, setDeletedPostIds] = useState<string[]>([]);
  const [loginEmail, setLoginEmail] = useState(() => getRememberedLoginEmail());
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberLogin, setRememberLogin] = useState(() => getRememberLoginPreference());
  const [postsSaving, setPostsSaving] = useState(false);
  const [activePostActionId, setActivePostActionId] = useState<string | null>(null);
  const [postFeedback, setPostFeedback] = useState<{ id: string; message: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");

  useEffect(() => {
    syncRememberedLogin(rememberLogin, loginEmail);
  }, [rememberLogin, loginEmail]);

  useEffect(() => {
    if (!publicSupabaseUrl || !publicSupabaseAnonKey) {
      setAuthLoading(false);
      return;
    }

    try {
      setClientError(null);
      setSupabase(
        createClient(publicSupabaseUrl, publicSupabaseAnonKey, {
          auth: {
            persistSession: true,
            storageKey: supabaseStorageKey,
            storage: createAdminAuthStorage()
          }
        })
      );
    } catch (error) {
      console.error("Supabase client kon niet worden geladen.", error);
      setClientError(
        "De beveiligde admin-module kon niet worden geladen. Ververs de pagina en probeer opnieuw."
      );
      setNotice({
        type: "error",
        message: "De admin-code kon niet worden gestart. Ververs de pagina of probeer later opnieuw."
      });
      setAuthLoading(false);
    }
  }, []);

  async function loadDashboard() {
    if (!supabase || !session) {
      return false;
    }

    setDataLoading(true);
    setDataStalled(false);
    setNotice(null);

    const stallTimeoutId = window.setTimeout(() => {
      setDataStalled(true);
    }, DASHBOARD_STALL_MS);

    try {
      const [
        siteSettingsResult,
        pageContentResult,
        groupsResult,
        contactSectionsResult,
        songsResult,
        postsResult,
        messagesResult,
        profilesResult
      ] = await withTimeout(
        Promise.all([
          supabase.from("site_settings").select("*").eq("id", 1).maybeSingle(),
          supabase.from("page_content").select("slug, data"),
          supabase.from("groups").select("*").order("sort_order", { ascending: true }),
          supabase.from("contact_sections").select("*").order("sort_order", { ascending: true }),
          supabase.from("songs").select("*").order("sort_order", { ascending: true }),
          supabase.from("posts").select("*").order("event_date", { ascending: false }),
          supabase.from("contact_messages").select("*").order("created_at", { ascending: false }),
          supabase.from("profiles").select("*").order("created_at", { ascending: true })
        ]),
        DASHBOARD_TIMEOUT_MS,
        "Het ophalen van de admin-data duurt te lang. Probeer opnieuw of meld je opnieuw aan."
      );

      if (
        siteSettingsResult.error ||
        pageContentResult.error ||
        groupsResult.error ||
        contactSectionsResult.error ||
        songsResult.error ||
        postsResult.error ||
        messagesResult.error ||
        profilesResult.error
      ) {
        throw new Error("Niet alle inhoud kon geladen worden.");
      }

      const profileRows = (profilesResult.data ?? []).map((row) =>
        mapProfile(row as Record<string, unknown>)
      );
      const currentProfile = profileRows.find((item) => item.user_id === session.user.id) ?? null;

      if (!currentProfile) {
        throw new Error("Je profiel kon niet geladen worden.");
      }

      const pageMap = Object.fromEntries(
        (pageContentResult.data ?? []).map((row) => [String(row.slug), row.data ?? {}])
      );

      setProfile(currentProfile);
      setProfiles(profileRows);
      setSiteSettings(mapSiteSettings(siteSettingsResult.data as Record<string, unknown> | null));
      setPages({
        home: mergePage(adminDefaultContent.pages.home, pageMap.home),
        groups: mergePage(adminDefaultContent.pages.groups, pageMap.groups),
        contact: mergePage(adminDefaultContent.pages.contact, pageMap.contact),
        songs: mergePage(adminDefaultContent.pages.songs, pageMap.songs),
        activities: mergePage(adminDefaultContent.pages.activities, pageMap.activities),
        registration: mergePage(adminDefaultContent.pages.registration, pageMap.registration),
        camp: mergePage(adminDefaultContent.pages.camp, pageMap.camp),
        rental: mergePage(adminDefaultContent.pages.rental, pageMap.rental),
        insurance: mergePage(adminDefaultContent.pages.insurance, pageMap.insurance),
        privacy: mergePage(adminDefaultContent.pages.privacy, pageMap.privacy)
      });
      setGroups(
        (groupsResult.data ?? []).length
          ? (groupsResult.data ?? []).map((row) => mapGroup(row as Record<string, unknown>))
          : cloneDefaults().groups
      );
      setContactSections(
        (contactSectionsResult.data ?? []).map((row) =>
          mapContactSection(row as Record<string, unknown>)
        )
      );
      setSongs((songsResult.data ?? []).map((row) => mapSong(row as Record<string, unknown>)));
      setPosts((postsResult.data ?? []).map((row) => mapPost(row as Record<string, unknown>)));
      setMessages(
        (messagesResult.data ?? []).map((row) => mapContactMessage(row as Record<string, unknown>))
      );
      setDeletedGroupIds([]);
      setDeletedContactSectionIds([]);
      setDeletedSongIds([]);
      setDeletedPostIds([]);
      setPostFeedback(null);
      return true;
    } catch (error) {
      console.error(error);
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "De beheeromgeving kon niet geladen worden."
      });
      return false;
    } finally {
      window.clearTimeout(stallTimeoutId);
      setDataLoading(false);
    }
  }

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const authClient = supabase;

    let isActive = true;
    setAuthStalled(false);
    const timeoutId = window.setTimeout(() => {
      if (isActive) {
        setAuthStalled(true);
        setNotice({
          type: "error",
          message: "De loginstart duurt langer dan normaal. Je kunt opnieuw laden of handmatig opnieuw aanmelden."
        });
        setAuthLoading(false);
      }
    }, AUTH_TIMEOUT_MS);

    async function initializeAuth() {
      try {
        const { data, error } = await authClient.auth.getSession();
        if (error) {
          throw error;
        }

        if (isActive) {
          setSession(data.session);
          setAuthMode(data.session ? detectAuthMode() : "login");
        }
      } catch (error) {
        console.error("Authenticatie kon niet worden geladen.", error);
        if (isActive) {
          setNotice({
            type: "error",
            message: "De login kon niet automatisch geladen worden. Probeer handmatig in te loggen."
          });
        }
      } finally {
        if (isActive) {
          setAuthLoading(false);
        }
        window.clearTimeout(timeoutId);
      }
    }

    initializeAuth();

    const {
      data: { subscription }
    } = authClient.auth.onAuthStateChange((event, currentSession) => {
      setSession(currentSession);
      setAuthMode(
        currentSession && (event === "PASSWORD_RECOVERY" || detectAuthMode() === "recovery")
          ? "recovery"
          : "login"
      );
      setAuthLoading(false);
    });

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (session && authMode !== "recovery") {
      void loadDashboard();
    } else {
      setProfile(null);
      setProfiles([]);
      setMessages([]);
      setDataLoading(false);
      setDataStalled(false);
    }
  }, [session, authMode]);

  const availableTabs = [
    { id: "overview" as TabId, label: "Overzicht" },
    { id: "site" as TabId, label: "Site" },
    { id: "home" as TabId, label: "Home" },
    { id: "groups" as TabId, label: "Groepen" },
    { id: "contact" as TabId, label: "Contact" },
    { id: "songs" as TabId, label: "Liedjes" },
    { id: "posts" as TabId, label: "Posts" },
    { id: "registration" as TabId, label: "Inschrijven" },
    { id: "camp" as TabId, label: "Kamp" },
    { id: "pages" as TabId, label: "Overige pagina's" },
    { id: "messages" as TabId, label: "Berichten" }
  ];

  if (profile?.role === "admin") {
    availableTabs.push({ id: "team", label: "Team" });
  }

  async function signIn() {
    if (!supabase) {
      return;
    }

    const trimmedEmail = loginEmail.trim();
    setNotice(null);
    syncRememberedLogin(rememberLogin, trimmedEmail);

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password: loginPassword
    });

    if (error) {
      setNotice({ type: "error", message: error.message });
      return;
    }

    setLoginEmail(trimmedEmail);
    setLoginPassword("");
  }

  async function sendResetLink() {
    const trimmedEmail = loginEmail.trim();

    if (!supabase || !trimmedEmail) {
      return;
    }

    setNotice(null);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${window.location.origin}/admin/`
    });

    setNotice({
      type: error ? "error" : "success",
      message: error
        ? error.message
        : "Resetmail verzonden. Check je inbox om een nieuw wachtwoord te kiezen."
    });
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    clearStoredAdminAuth(supabaseStorageKey);
    clearAuthUrlState();
    setAuthMode("login");
    setNewPassword("");
    setConfirmPassword("");
    setLoginPassword("");
    setActiveTab("overview");
  }

  async function updatePassword() {
    if (!supabase || !session) {
      return;
    }

    if (newPassword.length < 8) {
      setNotice({
        type: "error",
        message: "Kies een wachtwoord van minstens 8 tekens."
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setNotice({
        type: "error",
        message: "De twee wachtwoorden komen niet overeen."
      });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setNotice({ type: "error", message: error.message });
      return;
    }

    clearAuthUrlState();
    setAuthMode("login");
    setNewPassword("");
    setConfirmPassword("");
    setNotice({
      type: "success",
      message: "Wachtwoord opgeslagen. Je kunt nu verder in het beheerpaneel."
    });
  }

  async function saveSite() {
    if (!supabase) {
      return;
    }

    const { error } = await supabase.from("site_settings").upsert(toSiteSettingsRow(siteSettings));
    setNotice({
      type: error ? "error" : "success",
      message: error ? error.message : "Site-instellingen opgeslagen."
    });
  }

  async function savePage(slug: keyof SitePages, data: SitePages[keyof SitePages], successText: string) {
    if (!supabase) {
      return;
    }

    const { error } = await supabase
      .from("page_content")
      .upsert({ slug, data }, { onConflict: "slug" });
    setNotice({
      type: error ? "error" : "success",
      message: error ? error.message : successText
    });
  }

  async function saveGroups() {
    if (!supabase) {
      return;
    }

    const pageError = await supabase
      .from("page_content")
      .upsert({ slug: "groups", data: pages.groups }, { onConflict: "slug" });

    if (pageError.error) {
      setNotice({ type: "error", message: pageError.error.message });
      return;
    }

    const { error } = await supabase.from("groups").upsert(groups.map(toGroupRow));
    if (error) {
      setNotice({ type: "error", message: error.message });
      return;
    }

    if (deletedGroupIds.length) {
      const deleteResult = await supabase.from("groups").delete().in("id", deletedGroupIds);
      if (deleteResult.error) {
        setNotice({ type: "error", message: deleteResult.error.message });
        return;
      }
    }

    setNotice({ type: "success", message: "Groepen opgeslagen." });
    await loadDashboard();
  }

  async function saveContact() {
    if (!supabase) {
      return;
    }

    const pageResult = await supabase.from("page_content").upsert(
      {
        slug: "contact",
        data: { ...pages.contact, extraSections: contactSections }
      },
      { onConflict: "slug" }
    );

    if (pageResult.error) {
      setNotice({ type: "error", message: pageResult.error.message });
      return;
    }

    const { error } = await supabase
      .from("contact_sections")
      .upsert(contactSections.map(toContactSectionRow));
    if (error) {
      setNotice({ type: "error", message: error.message });
      return;
    }

    if (deletedContactSectionIds.length) {
      const deleteResult = await supabase
        .from("contact_sections")
        .delete()
        .in("id", deletedContactSectionIds);
      if (deleteResult.error) {
        setNotice({ type: "error", message: deleteResult.error.message });
        return;
      }
    }

    setNotice({ type: "success", message: "Contactgegevens opgeslagen." });
    await loadDashboard();
  }

  async function saveSongs() {
    if (!supabase) {
      return;
    }

    const pageResult = await supabase
      .from("page_content")
      .upsert({ slug: "songs", data: pages.songs }, { onConflict: "slug" });

    if (pageResult.error) {
      setNotice({ type: "error", message: pageResult.error.message });
      return;
    }

    const { error } = await supabase.from("songs").upsert(songs.map(toSongRow));
    if (error) {
      setNotice({ type: "error", message: error.message });
      return;
    }

    if (deletedSongIds.length) {
      const deleteResult = await supabase.from("songs").delete().in("id", deletedSongIds);
      if (deleteResult.error) {
        setNotice({ type: "error", message: deleteResult.error.message });
        return;
      }
    }

    setNotice({ type: "success", message: "Liedjes opgeslagen." });
    await loadDashboard();
  }

  function updatePostAt(index: number, updater: (post: Post) => Post) {
    setPosts((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? updater(item) : item))
    );
  }

  async function saveSinglePost(index: number, publish: boolean) {
    if (!supabase || postsSaving) {
      return;
    }

    const currentPost = posts[index];
    if (!currentPost) {
      return;
    }

    const sourceId = currentPost.id || `post-${index}`;
    const nextPost = normalizePost(currentPost, publish ? { published: true } : {});
    const publishError = publish ? getPostPublishError(nextPost) : null;

    if (publishError) {
      setNotice({ type: "error", message: publishError });
      return;
    }

    setNotice(null);
    setPostsSaving(true);
    setActivePostActionId(sourceId);
    setPostFeedback(null);

    const { data, error } = await supabase.from("posts").upsert(toPostRow(nextPost)).select().single();

    if (error) {
      setPostsSaving(false);
      setActivePostActionId(null);
      setNotice({ type: "error", message: error.message });
      return;
    }

    const savedPost = mapPost(data as Record<string, unknown>);
    const successMessage = savedPost.published
      ? `Post "${savedPost.title}" staat nu live op de activiteitenpagina.`
      : savedPost.title
        ? `Concept "${savedPost.title}" is opgeslagen.`
        : "Concept opgeslagen.";

    setPosts((current) =>
      current.map((item, itemIndex) =>
        (item.id || `post-${itemIndex}`) === sourceId ? savedPost : item
      )
    );
    setDeletedPostIds((current) => current.filter((id) => id !== savedPost.id));
    setPostFeedback({
      id: savedPost.id || sourceId,
      message: savedPost.published
        ? "Gelukt: deze post staat nu live."
        : "Gelukt: dit concept is opgeslagen."
    });
    setNotice({ type: "success", message: successMessage });
    setPostsSaving(false);
    setActivePostActionId(null);
  }

  async function savePosts() {
    if (!supabase || postsSaving) {
      return;
    }

    const normalizedPosts = posts.map((post) => normalizePost(post));
    const invalidPublishedPost = normalizedPosts.find(
      (post) => post.published && Boolean(getPostPublishError(post))
    );

    if (invalidPublishedPost) {
      setNotice({
        type: "error",
        message: getPostPublishError(invalidPublishedPost) ?? "Een gepubliceerde post is nog niet volledig ingevuld."
      });
      return;
    }

    if (!normalizedPosts.length && !deletedPostIds.length) {
      setNotice({ type: "success", message: "Er zijn geen posts om op te slaan." });
      return;
    }

    setNotice(null);
    setPostsSaving(true);
    setActivePostActionId("bulk");
    setPostFeedback(null);

    try {
      if (normalizedPosts.length) {
        const { error } = await supabase.from("posts").upsert(normalizedPosts.map(toPostRow));
        if (error) {
          throw error;
        }
      }

      if (deletedPostIds.length) {
        const deleteResult = await supabase.from("posts").delete().in("id", deletedPostIds);
        if (deleteResult.error) {
          throw deleteResult.error;
        }
      }

      const refreshed = await loadDashboard();
      if (refreshed) {
        setNotice({
          type: "success",
          message: normalizedPosts.length
            ? "Alle posts zijn bijgewerkt."
            : "Verwijderde posts zijn verwerkt."
        });
      }
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Posts opslaan lukte niet."
      });
    } finally {
      setPostsSaving(false);
      setActivePostActionId(null);
    }
  }

  async function deleteMessage(id: string) {
    if (!supabase || !confirm("Dit bericht verwijderen?")) {
      return;
    }

    const { error } = await supabase.from("contact_messages").delete().eq("id", id);
    setNotice({
      type: error ? "error" : "success",
      message: error ? error.message : "Bericht verwijderd."
    });

    if (!error) {
      setMessages((current) => current.filter((message) => message.id !== id));
    }
  }

  async function saveProfiles() {
    if (!supabase || profile?.role !== "admin") {
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .upsert(
        profiles.map((current) => ({
          user_id: current.user_id,
          email: current.email,
          full_name: current.full_name,
          role: current.role
        }))
      );

    setNotice({
      type: error ? "error" : "success",
      message: error ? error.message : "Teamrollen bijgewerkt."
    });
  }

  async function inviteLeader() {
    if (!session || profile?.role !== "admin") {
      return;
    }

    const response = await fetch("/api/admin/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        email: inviteEmail,
        fullName: inviteName,
        role: inviteRole
      })
    });

    const result = await response.json();
    setNotice({
      type: response.ok ? "success" : "error",
      message: result.message ?? (response.ok ? "Uitnodiging verstuurd." : "Uitnodigen lukte niet.")
    });

    if (response.ok) {
      setInviteEmail("");
      setInviteName("");
      setInviteRole("editor");
      await loadDashboard();
    }
  }

  const isBootingDashboard = Boolean(session && authMode !== "recovery" && !profile && dataLoading);

  if (!publicSupabaseUrl || !publicSupabaseAnonKey) {
    return (
      <div class="admin-app admin-auth-wrap">
        <div class="admin-auth-card">
          <h1>Admin configuratie ontbreekt</h1>
          <p>Vul eerst `PUBLIC_SUPABASE_URL` en `PUBLIC_SUPABASE_ANON_KEY` in om de login te activeren.</p>
        </div>
      </div>
    );
  }

  if (clientError) {
    return (
      <div class="admin-app admin-auth-wrap">
        <div class="admin-auth-card">
          <p class="admin-kicker">Leiding Admin</p>
          <h1>De admin startte niet correct op</h1>
          <p class="muted">{clientError}</p>
          {notice && <div class={`admin-notice admin-notice-${notice.type}`}>{notice.message}</div>}
          <div class="admin-auth-actions">
            <button class="btn" type="button" onClick={() => window.location.reload()}>
              Pagina verversen
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <AdminLoadingScreen
        eyebrow="Leiding Admin"
        title="Admin wordt opgestart"
        body="We controleren je sessie en bereiden de beheeromgeving voor."
        stalled={authStalled}
        steps={[
          {
            label: "Beveiligde module laden",
            detail: "De admincode en logincomponenten worden lokaal opgestart."
          },
          {
            label: "Supabase verbinden",
            detail: "We maken een veilige verbinding met de loginservice."
          },
          {
            label: "Sessie controleren",
            detail: "We kijken of je op dit toestel al bent aangemeld.",
            delayedDetail: "De sessiecontrole duurt langer dan normaal, maar loopt nog."
          },
          {
            label: "Login klaarmaken",
            detail: "De juiste login- of herstelstap wordt voorbereid."
          }
        ]}
        hint={
          authStalled
            ? "Dit duurt langer dan normaal. Ververs de pagina als dit scherm blijft staan."
            : "Even geduld, dit duurt normaal maar een paar seconden."
        }
      />
    );
  }

  if (isBootingDashboard) {
    return (
      <AdminLoadingScreen
        eyebrow="Leiding Admin"
        title="Beheeromgeving laden"
        body="Je inhoud, berichten en teamgegevens worden opgehaald."
        stalled={dataStalled}
        steps={[
          {
            label: "Profiel ophalen",
            detail: "We laden je rol en rechten in."
          },
          {
            label: "Site-inhoud lezen",
            detail: "Pagina's, groepen en liedjes worden uit de databank opgehaald."
          },
          {
            label: "Berichten synchroniseren",
            detail: "Contactberichten en teaminformatie komen binnen."
          },
          {
            label: "Dashboard opbouwen",
            detail: "Alles wordt klaargezet in het beheerpaneel."
          }
        ]}
        hint={
          dataStalled
            ? "De verbinding met Supabase reageert traag. We wachten nog even op de eerste data."
            : "We bouwen je dashboard op."
        }
      />
    );
  }

  if (!session) {
    return (
      <div class="admin-app admin-auth-wrap">
        <div class="admin-auth-card">
          <p class="admin-kicker">Verborgen login</p>
          <h1>Leiding login</h1>
          <p class="muted">
            Meld aan met je eigen e-mailadres en wachtwoord. Nog geen toegang? Vraag een admin om je uit te nodigen.
          </p>
          {notice && <div class={`admin-notice admin-notice-${notice.type}`}>{notice.message}</div>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void signIn();
            }}
          >
            <TextField
              label="E-mail"
              value={loginEmail}
              onInput={setLoginEmail}
              type="email"
              name="email"
              autoComplete="email"
            />
            <TextField
              label="Wachtwoord"
              value={loginPassword}
              onInput={setLoginPassword}
              type="password"
              name="password"
              autoComplete="current-password"
            />
            <CheckboxField
              label="Onthoud mij op dit toestel"
              checked={rememberLogin}
              onChange={setRememberLogin}
            />
            <div class="admin-auth-actions">
              <button class="btn" type="submit">
                Inloggen
              </button>
              <button class="btn btn-light" type="button" onClick={sendResetLink}>
                Wachtwoord resetten
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (authMode === "recovery") {
    return (
      <div class="admin-app admin-auth-wrap">
        <div class="admin-auth-card">
          <p class="admin-kicker">Account activeren</p>
          <h1>Stel je wachtwoord in</h1>
          <p class="muted">
            Kies hieronder een nieuw wachtwoord om je account te activeren of je wachtwoord te herstellen.
          </p>
          {notice && <div class={`admin-notice admin-notice-${notice.type}`}>{notice.message}</div>}
          <TextField
            label="Nieuw wachtwoord"
            value={newPassword}
            onInput={setNewPassword}
            type="password"
            name="new-password"
            autoComplete="new-password"
          />
          <TextField
            label="Bevestig wachtwoord"
            value={confirmPassword}
            onInput={setConfirmPassword}
            type="password"
            name="confirm-password"
            autoComplete="new-password"
          />
          <div class="admin-auth-actions">
            <button class="btn" type="button" onClick={updatePassword}>
              Wachtwoord opslaan
            </button>
            <button class="btn btn-light" type="button" onClick={signOut}>
              Annuleren
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div class="admin-app admin-auth-wrap">
        <div class="admin-auth-card">
          <p class="admin-kicker">Leiding Admin</p>
          <h1>De admin kon niet volledig laden</h1>
          <p class="muted">
            {notice?.message ??
              "De eerste laadbeurt is mislukt. Probeer opnieuw of meld je opnieuw aan."}
          </p>
          <div class="admin-auth-actions">
            <button class="btn" type="button" onClick={() => void loadDashboard()}>
              Opnieuw proberen
            </button>
            <button class="btn btn-light" type="button" onClick={() => void signOut()}>
              Opnieuw aanmelden
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="admin-app">
      <aside class="admin-sidebar">
        <div>
          <p class="admin-kicker">Beheer</p>
          <h1>Chiro Negenmanneke</h1>
          <p class="muted">Inhoud live aanpassen zonder code.</p>
        </div>
        <nav class="admin-tabs">
          {availableTabs.map((tab) => (
            <button
              type="button"
              class={activeTab === tab.id ? "is-active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div class="admin-sidebar-foot">
          <p class="muted-small">
            Ingelogd als <strong>{profile?.email ?? session.user.email}</strong>
          </p>
          <button class="btn btn-light" type="button" onClick={signOut}>
            Uitloggen
          </button>
        </div>
      </aside>

      <main class="admin-main">
        {notice && <div class={`admin-notice admin-notice-${notice.type}`}>{notice.message}</div>}
        {dataLoading && <div class="admin-loading-inline">Data verversen...</div>}

        {activeTab === "overview" && (
          <section class="admin-panel">
            <h2>Overzicht</h2>
            <p>
              Hier beheer je de hele website: home, groepen, contact, liedjes, posts en de vaste pagina's.
            </p>
            <ul class="admin-stat-list">
              <li>{groups.length} groepen</li>
              <li>{songs.length} liedjes</li>
              <li>{posts.length} posts</li>
              <li>{messages.length} contactberichten</li>
            </ul>
          </section>
        )}

        {activeTab === "site" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Site-instellingen</h2>
                <p>Globale contactinfo, footer en links.</p>
              </div>
              <button class="btn" type="button" onClick={saveSite}>
                Opslaan
              </button>
            </div>

            <div class="admin-grid">
              <TextField label="Sitenaam" value={siteSettings.siteName} onInput={(value) => setSiteSettings((current) => ({ ...current, siteName: value }))} />
              <TextField label="Site URL" value={siteSettings.siteUrl} onInput={(value) => setSiteSettings((current) => ({ ...current, siteUrl: value }))} />
              <ImageField label="Logo URL" value={siteSettings.logoUrl} onInput={(value) => setSiteSettings((current) => ({ ...current, logoUrl: value }))} client={supabase} folder="branding" />
              <TextField label="E-mail" value={siteSettings.email} onInput={(value) => setSiteSettings((current) => ({ ...current, email: value }))} />
              <TextField label="Facebook" value={siteSettings.facebookUrl} onInput={(value) => setSiteSettings((current) => ({ ...current, facebookUrl: value }))} />
              <TextField label="Instagram" value={siteSettings.instagramUrl} onInput={(value) => setSiteSettings((current) => ({ ...current, instagramUrl: value }))} />
              <TextField label="Adres" value={siteSettings.address} onInput={(value) => setSiteSettings((current) => ({ ...current, address: value }))} />
              <TextField label="Adresnoot" value={siteSettings.addressNote} onInput={(value) => setSiteSettings((current) => ({ ...current, addressNote: value }))} />
              <TextField label="Google Maps embed" value={siteSettings.mapEmbedUrl} onInput={(value) => setSiteSettings((current) => ({ ...current, mapEmbedUrl: value }))} />
              <TextField label="Google Maps route" value={siteSettings.mapGoogleUrl} onInput={(value) => setSiteSettings((current) => ({ ...current, mapGoogleUrl: value }))} />
              <TextField label="Apple Maps" value={siteSettings.mapAppleUrl} onInput={(value) => setSiteSettings((current) => ({ ...current, mapAppleUrl: value }))} />
              <TextField label="Analytics ID" value={siteSettings.analyticsId} onInput={(value) => setSiteSettings((current) => ({ ...current, analyticsId: value }))} />
              <TextField label="Footer login label" value={siteSettings.footerAdminLabel} onInput={(value) => setSiteSettings((current) => ({ ...current, footerAdminLabel: value }))} />
              <TextAreaField label="Footer copyright" value={siteSettings.footerCopyright} onInput={(value) => setSiteSettings((current) => ({ ...current, footerCopyright: value }))} />
              <TextAreaField label="Footer ontwikkelaar" value={siteSettings.footerDeveloper} onInput={(value) => setSiteSettings((current) => ({ ...current, footerDeveloper: value }))} />
            </div>
          </section>
        )}

        {activeTab === "home" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Homepage</h2>
                <p>Banner, intro, praktische blokken en geschiedenis.</p>
              </div>
              <button class="btn" type="button" onClick={() => savePage("home", pages.home, "Homepage opgeslagen.")}>
                Opslaan
              </button>
            </div>

            <div class="admin-grid">
              <TextField label="Banner eyebrow" value={pages.home.banner.eyebrow} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, eyebrow: value } } }))} />
              <TextField label="Banner titel" value={pages.home.banner.title} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, title: value } } }))} />
              <TextField label="Banner subtitel" value={pages.home.banner.subtitle} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, subtitle: value } } }))} />
              <ImageField label="Banner afbeelding" value={pages.home.banner.imageUrl} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, imageUrl: value } } }))} client={supabase} folder="home" />
              <TextField label="Banner alt-tekst" value={pages.home.banner.imageAlt} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, imageAlt: value } } }))} />
              <TextField label="Primaire knop" value={pages.home.banner.primaryCtaLabel} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, primaryCtaLabel: value } } }))} />
              <TextField label="Primaire knop link" value={pages.home.banner.primaryCtaHref} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, primaryCtaHref: value } } }))} />
              <TextField label="Secundaire knop" value={pages.home.banner.secondaryCtaLabel} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, secondaryCtaLabel: value } } }))} />
              <TextField label="Secundaire knop link" value={pages.home.banner.secondaryCtaHref} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, banner: { ...current.home.banner, secondaryCtaHref: value } } }))} />
              <TextField label="Hero badge" value={pages.home.hero.badge} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, hero: { ...current.home.hero, badge: value } } }))} />
              <TextField label="Hero titel" value={pages.home.hero.title} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, hero: { ...current.home.hero, title: value } } }))} />
              <TextAreaField label="Hero intro" value={pages.home.hero.lead} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, hero: { ...current.home.hero, lead: value } } }))} />
              <TextField label="Blok: wat is chiro?" value={pages.home.about.title} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, about: { ...current.home.about, title: value } } }))} />
              <TextAreaField label="Tekst: wat is chiro? (Markdown)" value={pages.home.about.body} rows={6} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, about: { ...current.home.about, body: value } } }))} />
              <TextField label="CTA label" value={pages.home.about.ctaLabel} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, about: { ...current.home.about, ctaLabel: value } } }))} />
              <TextField label="CTA link" value={pages.home.about.ctaHref} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, about: { ...current.home.about, ctaHref: value } } }))} />
              <TextField label="Praktisch titel" value={pages.home.practical.title} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, practical: { ...current.home.practical, title: value } } }))} />
              <TextAreaField label="Praktische items (1 per regel)" value={joinLines(pages.home.practical.items)} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, practical: { ...current.home.practical, items: splitLines(value) } } }))} />
              <TextAreaField label="Praktische noot" value={pages.home.practical.note} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, practical: { ...current.home.practical, note: value } } }))} />
              <TextField label="Geschiedenis titel" value={pages.home.history.title} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, history: { ...current.home.history, title: value } } }))} />
              <TextAreaField label="Geschiedenis (Markdown)" value={pages.home.history.body} rows={16} onInput={(value) => setPages((current) => ({ ...current, home: { ...current.home, history: { ...current.home.history, body: value } } }))} />
            </div>

            <GalleryEditor items={pages.home.gallery} onChange={(items) => setPages((current) => ({ ...current, home: { ...current.home, gallery: items } }))} client={supabase} />
          </section>
        )}

        {activeTab === "groups" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Groepen</h2>
                <p>Beheer de publieke groepenkaarten en hun leiding.</p>
              </div>
              <button class="btn" type="button" onClick={saveGroups}>
                Opslaan
              </button>
            </div>

            <div class="admin-grid">
              <TextField label="Paginatitel" value={pages.groups.title} onInput={(value) => setPages((current) => ({ ...current, groups: { ...current.groups, title: value } }))} />
              <TextAreaField label="Lead" value={pages.groups.lead} onInput={(value) => setPages((current) => ({ ...current, groups: { ...current.groups, lead: value } }))} />
            </div>

            <div class="admin-subpanel">
              <div class="admin-subpanel-head">
                <h4>Groepenlijst</h4>
                <button class="btn btn-light" type="button" onClick={() => setGroups((current) => [...current, { id: tempId("group"), slug: "", name: "", themeKey: "ribbels", ageRange: "", birthYears: "", schoolYears: "", description: "", imageUrl: "", imageAlt: "", sortOrder: current.length + 1, leaders: [] }])}>
                  Groep toevoegen
                </button>
              </div>

              {groups.map((group, index) => (
                <div class="admin-card-editor" key={group.id ?? group.slug ?? index}>
                  <div class="admin-inline-grid admin-inline-grid-wide">
                    <TextField label="Naam" value={group.name} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: value } : item))} />
                    <TextField label="Slug" value={group.slug} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, slug: slugify(value) } : item))} />
                    <TextField label="Kleurkey" value={group.themeKey} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, themeKey: value } : item))} />
                    <TextField label="Volgorde" type="number" value={String(group.sortOrder)} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sortOrder: Number(value) || 0 } : item))} />
                    <TextField label="Leeftijd" value={group.ageRange} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ageRange: value } : item))} />
                    <TextField label="Geboortejaren" value={group.birthYears} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, birthYears: value } : item))} />
                    <TextField label="Schooljaren" value={group.schoolYears} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, schoolYears: value } : item))} />
                  </div>
                  <ImageField label="Groepsfoto" value={group.imageUrl} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, imageUrl: value } : item))} client={supabase} folder="groups" />
                  <TextField label="Alt-tekst afbeelding" value={group.imageAlt} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, imageAlt: value } : item))} />
                  <TextAreaField label="Beschrijving" value={group.description} rows={4} onInput={(value) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: value } : item))} />
                  <PeopleEditor title="Leiding" people={group.leaders} onChange={(people) => setGroups((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, leaders: people } : item))} />
                  <button
                    class="admin-remove"
                    type="button"
                    onClick={() => {
                      if (group.id && !group.id.startsWith("temp-")) {
                        setDeletedGroupIds((current) => [...current, group.id!]);
                      }
                      setGroups((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    Groep verwijderen
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "contact" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Contact</h2>
                <p>Algemene contactpagina en extra contactblokken.</p>
              </div>
              <button class="btn" type="button" onClick={saveContact}>
                Opslaan
              </button>
            </div>

            <div class="admin-grid">
              <TextField label="Paginatitel" value={pages.contact.title} onInput={(value) => setPages((current) => ({ ...current, contact: { ...current.contact, title: value } }))} />
              <TextField label="Algemene titel" value={pages.contact.generalTitle} onInput={(value) => setPages((current) => ({ ...current, contact: { ...current.contact, generalTitle: value } }))} />
              <TextAreaField label="Algemene tekst (Markdown)" value={pages.contact.generalBody} rows={8} onInput={(value) => setPages((current) => ({ ...current, contact: { ...current.contact, generalBody: value } }))} />
              <TextField label="Formuliertitel" value={pages.contact.formTitle} onInput={(value) => setPages((current) => ({ ...current, contact: { ...current.contact, formTitle: value } }))} />
              <TextAreaField label="Succesmelding" value={pages.contact.successMessage} onInput={(value) => setPages((current) => ({ ...current, contact: { ...current.contact, successMessage: value } }))} />
              <TextAreaField label="Foutmelding" value={pages.contact.errorMessage} onInput={(value) => setPages((current) => ({ ...current, contact: { ...current.contact, errorMessage: value } }))} />
              <TextField label="Sectietitel rechts" value={pages.contact.sectionsTitle} onInput={(value) => setPages((current) => ({ ...current, contact: { ...current.contact, sectionsTitle: value } }))} />
              <TextAreaField label="Formuliercategorieen (1 per regel)" value={joinLines(pages.contact.formCategories)} onInput={(value) => setPages((current) => ({ ...current, contact: { ...current.contact, formCategories: splitLines(value) } }))} />
            </div>

            <div class="admin-subpanel">
              <div class="admin-subpanel-head">
                <h4>Extra contactblokken</h4>
                <button class="btn btn-light" type="button" onClick={() => setContactSections((current) => [...current, { id: tempId("contact"), title: "", accentColor: "#94a3b8", sortOrder: current.length + 1, people: [] }])}>
                  Blok toevoegen
                </button>
              </div>
              {contactSections.map((section, index) => (
                <div class="admin-card-editor" key={section.id ?? index}>
                  <div class="admin-inline-grid admin-inline-grid-wide">
                    <TextField label="Titel" value={section.title} onInput={(value) => setContactSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: value } : item))} />
                    <TextField label="Accentkleur" value={section.accentColor} onInput={(value) => setContactSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, accentColor: value } : item))} />
                    <TextField label="Volgorde" type="number" value={String(section.sortOrder)} onInput={(value) => setContactSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sortOrder: Number(value) || 0 } : item))} />
                  </div>
                  <PeopleEditor title="Personen" people={section.people} onChange={(people) => setContactSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, people } : item))} />
                  <button
                    class="admin-remove"
                    type="button"
                    onClick={() => {
                      if (section.id && !section.id.startsWith("temp-")) {
                        setDeletedContactSectionIds((current) => [...current, section.id!]);
                      }
                      setContactSections((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    Blok verwijderen
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "songs" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Liedjes</h2>
                <p>Titel, intro en volledige liedbundel.</p>
              </div>
              <button class="btn" type="button" onClick={saveSongs}>
                Opslaan
              </button>
            </div>

            <div class="admin-grid">
              <TextField label="Paginatitel" value={pages.songs.title} onInput={(value) => setPages((current) => ({ ...current, songs: { ...current.songs, title: value } }))} />
              <TextAreaField label="Lead" value={pages.songs.lead} onInput={(value) => setPages((current) => ({ ...current, songs: { ...current.songs, lead: value } }))} />
            </div>

            <div class="admin-subpanel">
              <div class="admin-subpanel-head">
                <h4>Liedjeslijst</h4>
                <button class="btn btn-light" type="button" onClick={() => setSongs((current) => [...current, { id: tempId("song"), title: "", lyrics: "", sortOrder: current.length + 1 }])}>
                  Liedje toevoegen
                </button>
              </div>
              {songs.map((song, index) => (
                <div class="admin-card-editor" key={song.id ?? index}>
                  <div class="admin-inline-grid admin-inline-grid-wide">
                    <TextField label="Titel" value={song.title} onInput={(value) => setSongs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: value } : item))} />
                    <TextField label="Volgorde" type="number" value={String(song.sortOrder)} onInput={(value) => setSongs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sortOrder: Number(value) || 0 } : item))} />
                  </div>
                  <TextAreaField label="Liedtekst" value={song.lyrics} rows={12} onInput={(value) => setSongs((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, lyrics: value } : item))} />
                  <button
                    class="admin-remove"
                    type="button"
                    onClick={() => {
                      if (song.id && !song.id.startsWith("temp-")) {
                        setDeletedSongIds((current) => [...current, song.id!]);
                      }
                      setSongs((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    Liedje verwijderen
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "posts" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Posts & activiteiten</h2>
                <p>Nieuwe berichten verschijnen onder de activiteitenpagina zodra je ze publiceert.</p>
              </div>
              <button class="btn" type="button" onClick={savePosts} disabled={postsSaving}>
                {activePostActionId === "bulk" ? "Posts opslaan..." : "Alles opslaan"}
              </button>
            </div>

            <div class="admin-subpanel">
              <div class="admin-post-toolbar">
                <div>
                  <h4>Sneller posten</h4>
                  <p class="muted">
                    `Post nu` slaat op en zet je bericht meteen live. `Concept opslaan` bewaart het alleen in de admin.
                  </p>
                </div>
                <a class="btn btn-light" href="/activiteiten.html" target="_blank" rel="noreferrer">
                  Bekijk activiteitenpagina
                </a>
              </div>
            </div>

            <div class="admin-subpanel">
              <div class="admin-subpanel-head">
                <h4>Berichten</h4>
                <button
                  class="btn btn-light"
                  type="button"
                  disabled={postsSaving}
                  onClick={() => setPosts((current) => [createEmptyPost(), ...current])}
                >
                  Nieuwe post maken
                </button>
              </div>

              {!posts.length && (
                <div class="admin-post-empty">
                  <strong>Nog geen posts.</strong>
                  <span>Maak hierboven je eerste post aan en publiceer hem meteen van hieruit.</span>
                </div>
              )}

              {posts.map((post, index) => (
                <div class="admin-card-editor" key={post.id ?? index}>
                  <div class="admin-post-head">
                    <div>
                      <h4>{post.title.trim() || `Nieuwe post ${posts.length - index}`}</h4>
                      <p class="admin-post-status">
                        {post.published
                          ? "Live op de activiteitenpagina"
                          : "Concept in admin, nog niet publiek zichtbaar"}
                      </p>
                    </div>
                    {post.featured && <span class="admin-post-badge">Uitgelicht</span>}
                  </div>

                  <TextField
                    label="Titel"
                    value={post.title}
                    onInput={(value) => updatePostAt(index, (item) => ({ ...item, title: value }))}
                  />
                  <TextField
                    label="Datum"
                    type="date"
                    value={formatDateInput(post.eventDate)}
                    onInput={(value) => updatePostAt(index, (item) => ({ ...item, eventDate: value }))}
                  />
                  <TextAreaField
                    label="Korte samenvatting"
                    value={post.summary}
                    rows={3}
                    onInput={(value) => updatePostAt(index, (item) => ({ ...item, summary: value }))}
                  />
                  <TextAreaField
                    label="Inhoud (Markdown)"
                    value={post.body}
                    rows={8}
                    onInput={(value) => updatePostAt(index, (item) => ({ ...item, body: value }))}
                  />
                  <div class="admin-inline-grid">
                    <CheckboxField
                      label="Gepubliceerd"
                      checked={post.published}
                      onChange={(checked) => updatePostAt(index, (item) => ({ ...item, published: checked }))}
                    />
                    <CheckboxField
                      label="Uitgelicht"
                      checked={post.featured}
                      onChange={(checked) => updatePostAt(index, (item) => ({ ...item, featured: checked }))}
                    />
                  </div>
                  {postFeedback?.id === (post.id || `post-${index}`) && (
                    <p class="admin-post-feedback">{postFeedback.message}</p>
                  )}
                  <div class="admin-post-actions">
                    <button
                      class="btn btn-light"
                      type="button"
                      disabled={postsSaving}
                      onClick={() => void saveSinglePost(index, false)}
                    >
                      {activePostActionId === (post.id || `post-${index}`)
                        ? "Opslaan..."
                        : "Concept opslaan"}
                    </button>
                    <button
                      class="btn"
                      type="button"
                      disabled={postsSaving}
                      onClick={() => void saveSinglePost(index, true)}
                    >
                      {activePostActionId === (post.id || `post-${index}`)
                        ? "Bezig..."
                        : post.published
                          ? "Wijzigingen publiceren"
                          : "Post nu"}
                    </button>
                  </div>
                  <button
                    class="admin-remove"
                    type="button"
                    disabled={postsSaving}
                    onClick={() => {
                      if (post.id && !post.id.startsWith("temp-")) {
                        setDeletedPostIds((current) => [...current, post.id!]);
                      }
                      setPosts((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    Post verwijderen
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "registration" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Inschrijven</h2>
                <p>Stapplan en kledijblok.</p>
              </div>
              <button class="btn" type="button" onClick={() => savePage("registration", pages.registration, "Inschrijfpagina opgeslagen.")}>
                Opslaan
              </button>
            </div>

            <div class="admin-grid">
              <TextField label="Titel" value={pages.registration.title} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, title: value } }))} />
              <TextAreaField label="Lead" value={pages.registration.lead} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, lead: value } }))} />
              <TextField label="Stappen titel" value={pages.registration.stepsTitle} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, stepsTitle: value } }))} />
              <TextAreaField label="Stappen (1 per regel)" value={joinLines(pages.registration.steps)} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, steps: splitLines(value) } }))} />
              <TextAreaField label="Tip" value={pages.registration.tip} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, tip: value } }))} />
              <TextField label="Groepentitel" value={pages.registration.groupsTitle} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, groupsTitle: value } }))} />
              <TextField label="Kledij titel" value={pages.registration.clothesTitle} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, clothesTitle: value } }))} />
              <TextAreaField label="Kledij tekst" value={pages.registration.clothesBody} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, clothesBody: value } }))} />
            </div>

            <div class="admin-subpanel">
              <h4>Merch</h4>
              <div class="admin-grid">
                <TextField label="Titel" value={pages.registration.merch.title} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, merch: { ...current.registration.merch, title: value } } }))} />
                <TextField label="Subtitel" value={pages.registration.merch.subtitle} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, merch: { ...current.registration.merch, subtitle: value } } }))} />
                <TextAreaField label="Items (1 per regel)" value={pages.registration.merch.body} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, merch: { ...current.registration.merch, body: value } } }))} />
                <TextAreaField label="Nota" value={pages.registration.merch.note} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, merch: { ...current.registration.merch, note: value } } }))} />
                <ImageField label="Merch afbeelding" value={pages.registration.merch.imageUrl} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, merch: { ...current.registration.merch, imageUrl: value } } }))} client={supabase} folder="merch" />
                <TextField label="Alt-tekst afbeelding" value={pages.registration.merch.imageAlt} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, merch: { ...current.registration.merch, imageAlt: value } } }))} />
                <TextAreaField label="Prijslabels (1 per regel)" value={joinLines(pages.registration.merch.prices)} onInput={(value) => setPages((current) => ({ ...current, registration: { ...current.registration, merch: { ...current.registration.merch, prices: splitLines(value) } } }))} />
              </div>
              <LinkActionsEditor title="Merch acties" items={pages.registration.merch.actions} onChange={(items) => setPages((current) => ({ ...current, registration: { ...current.registration, merch: { ...current.registration.merch, actions: items } } }))} />
            </div>
          </section>
        )}

        {activeTab === "camp" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Kamp</h2>
                <p>Volledige kampstructuur, checklist en inschrijfblok.</p>
              </div>
              <button class="btn" type="button" onClick={() => savePage("camp", pages.camp, "Kamppagina opgeslagen.")}>
                Opslaan
              </button>
            </div>

            <div class="admin-grid">
              <TextField label="Kicker" value={pages.camp.kicker} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, kicker: value } }))} />
              <TextField label="Titel" value={pages.camp.title} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, title: value } }))} />
              <TextAreaField label="Lead" value={pages.camp.lead} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, lead: value } }))} />
              <ImageField label="Hero afbeelding" value={pages.camp.heroImageUrl} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, heroImageUrl: value } }))} client={supabase} folder="camp" />
              <TextField label="Alt-tekst hero" value={pages.camp.heroImageAlt} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, heroImageAlt: value } }))} />
              <TextField label="Overzicht titel" value={pages.camp.overviewTitle} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, overviewTitle: value } }))} />
              <TextField label="Belangrijk titel" value={pages.camp.importantTitle} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, importantTitle: value } }))} />
              <ImageField label="Belangrijk afbeelding" value={pages.camp.importantImageUrl} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, importantImageUrl: value } }))} client={supabase} folder="camp" />
              <TextField label="Belangrijk afbeelding alt" value={pages.camp.importantImageAlt} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, importantImageAlt: value } }))} />
              <TextAreaField label="Belangrijk items (1 per regel)" value={joinLines(pages.camp.importantItems)} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, importantItems: splitLines(value) } }))} />
              <TextAreaField label="Belangrijk callout" value={pages.camp.importantNotice} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, importantNotice: value } }))} />
              <TextField label="Prijs titel" value={pages.camp.priceTitle} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, priceTitle: value } }))} />
              <TextField label="Rekeningnummer" value={pages.camp.bankAccount} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, bankAccount: value } }))} />
              <TextAreaField label="Mededeling" value={pages.camp.bankMessage} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, bankMessage: value } }))} />
              <TextAreaField label="Annulatiebeleid" value={pages.camp.cancellationPolicy} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, cancellationPolicy: value } }))} />
              <TextField label="Signup titel" value={pages.camp.signupTitle} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, signupTitle: value } }))} />
              <TextAreaField label="Signup intro" value={pages.camp.signupIntro} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, signupIntro: value } }))} />
              <TextField label="Signup link label" value={pages.camp.signupLinkLabel} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, signupLinkLabel: value } }))} />
              <TextField label="Signup link URL" value={pages.camp.signupLinkUrl} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, signupLinkUrl: value } }))} />
              <TextField label="Checklist titel" value={pages.camp.checklistTitle} onInput={(value) => setPages((current) => ({ ...current, camp: { ...current.camp, checklistTitle: value } }))} />
            </div>

            <LinkActionsEditor title="Hero CTA's" items={pages.camp.ctas} onChange={(items) => setPages((current) => ({ ...current, camp: { ...current.camp, ctas: items } }))} />
            <LinkActionsEditor title="Springlinks" items={pages.camp.jumpLinks} onChange={(items) => setPages((current) => ({ ...current, camp: { ...current.camp, jumpLinks: items } }))} />
            <PairsEditor<CampOverviewItem> title="Overzicht items" items={pages.camp.overviewItems} onChange={(items) => setPages((current) => ({ ...current, camp: { ...current.camp, overviewItems: items } }))} createItem={() => ({ title: "", text: "" })} firstLabel="Titel" secondLabel="Tekst" firstKey="title" secondKey="text" />
            <PairsEditor<{ label: string; value: string }> title="Prijsregels" items={pages.camp.priceItems} onChange={(items) => setPages((current) => ({ ...current, camp: { ...current.camp, priceItems: items } }))} createItem={() => ({ label: "", value: "" })} firstLabel="Label" secondLabel="Waarde" firstKey="label" secondKey="value" />
            <PairsEditor<{ title: string; body: string }> title="Ondersteuningsblokken" items={pages.camp.supportBoxes} onChange={(items) => setPages((current) => ({ ...current, camp: { ...current.camp, supportBoxes: items } }))} createItem={() => ({ title: "", body: "" })} firstLabel="Titel" secondLabel="Tekst" firstKey="title" secondKey="body" />
            <PairsEditor<CampStep> title="Inschrijfstappen" items={pages.camp.signupSteps} onChange={(items) => setPages((current) => ({ ...current, camp: { ...current.camp, signupSteps: items } }))} createItem={() => ({ title: "", text: "" })} firstLabel="Stap" secondLabel="Tekst" firstKey="title" secondKey="text" />
            <ChecklistEditor sections={pages.camp.checklistSections} onChange={(items) => setPages((current) => ({ ...current, camp: { ...current.camp, checklistSections: items } }))} />
          </section>
        )}

        {activeTab === "pages" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Overige pagina's</h2>
                <p>Activiteiten-intro, verhuur, verzekering en privacy.</p>
              </div>
            </div>

            <div class="admin-stacked-panels">
              <section class="admin-subpanel">
                <div class="admin-subpanel-head">
                  <h4>Activiteitenpagina</h4>
                  <button class="btn" type="button" onClick={() => savePage("activities", pages.activities, "Activiteitenpagina opgeslagen.")}>
                    Opslaan
                  </button>
                </div>
                <div class="admin-grid">
                  <TextField label="Slug" value={pages.activities.slug} onInput={(value) => setPages((current) => ({ ...current, activities: { ...current.activities, slug: value } }))} />
                  <TextField label="Titel" value={pages.activities.title} onInput={(value) => setPages((current) => ({ ...current, activities: { ...current.activities, title: value } }))} />
                  <TextAreaField label="Lead" value={pages.activities.lead} onInput={(value) => setPages((current) => ({ ...current, activities: { ...current.activities, lead: value } }))} />
                  <TextAreaField label="Description" value={pages.activities.description} onInput={(value) => setPages((current) => ({ ...current, activities: { ...current.activities, description: value } }))} />
                  <TextField label="Posts titel" value={pages.activities.postsTitle} onInput={(value) => setPages((current) => ({ ...current, activities: { ...current.activities, postsTitle: value } }))} />
                  <TextAreaField label="Leegstaat tekst" value={pages.activities.postsEmptyText} onInput={(value) => setPages((current) => ({ ...current, activities: { ...current.activities, postsEmptyText: value } }))} />
                </div>
                <div class="admin-subpanel">
                  <h4>Boekje PDF</h4>
                  <p class="muted-small">
                    Upload hier het nieuwste boekje. Op de publieke pagina wordt het woord "boekje" automatisch downloadbaar.
                  </p>
                  <FileField
                    label="Boekje URL"
                    value={pages.activities.bookletUrl ?? ""}
                    onInput={(value) =>
                      setPages((current) => ({
                        ...current,
                        activities: { ...current.activities, bookletUrl: value }
                      }))
                    }
                    fileName={pages.activities.bookletFileName ?? ""}
                    onFileNameInput={(value) =>
                      setPages((current) => ({
                        ...current,
                        activities: { ...current.activities, bookletFileName: value }
                      }))
                    }
                    client={supabase}
                    folder="documents"
                    accept=".pdf,application/pdf"
                  />
                </div>
                <CardsEditor title="Introkaarten" cards={pages.activities.cards} onChange={(cards) => setPages((current) => ({ ...current, activities: { ...current.activities, cards } }))} />
              </section>

              {(["rental", "insurance", "privacy"] as const).map((key) => (
                <section class="admin-subpanel" key={key}>
                  <div class="admin-subpanel-head">
                    <h4>{key === "rental" ? "Verhuur" : key === "insurance" ? "Verzekering" : "Privacy"}</h4>
                    <button class="btn" type="button" onClick={() => savePage(key, pages[key], `${pages[key].title} opgeslagen.`)}>
                      Opslaan
                    </button>
                  </div>
                  <div class="admin-grid">
                    <TextField label="Slug" value={pages[key].slug} onInput={(value) => setPages((current) => ({ ...current, [key]: { ...current[key], slug: value } }))} />
                    <TextField label="Titel" value={pages[key].title} onInput={(value) => setPages((current) => ({ ...current, [key]: { ...current[key], title: value } }))} />
                    <TextAreaField label="Lead" value={pages[key].lead} onInput={(value) => setPages((current) => ({ ...current, [key]: { ...current[key], lead: value } }))} />
                    <TextAreaField label="Description" value={pages[key].description} onInput={(value) => setPages((current) => ({ ...current, [key]: { ...current[key], description: value } }))} />
                  </div>
                  <CardsEditor title="Kaarten" cards={pages[key].cards} onChange={(cards) => setPages((current) => ({ ...current, [key]: { ...current[key], cards } }))} />
                </section>
              ))}
            </div>
          </section>
        )}

        {activeTab === "messages" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Contactberichten</h2>
                <p>Nieuwe berichten die via het contactformulier zijn verstuurd.</p>
              </div>
            </div>

            <div class="admin-messages">
              {messages.length ? (
                messages.map((message) => (
                  <article class="admin-message-card" key={message.id}>
                    <div class="admin-message-head">
                      <div>
                        <h3>{message.subject}</h3>
                        <p class="muted-small">
                          {message.name} | {message.email} | {message.category}
                        </p>
                      </div>
                      <button class="admin-remove" type="button" onClick={() => deleteMessage(message.id ?? "")}>
                        Verwijderen
                      </button>
                    </div>
                    <p>{message.message}</p>
                    <p class="muted-small">{message.createdAt ? new Date(message.createdAt).toLocaleString("nl-BE") : ""}</p>
                  </article>
                ))
              ) : (
                <div class="card empty-state">
                  <p>Nog geen contactberichten.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "team" && profile?.role === "admin" && (
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div>
                <h2>Teambeheer</h2>
                <p>Nodig leiding uit en beheer rollen.</p>
              </div>
              <button class="btn" type="button" onClick={saveProfiles}>
                Rollen opslaan
              </button>
            </div>

            <div class="admin-subpanel">
              <h4>Nieuwe leider uitnodigen</h4>
              <div class="admin-grid">
                <TextField label="Naam" value={inviteName} onInput={setInviteName} />
                <TextField label="E-mail" type="email" value={inviteEmail} onInput={setInviteEmail} />
                <label class="admin-field">
                  <span>Rol</span>
                  <select value={inviteRole} onInput={(event) => setInviteRole((event.currentTarget as HTMLSelectElement).value as Role)}>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              </div>
              <button class="btn" type="button" onClick={inviteLeader}>
                Uitnodiging versturen
              </button>
            </div>

            <div class="admin-subpanel">
              <h4>Bestaande profielen</h4>
              {profiles.map((currentProfile, index) => (
                <div class="admin-inline-grid admin-inline-grid-wide" key={currentProfile.user_id}>
                  <TextField label="Naam" value={currentProfile.full_name} onInput={(value) => setProfiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, full_name: value } : item))} />
                  <TextField label="E-mail" value={currentProfile.email} onInput={(value) => setProfiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, email: value } : item))} />
                  <label class="admin-field">
                    <span>Rol</span>
                    <select value={currentProfile.role} onInput={(event) => setProfiles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, role: (event.currentTarget as HTMLSelectElement).value as Role } : item))}>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
