import { useEffect, useState } from "preact/hooks";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { adminDefaultContent } from "@/lib/admin-default-content";
import { toPublicSiteUrl } from "@/lib/site-url";
import type {
  CampChecklistSection,
  CampOverviewItem,
  CampStep,
  ContactMessage,
  ContactSection,
  Group,
  GroupCardLink,
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
  | "finance"
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
  managedGroupSlugs: string[];
  created_at: string;
}

type FinanceType = "income" | "expense";
type FinanceStatus = "pending" | "paid" | "reimbursed" | "cancelled" | "archived";
type FinanceStatusFilter = "active" | "all" | FinanceStatus;
type FinanceViewId = "dashboard" | "groups" | "transactions" | "editor";
type FinanceGroupsViewMode = "grid" | "list";

interface FinanceTransaction {
  id?: string;
  date: string;
  amount: number;
  type: FinanceType;
  groupSlug: string;
  groupLabel: string;
  categoryKey: string;
  status: FinanceStatus;
  title: string;
  description: string;
  paymentMethod: string;
  personName: string;
  receiptUrl: string;
  receiptFileName: string;
  createdBy: string;
  updatedBy: string;
  createdAt?: string;
  updatedAt?: string;
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
const financeStatusOptions: Array<{ value: FinanceStatus; label: string }> = [
  { value: "pending", label: "Openstaand" },
  { value: "paid", label: "Betaald" },
  { value: "reimbursed", label: "Terugbetaald" },
  { value: "cancelled", label: "Geannuleerd" },
  { value: "archived", label: "Gearchiveerd" }
];
const financeTypeOptions: Array<{ value: FinanceType; label: string }> = [
  { value: "income", label: "Inkomst" },
  { value: "expense", label: "Uitgave" }
];
const financeViewTabs: Array<{ id: FinanceViewId; label: string; hint: string }> = [
  { id: "dashboard", label: "Dashboard", hint: "Cijfers en trends" },
  { id: "groups", label: "Groepen", hint: "Ruimtes per groep" },
  { id: "transactions", label: "Transacties", hint: "Lijst en filters" },
  { id: "editor", label: "Editor", hint: "Nieuwe of open fiche" }
];
const financePaymentMethodOptions = [
  "Bankoverschrijving",
  "Cash",
  "Bancontact",
  "Kaart",
  "Factuur",
  "Andere"
];
const financeIncomeCategories = [
  { key: "membership", label: "Lidgeld" },
  { key: "camp", label: "Kamp" },
  { key: "event", label: "Activiteit" },
  { key: "sales", label: "Verkoop" },
  { key: "donation", label: "Gift" },
  { key: "subsidy", label: "Subsidie" },
  { key: "other-income", label: "Andere" }
];
const financeExpenseCategories = [
  { key: "activities", label: "Activiteiten" },
  { key: "camp-expense", label: "Kamp" },
  { key: "material", label: "Materiaal" },
  { key: "food-drinks", label: "Eten en drinken" },
  { key: "transport", label: "Vervoer" },
  { key: "reimbursement", label: "Terugbetaling" },
  { key: "maintenance", label: "Onderhoud" },
  { key: "administration", label: "Administratie" },
  { key: "other-expense", label: "Andere" }
];
const financeSettledStatuses = new Set<FinanceStatus>(["paid", "reimbursed"]);
const financeCurrencyFormatter = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

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

function getCurrentMonthInputValue() {
  return getTodayDateInputValue().slice(0, 7);
}

function formatCurrency(value: number) {
  return financeCurrencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function getFinanceCategoryOptions(type: FinanceType) {
  return type === "income" ? financeIncomeCategories : financeExpenseCategories;
}

function getFinanceCategoryLabel(key: string) {
  return (
    [...financeIncomeCategories, ...financeExpenseCategories].find((item) => item.key === key)?.label ??
    "Zonder categorie"
  );
}

function getFinanceStatusLabel(status: FinanceStatus) {
  return financeStatusOptions.find((item) => item.value === status)?.label ?? status;
}

function getFinanceTypeLabel(type: FinanceType) {
  return financeTypeOptions.find((item) => item.value === type)?.label ?? type;
}

function getFinanceGroupLabel(groupSlug: string, groups: Group[]) {
  if (!groupSlug) {
    return "Algemeen";
  }

  return groups.find((group) => group.slug === groupSlug)?.name ?? "Onbekende groep";
}

function canAccessFinance(profile: Profile | null | undefined) {
  return Boolean(profile && (profile.role === "admin" || profile.managedGroupSlugs.length > 0));
}

function canManageFinanceGroup(profile: Profile | null | undefined, groupSlug: string) {
  if (!profile) {
    return false;
  }

  if (profile.role === "admin") {
    return true;
  }

  return Boolean(groupSlug && profile.managedGroupSlugs.includes(groupSlug));
}

function getFinanceGroupTheme(themeKey: string) {
  const themeMap: Record<string, { accent: string; soft: string; glow: string }> = {
    ribbels: { accent: "#ec4899", soft: "#fdf2f8", glow: "rgba(236, 72, 153, .18)" },
    speelclub: { accent: "#8b5cf6", soft: "#f5f3ff", glow: "rgba(139, 92, 246, .18)" },
    rakwi: { accent: "#f97316", soft: "#fff7ed", glow: "rgba(249, 115, 22, .18)" },
    tito: { accent: "#10b981", soft: "#ecfdf5", glow: "rgba(16, 185, 129, .18)" },
    keti: { accent: "#0ea5e9", soft: "#eff6ff", glow: "rgba(14, 165, 233, .18)" },
    aspi: { accent: "#eab308", soft: "#fefce8", glow: "rgba(234, 179, 8, .2)" }
  };

  return themeMap[themeKey] ?? {
    accent: "#1d4ed8",
    soft: "#eff6ff",
    glow: "rgba(29, 78, 216, .18)"
  };
}

function sortFinanceTransactions(transactions: FinanceTransaction[]) {
  return [...transactions].sort((left, right) => {
    const leftDate = parseDateValue(left.date)?.getTime() ?? 0;
    const rightDate = parseDateValue(right.date)?.getTime() ?? 0;

    if (rightDate !== leftDate) {
      return rightDate - leftDate;
    }

    const leftUpdated = parseDateValue(left.updatedAt ?? left.createdAt)?.getTime() ?? 0;
    const rightUpdated = parseDateValue(right.updatedAt ?? right.createdAt)?.getTime() ?? 0;

    return rightUpdated - leftUpdated;
  });
}

function createEmptyFinanceTransaction(groups: Group[]): FinanceTransaction {
  return {
    id: tempId("finance"),
    date: getTodayDateInputValue(),
    amount: 0,
    type: "expense",
    groupSlug: "",
    groupLabel: getFinanceGroupLabel("", groups),
    categoryKey: financeExpenseCategories[0]?.key ?? "activities",
    status: "paid",
    title: "",
    description: "",
    paymentMethod: financePaymentMethodOptions[0] ?? "",
    personName: "",
    receiptUrl: "",
    receiptFileName: "",
    createdBy: "",
    updatedBy: ""
  };
}

function mapFinanceTransaction(row: Record<string, unknown>): FinanceTransaction {
  return {
    id: String(row.id ?? ""),
    date: formatDateInput(String(row.transaction_date ?? "")) || getTodayDateInputValue(),
    amount: Number(row.amount ?? 0),
    type: row.type === "income" ? "income" : "expense",
    groupSlug: String(row.group_slug ?? ""),
    groupLabel: String(row.group_label ?? "Algemeen"),
    categoryKey: String(row.category_key ?? ""),
    status: (row.status as FinanceStatus) ?? "paid",
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    paymentMethod: String(row.payment_method ?? ""),
    personName: String(row.person_name ?? ""),
    receiptUrl: String(row.receipt_url ?? ""),
    receiptFileName: String(row.receipt_file_name ?? ""),
    createdBy: String(row.created_by ?? ""),
    updatedBy: String(row.updated_by ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function normalizeFinanceTransaction(
  transaction: FinanceTransaction,
  groups: Group[],
  userId: string
): FinanceTransaction {
  const categoryOptions = getFinanceCategoryOptions(transaction.type);
  const categoryKey = categoryOptions.some((item) => item.key === transaction.categoryKey)
    ? transaction.categoryKey
    : (categoryOptions[0]?.key ?? "");
  const amount = Number.parseFloat(String(transaction.amount));
  const hasPersistentId = Boolean(transaction.id && !transaction.id.startsWith("temp-"));

  return {
    ...transaction,
    id: transaction.id || tempId("finance"),
    date: formatDateInput(transaction.date) || getTodayDateInputValue(),
    amount: Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0,
    groupSlug: transaction.groupSlug,
    groupLabel: getFinanceGroupLabel(transaction.groupSlug, groups),
    categoryKey,
    status: transaction.status,
    title: transaction.title.trim(),
    description: transaction.description.trim(),
    paymentMethod: transaction.paymentMethod.trim(),
    personName: transaction.personName.trim(),
    receiptUrl: transaction.receiptUrl.trim(),
    receiptFileName: transaction.receiptFileName.trim(),
    createdBy: hasPersistentId ? transaction.createdBy : userId,
    updatedBy: userId
  };
}

function toFinanceTransactionRow(transaction: FinanceTransaction, userId: string) {
  const hasPersistentId = Boolean(transaction.id && !transaction.id.startsWith("temp-"));
  const row: Record<string, unknown> = {
    transaction_date: transaction.date,
    amount: transaction.amount,
    type: transaction.type,
    group_slug: transaction.groupSlug,
    group_label: transaction.groupLabel || "Algemeen",
    category_key: transaction.categoryKey,
    status: transaction.status,
    title: transaction.title,
    description: transaction.description,
    payment_method: transaction.paymentMethod,
    person_name: transaction.personName,
    receipt_url: transaction.receiptUrl,
    receipt_file_name: transaction.receiptFileName,
    created_by: transaction.createdBy || userId,
    updated_by: userId
  };

  if (hasPersistentId) {
    row.id = transaction.id;
  }

  return row;
}

function validateFinanceTransaction(transaction: FinanceTransaction) {
  if (!transaction.title.trim()) {
    return "Geef deze transactie een duidelijke titel.";
  }

  if (!transaction.date) {
    return "Kies een datum voor deze transactie.";
  }

  if (!transaction.categoryKey) {
    return "Kies een categorie.";
  }

  if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) {
    return "Vul een bedrag groter dan 0 in.";
  }

  return null;
}

function isFinanceVisibleForSummary(transaction: FinanceTransaction) {
  return transaction.status !== "archived" && transaction.status !== "cancelled";
}

function isFinanceSettled(transaction: FinanceTransaction) {
  return financeSettledStatuses.has(transaction.status);
}

function isFinanceInMonth(transaction: FinanceTransaction, monthValue: string) {
  if (!monthValue) {
    return true;
  }

  return transaction.date.startsWith(monthValue);
}

function shiftMonthKey(monthKey: string, delta: number) {
  const [yearPart, monthPart] = monthKey.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);

  if (!year || !month) {
    return getCurrentMonthInputValue();
  }

  const shifted = new Date(year, month - 1 + delta, 1);
  const nextYear = shifted.getFullYear();
  const nextMonth = String(shifted.getMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

function formatFinanceMonthLabel(monthKey: string) {
  const date = parseDateValue(`${monthKey}-01`);

  if (!date) {
    return monthKey;
  }

  return date.toLocaleDateString("nl-BE", {
    month: "short"
  });
}

function getRecentFinanceMonthKeys(count: number) {
  const currentMonth = getCurrentMonthInputValue();
  return Array.from({ length: count }, (_, index) => shiftMonthKey(currentMonth, index - (count - 1)));
}

function getFinanceTrendData(transactions: FinanceTransaction[], count = 6) {
  const monthKeys = getRecentFinanceMonthKeys(count);

  return monthKeys.map((monthKey) => {
    const monthTransactions = transactions.filter((transaction) => isFinanceInMonth(transaction, monthKey));
    const settledTransactions = monthTransactions.filter(isFinanceSettled);
    const income = settledTransactions
      .filter((transaction) => transaction.type === "income")
      .reduce((total, transaction) => total + transaction.amount, 0);
    const expenses = settledTransactions
      .filter((transaction) => transaction.type === "expense")
      .reduce((total, transaction) => total + transaction.amount, 0);
    const pending = monthTransactions.filter((transaction) => transaction.status === "pending").length;

    return {
      key: monthKey,
      label: formatFinanceMonthLabel(monthKey),
      income,
      expenses,
      pending,
      balance: income - expenses
    };
  });
}

function getFinanceCategoryBreakdown(
  transactions: FinanceTransaction[],
  type: FinanceType
) {
  const bucket = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.type !== type || !isFinanceSettled(transaction)) {
      continue;
    }

    const currentAmount = bucket.get(transaction.categoryKey) ?? 0;
    bucket.set(transaction.categoryKey, currentAmount + transaction.amount);
  }

  return [...bucket.entries()]
    .map(([key, amount]) => ({
      key,
      label: getFinanceCategoryLabel(key),
      amount
    }))
    .sort((left, right) => right.amount - left.amount);
}

function getFinanceDonutStyle(items: Array<{ amount: number }>, colors: string[]) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  if (!total) {
    return "conic-gradient(#e2e8f0 0deg 360deg)";
  }

  let angle = 0;
  const stops = items.map((item, index) => {
    const slice = (item.amount / total) * 360;
    const start = angle;
    angle += slice;
    const end = index === items.length - 1 ? 360 : angle;
    const color = colors[index % colors.length];
    return `${color} ${start}deg ${end}deg`;
  });

  return `conic-gradient(${stops.join(", ")})`;
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

function orderGroupsForContact(groups: Group[], groupCards: GroupCardLink[]) {
  const orderLookup = new Map(groupCards.map((item, index) => [item.groupSlug, index]));

  return [...groups].sort((left, right) => {
    const leftOrder = orderLookup.get(left.slug);
    const rightOrder = orderLookup.get(right.slug);

    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }

    if (leftOrder !== undefined) {
      return -1;
    }

    if (rightOrder !== undefined) {
      return 1;
    }

    return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "nl");
  });
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
    managedGroupSlugs: Array.isArray(row.managed_group_slugs)
      ? (row.managed_group_slugs as string[]).filter((item) => typeof item === "string")
      : [],
    created_at: String(row.created_at ?? "")
  };
}

function parseDateValue(value: string | null | undefined) {
  const input = value?.trim();

  if (!input) {
    return null;
  }

  const dateOnlyMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatAdminDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
) {
  const date = parseDateValue(value);

  if (!date) {
    return "";
  }

  return date.toLocaleString("nl-BE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...options
  });
}

function formatRelativeDate(value: string | null | undefined) {
  const date = parseDateValue(value);

  if (!date) {
    return "";
  }

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const isPast = diffMs <= 0;

  if (absMs < 60_000) {
    return isPast ? "zonet" : "binnenkort";
  }

  if (absMs < 3_600_000) {
    const minutes = Math.max(1, Math.round(absMs / 60_000));
    return isPast ? `${minutes} min geleden` : `binnen ${minutes} min`;
  }

  if (absMs < 86_400_000) {
    const hours = Math.max(1, Math.round(absMs / 3_600_000));
    return isPast ? `${hours} u geleden` : `binnen ${hours} u`;
  }

  if (absMs < 172_800_000) {
    return isPast ? "gisteren" : "morgen";
  }

  if (absMs < 604_800_000) {
    const days = Math.max(1, Math.round(absMs / 86_400_000));
    return isPast ? `${days} d geleden` : `binnen ${days} d`;
  }

  return formatAdminDate(value, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: undefined,
    minute: undefined
  });
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

export default function AdminApp(props: { adminAuthActionPath: string }) {
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
  const [financeTransactions, setFinanceTransactions] = useState<FinanceTransaction[]>([]);
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
  const [removingProfileId, setRemovingProfileId] = useState<string | null>(null);
  const [financeDraft, setFinanceDraft] = useState<FinanceTransaction | null>(null);
  const [financeEditingId, setFinanceEditingId] = useState<string | null>(null);
  const [financeSaving, setFinanceSaving] = useState(false);
  const [financeDirty, setFinanceDirty] = useState(false);
  const [financeSchemaError, setFinanceSchemaError] = useState<string | null>(null);
  const [financeView, setFinanceView] = useState<FinanceViewId>("dashboard");
  const [financeMonthFilter, setFinanceMonthFilter] = useState(() => getCurrentMonthInputValue());
  const [financeGroupFilter, setFinanceGroupFilter] = useState("all");
  const [financeTypeFilter, setFinanceTypeFilter] = useState<"all" | FinanceType>("all");
  const [financeStatusFilter, setFinanceStatusFilter] = useState<FinanceStatusFilter>("active");
  const [financeCategoryFilter, setFinanceCategoryFilter] = useState("all");
  const [financeSearch, setFinanceSearch] = useState("");
  const [financeSelectedGroupSlug, setFinanceSelectedGroupSlug] = useState("");
  const [financeGroupsView, setFinanceGroupsView] = useState<FinanceGroupsViewMode>("grid");
  const [financeSelectedTransactionId, setFinanceSelectedTransactionId] = useState<string | null>(
    null
  );

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

      if (canAccessFinance(currentProfile)) {
        const financeResult = await supabase
          .from("finance_transactions")
          .select("*")
          .order("transaction_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (financeResult.error) {
          console.error("Finance-data kon niet worden geladen.", financeResult.error);
          setFinanceTransactions([]);
          setFinanceSchemaError(
            "De finance-module is nog niet klaar in Supabase. Voer eerst de nieuwste `supabase/schema.sql` uit."
          );
        } else {
          setFinanceTransactions(
            sortFinanceTransactions(
              (financeResult.data ?? []).map((row) =>
                mapFinanceTransaction(row as Record<string, unknown>)
              )
            )
          );
          setFinanceSchemaError(null);
        }
      } else {
        setFinanceTransactions([]);
        setFinanceSchemaError(null);
      }

      setFinanceDraft(null);
      setFinanceEditingId(null);
      setFinanceDirty(false);
      setFinanceSelectedGroupSlug("");
      setFinanceView("dashboard");
      setFinanceSelectedTransactionId(null);
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
      setFinanceTransactions([]);
      setFinanceDraft(null);
      setFinanceEditingId(null);
      setFinanceDirty(false);
      setFinanceSchemaError(null);
      setFinanceSelectedGroupSlug("");
      setFinanceView("dashboard");
      setFinanceSelectedTransactionId(null);
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
  const orderedContactGroups = orderGroupsForContact(groups, pages.contact.groupCards);

  if (canAccessFinance(profile)) {
    availableTabs.splice(1, 0, { id: "finance", label: "Financiën" });
  }

  if (profile?.role === "admin") {
    availableTabs.push({ id: "team", label: "Team" });
  }

  const overviewRecentMessages = [...messages]
    .sort((left, right) => {
      const leftTime = parseDateValue(left.createdAt)?.getTime() ?? 0;
      const rightTime = parseDateValue(right.createdAt)?.getTime() ?? 0;
      return rightTime - leftTime;
    })
    .slice(0, 8);
  const financeAccessibleGroups =
    profile?.role === "admin"
      ? groups
      : groups.filter((group) => profile?.managedGroupSlugs.includes(group.slug));
  const financeGroupCards = [
    ...(profile?.role === "admin"
      ? [{ slug: "", name: "Algemeen", themeKey: "general", ageRange: "", schoolYears: "" }]
      : []),
    ...financeAccessibleGroups.map((group) => ({
      slug: group.slug,
      name: group.name,
      themeKey: group.themeKey,
      ageRange: group.ageRange,
      schoolYears: group.schoolYears
    }))
  ];
  const financeCategoryOptions = [...financeIncomeCategories, ...financeExpenseCategories];
  const financeVisibleTransactions = financeTransactions.filter(isFinanceVisibleForSummary);
  const financeSettledTransactions = financeVisibleTransactions.filter(isFinanceSettled);
  const financeSelectedMonthTransactions = financeVisibleTransactions.filter((transaction) =>
    isFinanceInMonth(transaction, financeMonthFilter)
  );
  const financeSelectedMonthSettledTransactions = financeSelectedMonthTransactions.filter(
    isFinanceSettled
  );
  const financePendingTransactions = financeVisibleTransactions.filter(
    (transaction) => transaction.status === "pending"
  );
  const financeCurrentBalance = financeSettledTransactions.reduce(
    (total, transaction) =>
      total + (transaction.type === "income" ? transaction.amount : -transaction.amount),
    0
  );
  const financeMonthIncome = financeSelectedMonthSettledTransactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financeMonthExpenses = financeSelectedMonthSettledTransactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financePendingExpenseTotal = financePendingTransactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financePendingIncomeTotal = financePendingTransactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financeSearchNeedle = financeSearch.trim().toLowerCase();
  const filteredFinanceTransactions = sortFinanceTransactions(
    financeTransactions.filter((transaction) => {
      if (financeMonthFilter && !isFinanceInMonth(transaction, financeMonthFilter)) {
        return false;
      }

      if (financeGroupFilter !== "all" && transaction.groupSlug !== financeGroupFilter) {
        return false;
      }

      if (financeTypeFilter !== "all" && transaction.type !== financeTypeFilter) {
        return false;
      }

      if (
        financeStatusFilter === "active" &&
        (transaction.status === "archived" || transaction.status === "cancelled")
      ) {
        return false;
      }

      if (financeStatusFilter !== "all" && financeStatusFilter !== "active") {
        if (transaction.status !== financeStatusFilter) {
          return false;
        }
      }

      if (financeCategoryFilter !== "all" && transaction.categoryKey !== financeCategoryFilter) {
        return false;
      }

      if (!financeSearchNeedle) {
        return true;
      }

      const haystack = [
        transaction.title,
        transaction.description,
        transaction.personName,
        transaction.groupLabel,
        getFinanceCategoryLabel(transaction.categoryKey)
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(financeSearchNeedle);
    })
  );
  const financeGroupSummaries = financeGroupCards
    .map((group) => {
      const groupTransactions = financeSelectedMonthTransactions.filter(
        (transaction) => transaction.groupSlug === group.slug
      );
      const settledGroupTransactions = groupTransactions.filter(isFinanceSettled);
      const income = settledGroupTransactions
        .filter((transaction) => transaction.type === "income")
        .reduce((total, transaction) => total + transaction.amount, 0);
      const expenses = settledGroupTransactions
        .filter((transaction) => transaction.type === "expense")
        .reduce((total, transaction) => total + transaction.amount, 0);
      const pending = groupTransactions
        .filter((transaction) => transaction.status === "pending")
        .reduce((total, transaction) => total + transaction.amount, 0);

      return {
        slug: group.slug,
        name: group.name,
        income,
        expenses,
        pending,
        balance: income - expenses,
        count: groupTransactions.length
      };
    })
    .filter((group) => group.count > 0)
    .sort((left, right) => {
      if (right.pending !== left.pending) {
        return right.pending - left.pending;
      }

      return Math.abs(right.balance) - Math.abs(left.balance);
    });
  const financeTrendData = getFinanceTrendData(financeVisibleTransactions, 6);
  const financeTrendPeak = Math.max(
    1,
    ...financeTrendData.flatMap((month) => [month.income, month.expenses, Math.abs(month.balance)])
  );
  const financeExpenseBreakdown = getFinanceCategoryBreakdown(
    financeSelectedMonthTransactions,
    "expense"
  ).slice(0, 5);
  const financeIncomeBreakdown = getFinanceCategoryBreakdown(
    financeSelectedMonthTransactions,
    "income"
  ).slice(0, 5);
  const financeExpenseBreakdownTotal = financeExpenseBreakdown.reduce(
    (total, item) => total + item.amount,
    0
  );
  const financeIncomeBreakdownTotal = financeIncomeBreakdown.reduce(
    (total, item) => total + item.amount,
    0
  );
  const financeExpenseDonutStyle = getFinanceDonutStyle(financeExpenseBreakdown, [
    "#f97316",
    "#fb7185",
    "#f59e0b",
    "#ef4444",
    "#fbbf24"
  ]);
  const financeIncomeDonutStyle = getFinanceDonutStyle(financeIncomeBreakdown, [
    "#10b981",
    "#22c55e",
    "#14b8a6",
    "#2dd4bf",
    "#84cc16"
  ]);
  const financeLargestExpense = financeExpenseBreakdown[0] ?? null;
  const financeLargestIncome = financeIncomeBreakdown[0] ?? null;
  const financeNetMonthBalance = financeMonthIncome - financeMonthExpenses;
  const financeSelectedMonthTransactionCount = financeSelectedMonthTransactions.length;
  const financeWorkspaceGroup =
    financeGroupCards.find((group) => group.slug === financeSelectedGroupSlug) ??
    financeGroupCards[0] ??
    null;
  const financeWorkspaceTheme = getFinanceGroupTheme(financeWorkspaceGroup?.themeKey ?? "general");
  const financeWorkspaceTransactions = financeTransactions.filter(
    (transaction) => transaction.groupSlug === (financeWorkspaceGroup?.slug ?? "")
  );
  const financeWorkspaceMonthTransactions = financeWorkspaceTransactions.filter((transaction) =>
    isFinanceInMonth(transaction, financeMonthFilter)
  );
  const financeWorkspaceSettledTransactions = financeWorkspaceMonthTransactions.filter(
    isFinanceSettled
  );
  const financeWorkspaceIncome = financeWorkspaceSettledTransactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financeWorkspaceExpenses = financeWorkspaceSettledTransactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financeWorkspacePending = financeWorkspaceMonthTransactions
    .filter((transaction) => transaction.status === "pending")
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financeWorkspaceRecentTransactions = sortFinanceTransactions(financeWorkspaceTransactions).slice(
    0,
    5
  );
  const financeDraftCategoryOptions = financeDraft
    ? getFinanceCategoryOptions(financeDraft.type)
    : financeExpenseCategories;
  const financeMonthLabel = financeMonthFilter
    ? parseDateValue(`${financeMonthFilter}-01`)?.toLocaleDateString("nl-BE", {
        month: "long",
        year: "numeric"
      }) ?? "de gekozen maand"
    : "alle maanden";
  const financeActiveView =
    financeViewTabs.find((tab) => tab.id === financeView) ?? financeViewTabs[0];
  const financeFilteredPendingCount = filteredFinanceTransactions.filter(
    (transaction) => transaction.status === "pending"
  ).length;
  const financeFilteredIncomeTotal = filteredFinanceTransactions
    .filter((transaction) => transaction.type === "income" && isFinanceSettled(transaction))
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financeFilteredExpenseTotal = filteredFinanceTransactions
    .filter((transaction) => transaction.type === "expense" && isFinanceSettled(transaction))
    .reduce((total, transaction) => total + transaction.amount, 0);
  const financeSelectedFilterGroupLabel =
    financeGroupFilter === "all"
      ? "Alle groepen"
      : getFinanceGroupLabel(financeGroupFilter, groups);
  const financeSelectedTransaction =
    financeTransactions.find((transaction) => transaction.id === financeSelectedTransactionId) ??
    null;
  const financeSelectedTransactionProfileName = financeSelectedTransaction
    ? profiles.find((item) => item.user_id === financeSelectedTransaction.createdBy)?.full_name ||
      profiles.find((item) => item.user_id === financeSelectedTransaction.createdBy)?.email ||
      "Onbekende gebruiker"
    : "";
  const financeCanResetFilters =
    financeSearch.trim().length > 0 ||
    financeTypeFilter !== "all" ||
    financeStatusFilter !== "active" ||
    financeCategoryFilter !== "all" ||
    financeGroupFilter !== "all" ||
    financeMonthFilter !== getCurrentMonthInputValue();
  const financeRecentTableTransactions = sortFinanceTransactions(financeSelectedMonthTransactions).slice(
    0,
    6
  );
  const financeAttentionGroups = financeGroupSummaries
    .filter((group) => group.pending > 0 || group.balance < 0)
    .slice(0, 4);

  useEffect(() => {
    if (!canAccessFinance(profile)) {
      return;
    }

    const allowedSlugs = financeGroupCards.map((group) => group.slug);
    if (!allowedSlugs.length) {
      return;
    }

    if (!allowedSlugs.includes(financeSelectedGroupSlug)) {
      setFinanceSelectedGroupSlug(allowedSlugs[0] ?? "");
    }

    if (
      profile?.role !== "admin" &&
      financeGroupFilter !== "all" &&
      !allowedSlugs.includes(financeGroupFilter)
    ) {
      setFinanceGroupFilter(allowedSlugs[0] ?? "");
    }

    if (profile?.role !== "admin" && financeGroupFilter === "all") {
      setFinanceGroupFilter(allowedSlugs[0] ?? "");
    }
  }, [profile, financeGroupCards, financeSelectedGroupSlug, financeGroupFilter]);

  useEffect(() => {
    if (!financeSelectedTransactionId) {
      return;
    }

    if (!financeTransactions.some((transaction) => transaction.id === financeSelectedTransactionId)) {
      setFinanceSelectedTransactionId(null);
    }
  }, [financeTransactions, financeSelectedTransactionId]);

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
      redirectTo: toPublicSiteUrl(props.adminAuthActionPath)
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
    setFinanceTransactions([]);
    setFinanceDraft(null);
    setFinanceEditingId(null);
    setFinanceDirty(false);
    setFinanceSchemaError(null);
    setFinanceSelectedGroupSlug("");
    setFinanceView("dashboard");
    setFinanceSelectedTransactionId(null);
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

    const groupsOnContactPage = orderedContactGroups.filter(
      (group) => group.id && !group.id.startsWith("temp-")
    );

    if (groupsOnContactPage.length) {
      const leaderUpdates = await Promise.all(
        groupsOnContactPage.map((group) =>
          supabase
            .from("groups")
            .update({ leaders: group.leaders })
            .eq("id", group.id as string)
        )
      );
      const leaderUpdateError = leaderUpdates.find((result) => result.error)?.error;

      if (leaderUpdateError) {
        setNotice({ type: "error", message: leaderUpdateError.message });
        return;
      }
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

    const refreshed = await loadDashboard();
    if (refreshed) {
      setNotice({ type: "success", message: "Contactgegevens en groepsleiding opgeslagen." });
    }
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

  function startFinanceDraft(source?: FinanceTransaction) {
    const defaultGroupSlug =
      profile?.role === "admin"
        ? financeSelectedGroupSlug
        : financeAccessibleGroups[0]?.slug ?? "";
    const nextDraft = source
      ? { ...source }
      : {
          ...createEmptyFinanceTransaction(groups),
          groupSlug: defaultGroupSlug,
          groupLabel: getFinanceGroupLabel(defaultGroupSlug, groups)
        };

    setFinanceEditingId(source?.id ?? null);
    setFinanceDraft(nextDraft);
    setFinanceView("editor");
    setNotice(null);
  }

  function updateFinanceDraft(updater: (draft: FinanceTransaction) => FinanceTransaction) {
    setFinanceDraft((current) => (current ? updater(current) : current));
  }

  function cancelFinanceDraft() {
    setFinanceDraft(null);
    setFinanceEditingId(null);
    setFinanceView("transactions");
  }

  function saveFinanceDraftToList() {
    if (!financeDraft || !session || !profile) {
      return;
    }

    const normalizedDraft = normalizeFinanceTransaction(financeDraft, groups, session.user.id);
    if (!canManageFinanceGroup(profile, normalizedDraft.groupSlug)) {
      setNotice({
        type: "error",
        message: "Je kunt alleen transacties opslaan voor je eigen groep(en)."
      });
      return;
    }

    const validationError = validateFinanceTransaction(normalizedDraft);

    if (validationError) {
      setNotice({ type: "error", message: validationError });
      return;
    }

    setFinanceTransactions((current) => {
      const withoutCurrent = financeEditingId
        ? current.filter((item) => item.id !== financeEditingId)
        : current.filter((item) => item.id !== normalizedDraft.id);

      return sortFinanceTransactions([normalizedDraft, ...withoutCurrent]);
    });
    setFinanceDirty(true);
    setFinanceDraft(null);
    setFinanceEditingId(null);
    setFinanceView("transactions");
    setNotice({
      type: "success",
      message: financeEditingId ? "Finance-item bijgewerkt in de lijst." : "Finance-item toegevoegd aan de lijst."
    });
  }

  function duplicateFinanceTransaction(transaction: FinanceTransaction) {
    startFinanceDraft({
      ...transaction,
      id: tempId("finance"),
      title: transaction.title ? `${transaction.title} (kopie)` : "",
      createdAt: "",
      updatedAt: "",
      createdBy: "",
      updatedBy: ""
    });
  }

  function updateFinanceTransactionStatus(id: string, status: FinanceStatus) {
    setFinanceTransactions((current) =>
      sortFinanceTransactions(
        current.map((item) => (item.id === id ? { ...item, status } : item))
      )
    );
    setFinanceDirty(true);
    setNotice({
      type: "success",
      message:
        status === "paid"
          ? "Transactie gemarkeerd als betaald."
          : status === "reimbursed"
            ? "Transactie gemarkeerd als terugbetaald."
            : "Transactie bijgewerkt."
    });
  }

  function resetFinanceFilters() {
    setFinanceMonthFilter(getCurrentMonthInputValue());
    setFinanceGroupFilter(profile?.role === "admin" ? "all" : financeAccessibleGroups[0]?.slug ?? "all");
    setFinanceTypeFilter("all");
    setFinanceStatusFilter("active");
    setFinanceCategoryFilter("all");
    setFinanceSearch("");
  }

  function openFinanceTransactionDetail(transaction: FinanceTransaction) {
    setFinanceSelectedTransactionId(transaction.id ?? null);
  }

  function archiveFinanceTransaction(transaction: FinanceTransaction) {
    if (!transaction.id) {
      return;
    }

    if (transaction.id.startsWith("temp-")) {
      setFinanceTransactions((current) => current.filter((item) => item.id !== transaction.id));
      setFinanceDirty(true);
      setNotice({ type: "success", message: "Niet-opgeslagen transactie verwijderd uit de lijst." });
      return;
    }

    if (!confirm(`"${transaction.title}" archiveren?`)) {
      return;
    }

    setFinanceTransactions((current) =>
      sortFinanceTransactions(
        current.map((item) =>
          item.id === transaction.id ? { ...item, status: "archived" as FinanceStatus } : item
        )
      )
    );
    setFinanceDirty(true);
    setNotice({ type: "success", message: "Transactie gearchiveerd. Vergeet niet op te slaan." });
  }

  async function saveFinanceTransactions() {
    if (!supabase || !session || !canAccessFinance(profile) || financeSaving) {
      return;
    }

    if (financeSchemaError) {
      setNotice({
        type: "error",
        message: "Voer eerst de nieuwste `supabase/schema.sql` uit voor je Financiën opslaat."
      });
      return;
    }

    if (financeDraft) {
      setNotice({
        type: "error",
        message: "Werk eerst de openstaande finance-fiche af of klik op annuleren."
      });
      return;
    }

    if (!financeDirty) {
      setNotice({ type: "success", message: "Er zijn geen finance-wijzigingen om op te slaan." });
      return;
    }

    const normalizedTransactions = financeTransactions.map((transaction) =>
      normalizeFinanceTransaction(transaction, groups, session.user.id)
    );
    const restrictedTransaction = normalizedTransactions.find(
      (transaction) => !canManageFinanceGroup(profile, transaction.groupSlug)
    );

    if (restrictedTransaction) {
      setNotice({
        type: "error",
        message: "Minstens 1 transactie hoort bij een groep die je niet mag beheren."
      });
      return;
    }

    const invalidTransaction = normalizedTransactions.find((transaction) =>
      Boolean(validateFinanceTransaction(transaction))
    );

    if (invalidTransaction) {
      setNotice({
        type: "error",
        message:
          validateFinanceTransaction(invalidTransaction) ??
          "Minstens 1 finance-transactie is nog niet volledig ingevuld."
      });
      return;
    }

    setFinanceSaving(true);
    setNotice(null);

    try {
      if (normalizedTransactions.length) {
        const { error } = await supabase
          .from("finance_transactions")
          .upsert(normalizedTransactions.map((transaction) => toFinanceTransactionRow(transaction, session.user.id)));

        if (error) {
          throw error;
        }
      }

      const refreshed = await loadDashboard();
      if (refreshed) {
        setNotice({
          type: "success",
          message: "Financiën opgeslagen. Je overzicht en transacties zijn bijgewerkt."
        });
      }
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Financiën opslaan lukte niet."
      });
    } finally {
      setFinanceSaving(false);
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
          role: current.role,
          managed_group_slugs: current.role === "admin" ? [] : current.managedGroupSlugs
        }))
      );

    setNotice({
      type: error ? "error" : "success",
      message: error ? error.message : "Teamrollen en groepsrechten bijgewerkt."
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

  async function removeTeamMember(targetProfile: Profile) {
    if (!session || profile?.role !== "admin") {
      return;
    }

    if (targetProfile.user_id === session.user.id) {
      setNotice({
        type: "error",
        message: "Je kunt jezelf niet uit het team verwijderen."
      });
      return;
    }

    const adminCount = profiles.filter((item) => item.role === "admin").length;
    if (targetProfile.role === "admin" && adminCount <= 1) {
      setNotice({
        type: "error",
        message: "Je moet minstens 1 admin overhouden in het team."
      });
      return;
    }

    const displayName = targetProfile.full_name?.trim() || targetProfile.email;
    if (!confirm(`${displayName} uit het team verwijderen? Deze persoon kan daarna niet meer inloggen.`)) {
      return;
    }

    setNotice(null);
    setRemovingProfileId(targetProfile.user_id);

    try {
      const response = await fetch("/api/admin/team/remove", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          userId: targetProfile.user_id
        })
      });

      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      setNotice({
        type: response.ok ? "success" : "error",
        message:
          result?.message ??
          (response.ok ? "Het teamlid is verwijderd." : "Verwijderen uit het team lukte niet.")
      });

      if (response.ok) {
        await loadDashboard();
      }
    } finally {
      setRemovingProfileId(null);
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
          <div class="admin-sidebar-actions">
            <a class="btn btn-light" href="/">
              Terug naar site
            </a>
            <button class="btn btn-light" type="button" onClick={signOut}>
              Uitloggen
            </button>
          </div>
        </div>
      </aside>

      <main class="admin-main">
        {notice && <div class={`admin-notice admin-notice-${notice.type}`}>{notice.message}</div>}
        {dataLoading && <div class="admin-loading-inline">Data verversen...</div>}

        {activeTab === "overview" && (
          <section class="admin-panel admin-overview-inbox">
            <div class="admin-panel-head admin-overview-inbox-head">
              <div>
                <p class="admin-kicker">Overzicht</p>
                <h2>Berichten</h2>
                <p>Hier zie je alleen de recentste berichten en wanneer ze verstuurd zijn.</p>
              </div>
              <button class="btn" type="button" onClick={() => setActiveTab("messages")}>
                Naar berichten
              </button>
            </div>

            <div class="admin-overview-message-list">
              {overviewRecentMessages.length ? (
                overviewRecentMessages.map((message) => (
                  <article
                    class="admin-overview-message-card"
                    key={message.id ?? `${message.email}-${message.createdAt ?? message.subject}`}
                  >
                    <div class="admin-overview-message-main">
                      <strong>{message.subject || message.category || "Bericht zonder onderwerp"}</strong>
                      <p>{message.name || message.email}</p>
                    </div>
                    <div class="admin-overview-message-meta">
                      <span>{formatAdminDate(message.createdAt) || "Onbekend tijdstip"}</span>
                      <small>{formatRelativeDate(message.createdAt) || "recent"}</small>
                    </div>
                  </article>
                ))
              ) : (
                <div class="admin-overview-empty">
                  Nog geen berichten ontvangen via het contactformulier.
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "finance" && canAccessFinance(profile) && (
          <section class="admin-panel admin-finance-panel">
            <div class="admin-panel-head">
              <div>
                <p class="admin-kicker">
                  {profile?.role === "admin" ? "Admin overzicht" : "Jouw groepsruimte"}
                </p>
                <h2>Financiën</h2>
                <p>
                  {profile?.role === "admin"
                    ? "Beheer geldstromen, groepen en openstaande items in een rustigere finance-workspace."
                    : "Werk alleen in je eigen groepsruimte, met duidelijkere schermen en minder afleiding."}
                </p>
              </div>
              <div class="admin-sidebar-actions">
                <button class="btn btn-light" type="button" onClick={() => startFinanceDraft()}>
                  Nieuwe transactie
                </button>
                <button class="btn" type="button" onClick={() => void saveFinanceTransactions()}>
                  {financeSaving ? "Opslaan..." : "Financiën opslaan"}
                </button>
              </div>
            </div>

            {financeSchemaError && (
              <div class="admin-finance-alert admin-finance-alert-error">
                <strong>Finance-databank nog niet actief</strong>
                <p>{financeSchemaError}</p>
              </div>
            )}

            <div class="admin-finance-commandbar">
              <div class="admin-finance-command-copy">
                <span class="admin-finance-command-label">Werkruimte</span>
                <strong>{financeActiveView.label}</strong>
                <p>
                  {financeActiveView.hint} • {financeMonthLabel} • {financeSelectedFilterGroupLabel}
                </p>
              </div>
              <div class="admin-finance-command-controls">
                <label class="admin-field admin-finance-compact-field">
                  <span>Maand</span>
                  <input
                    type="month"
                    value={financeMonthFilter}
                    onInput={(event) =>
                      setFinanceMonthFilter((event.currentTarget as HTMLInputElement).value)
                    }
                  />
                </label>
                <label class="admin-field admin-finance-compact-field">
                  <span>Werkgroep</span>
                  <select
                    value={financeWorkspaceGroup?.slug ?? ""}
                    onInput={(event) =>
                      setFinanceSelectedGroupSlug((event.currentTarget as HTMLSelectElement).value)
                    }
                  >
                    {financeGroupCards.map((group) => (
                      <option value={group.slug} key={group.slug || "general"}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="admin-field admin-finance-compact-field">
                  <span>Filtergroep</span>
                  <select
                    value={financeGroupFilter}
                    onInput={(event) =>
                      setFinanceGroupFilter((event.currentTarget as HTMLSelectElement).value)
                    }
                  >
                    <option value="all">Alle groepen</option>
                    {profile?.role === "admin" && <option value="">Algemeen</option>}
                    {financeAccessibleGroups.map((group) => (
                      <option value={group.slug} key={group.slug}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div class="admin-finance-command-actions">
                <button class="btn btn-light" type="button" onClick={resetFinanceFilters}>
                  Filters wissen
                </button>
                <button class="btn btn-light" type="button" onClick={() => setFinanceView("transactions")}>
                  Snelle lijst
                </button>
                <button class="btn" type="button" onClick={() => startFinanceDraft()}>
                  Nieuwe transactie
                </button>
              </div>
              <div class="admin-finance-chipbar">
                <span class="admin-finance-chip">{financeMonthLabel}</span>
                {financeGroupFilter !== "all" && (
                  <button
                    class="admin-finance-chip"
                    type="button"
                    onClick={() => setFinanceGroupFilter(profile?.role === "admin" ? "all" : financeAccessibleGroups[0]?.slug ?? "all")}
                  >
                    {financeSelectedFilterGroupLabel} ×
                  </button>
                )}
                {financeTypeFilter !== "all" && (
                  <button class="admin-finance-chip" type="button" onClick={() => setFinanceTypeFilter("all")}>
                    {getFinanceTypeLabel(financeTypeFilter)} ×
                  </button>
                )}
                {financeStatusFilter !== "active" && (
                  <button
                    class="admin-finance-chip"
                    type="button"
                    onClick={() => setFinanceStatusFilter("active")}
                  >
                    {financeStatusFilter === "all"
                      ? "Alle statussen"
                      : getFinanceStatusLabel(financeStatusFilter)}{" "}
                    ×
                  </button>
                )}
                {financeCategoryFilter !== "all" && (
                  <button
                    class="admin-finance-chip"
                    type="button"
                    onClick={() => setFinanceCategoryFilter("all")}
                  >
                    {getFinanceCategoryLabel(financeCategoryFilter)} ×
                  </button>
                )}
                {financeSearch.trim() && (
                  <button class="admin-finance-chip" type="button" onClick={() => setFinanceSearch("")}>
                    Zoek: {financeSearch.trim()} ×
                  </button>
                )}
                {!financeCanResetFilters && (
                  <span class="admin-finance-chip is-passive">Geen extra filters actief</span>
                )}
              </div>
            </div>

            <nav class="admin-finance-subtabs">
              {financeViewTabs.map((tab) => (
                <button
                  class={`admin-finance-subtab ${financeView === tab.id ? "is-active" : ""}`}
                  type="button"
                  key={tab.id}
                  onClick={() => setFinanceView(tab.id)}
                >
                  <strong>{tab.label}</strong>
                  <span>{tab.hint}</span>
                </button>
              ))}
            </nav>

            {financeView === "dashboard" && (
              <>
                <div class="admin-finance-hero">
                  <div class="admin-finance-hero-main">
                    <div class="admin-finance-hero-copy">
                      <span class="admin-finance-pill">Werkmaand: {financeMonthLabel}</span>
                      <h3>Een finance-dashboard dat sneller leest dan een spreadsheet.</h3>
                      <p>
                        Zie meteen hoe de maand draait, welke groepen aandacht vragen en waar geld
                        binnenkomt of buiten gaat.
                      </p>
                    </div>
                    <div class="admin-finance-hero-badges">
                      <span class="admin-finance-hero-badge is-positive">
                        {financeMonthIncome >= financeMonthExpenses ? "Gezonde maand" : "Uitgaven hoger"}
                      </span>
                      <span class="admin-finance-hero-badge is-neutral">
                        {financeSelectedMonthTransactionCount} beweging(en) deze maand
                      </span>
                      <span class="admin-finance-hero-badge is-warning">
                        {financePendingTransactions.length} openstaand
                      </span>
                    </div>
                  </div>

                  <div class="admin-finance-trend-card">
                    <div class="admin-finance-trend-head">
                      <div>
                        <span class="admin-finance-pill">Trend</span>
                        <h4>Laatste 6 maanden</h4>
                      </div>
                      <div class="admin-finance-hero-status">
                        <strong>
                          {financeDirty ? "Nog niet opgeslagen" : "Alles gesynchroniseerd"}
                        </strong>
                        <p>
                          {financeDirty
                            ? "Je hebt lokale wijzigingen. Sla op om alles definitief te maken."
                            : "Je finance-overzicht loopt gelijk met Supabase."}
                        </p>
                      </div>
                    </div>
                    <div class="admin-finance-trend-chart" aria-hidden="true">
                      {financeTrendData.map((month) => (
                        <div class="admin-finance-trend-column" key={month.key}>
                          <span class="admin-finance-trend-value">
                            {month.balance >= 0 ? "+" : "-"}
                            {formatCurrency(Math.abs(month.balance))}
                          </span>
                          <div class="admin-finance-trend-bars">
                            <span
                              class="admin-finance-trend-bar is-income"
                              style={{
                                height: `${Math.max(12, (month.income / financeTrendPeak) * 100)}%`
                              }}
                            />
                            <span
                              class="admin-finance-trend-bar is-expense"
                              style={{
                                height: `${Math.max(12, (month.expenses / financeTrendPeak) * 100)}%`
                              }}
                            />
                          </div>
                          <strong>{month.label}</strong>
                          <small>{month.pending ? `${month.pending} open` : "afgerond"}</small>
                        </div>
                      ))}
                    </div>
                    <p class="admin-finance-trend-note">
                      Groen toont inkomsten, oranje toont uitgaven. Zo zie je snel welke maanden
                      het zwaarst of sterkst waren.
                    </p>
                  </div>
                </div>

                <div class="admin-finance-metrics">
                  <article class="admin-finance-metric-card is-balance">
                    <span>Huidig saldo</span>
                    <strong>{formatCurrency(financeCurrentBalance)}</strong>
                    <p>Alle bevestigde inkomsten en uitgaven samen, zonder geannuleerde of gearchiveerde items.</p>
                  </article>
                  <article class="admin-finance-metric-card is-income">
                    <span>Inkomsten deze maand</span>
                    <strong>{formatCurrency(financeMonthIncome)}</strong>
                    <p>Bevestigde inkomsten in {financeMonthLabel}.</p>
                  </article>
                  <article class="admin-finance-metric-card is-expense">
                    <span>Uitgaven deze maand</span>
                    <strong>{formatCurrency(financeMonthExpenses)}</strong>
                    <p>Bevestigde uitgaven in {financeMonthLabel}.</p>
                  </article>
                  <article class="admin-finance-metric-card is-pending">
                    <span>Openstaand</span>
                    <strong>{formatCurrency(financePendingExpenseTotal + financePendingIncomeTotal)}</strong>
                    <p>
                      {financePendingTransactions.length} openstaande transactie(s), waarvan{" "}
                      {formatCurrency(financePendingExpenseTotal)} uitgaven en{" "}
                      {formatCurrency(financePendingIncomeTotal)} inkomsten.
                    </p>
                  </article>
                </div>

                <div class="admin-finance-storyboard">
                  <section class="admin-subpanel admin-finance-chart-card">
                    <div class="admin-subpanel-head">
                      <div>
                        <h4>Uitgavenmix</h4>
                        <p class="muted-small">Waar het geld naartoe ging in {financeMonthLabel}.</p>
                      </div>
                      <span class="admin-finance-count">{formatCurrency(financeExpenseBreakdownTotal)}</span>
                    </div>
                    <div class="admin-finance-donut-layout">
                      <div
                        class="admin-finance-donut"
                        style={{ background: financeExpenseDonutStyle }}
                        aria-hidden="true"
                      >
                        <div class="admin-finance-donut-center">
                          <strong>{financeExpenseBreakdown.length || 0}</strong>
                          <span>categorieën</span>
                        </div>
                      </div>
                      <div class="admin-finance-breakdown-list">
                        {financeExpenseBreakdown.length ? (
                          financeExpenseBreakdown.map((item, index) => (
                            <div class="admin-finance-breakdown-item" key={item.key}>
                              <span
                                class="admin-finance-breakdown-dot"
                                style={{
                                  background: ["#f97316", "#fb7185", "#f59e0b", "#ef4444", "#fbbf24"][index]
                                }}
                              />
                              <div>
                                <strong>{item.label}</strong>
                                <p>{formatCurrency(item.amount)}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div class="admin-finance-empty">
                            <strong>Nog geen uitgaven in deze maand.</strong>
                            <p>De verdeling verschijnt zodra je bevestigde uitgaven hebt.</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {financeLargestExpense && (
                      <p class="admin-finance-insight">
                        Grootste uitgavencategorie: <strong>{financeLargestExpense.label}</strong> met{" "}
                        {formatCurrency(financeLargestExpense.amount)}.
                      </p>
                    )}
                  </section>

                  <section class="admin-subpanel admin-finance-chart-card">
                    <div class="admin-subpanel-head">
                      <div>
                        <h4>Inkomstenmix</h4>
                        <p class="muted-small">Waar het geld vandaan kwam in {financeMonthLabel}.</p>
                      </div>
                      <span class="admin-finance-count">{formatCurrency(financeIncomeBreakdownTotal)}</span>
                    </div>
                    <div class="admin-finance-donut-layout">
                      <div
                        class="admin-finance-donut is-income"
                        style={{ background: financeIncomeDonutStyle }}
                        aria-hidden="true"
                      >
                        <div class="admin-finance-donut-center">
                          <strong>{financeIncomeBreakdown.length || 0}</strong>
                          <span>bronnen</span>
                        </div>
                      </div>
                      <div class="admin-finance-breakdown-list">
                        {financeIncomeBreakdown.length ? (
                          financeIncomeBreakdown.map((item, index) => (
                            <div class="admin-finance-breakdown-item" key={item.key}>
                              <span
                                class="admin-finance-breakdown-dot"
                                style={{
                                  background: ["#10b981", "#22c55e", "#14b8a6", "#2dd4bf", "#84cc16"][index]
                                }}
                              />
                              <div>
                                <strong>{item.label}</strong>
                                <p>{formatCurrency(item.amount)}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div class="admin-finance-empty">
                            <strong>Nog geen inkomsten in deze maand.</strong>
                            <p>De verdeling verschijnt zodra je bevestigde inkomsten hebt.</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <p class="admin-finance-insight">
                      Netto resultaat in {financeMonthLabel}:{" "}
                      <strong
                        class={
                          financeNetMonthBalance >= 0
                            ? "admin-finance-inline-positive"
                            : "admin-finance-inline-negative"
                        }
                      >
                        {formatCurrency(financeNetMonthBalance)}
                      </strong>
                      .
                      {financeLargestIncome
                        ? ` Sterkste bron: ${financeLargestIncome.label}.`
                        : " Voeg inkomsten toe om trends te zien."}
                    </p>
                  </section>
                </div>

                <div class="admin-finance-layout is-dashboard">
                  <div class="admin-finance-main">
                    <section class="admin-subpanel">
                      <div class="admin-subpanel-head">
                        <div>
                          <h4>Recente transacties</h4>
                          <p class="muted-small">De laatste bewegingen in {financeMonthLabel}.</p>
                        </div>
                        <button
                          class="btn btn-light"
                          type="button"
                          onClick={() => setFinanceView("transactions")}
                        >
                          Naar transacties
                        </button>
                      </div>
                      {financeRecentTableTransactions.length ? (
                        <div class="admin-finance-table-shell is-compact">
                          <div class="admin-finance-table admin-finance-table-head">
                            <span>Datum</span>
                            <span>Omschrijving</span>
                            <span>Groep</span>
                            <span>Status</span>
                            <span>Bedrag</span>
                          </div>
                          {financeRecentTableTransactions.map((transaction) => (
                            <button
                              class="admin-finance-table admin-finance-table-row"
                              type="button"
                              key={transaction.id ?? `${transaction.title}-${transaction.date}`}
                              onClick={() => {
                                openFinanceTransactionDetail(transaction);
                                setFinanceView("transactions");
                              }}
                            >
                              <span>
                                {formatAdminDate(transaction.date, {
                                  day: "numeric",
                                  month: "short",
                                  year: undefined,
                                  hour: undefined,
                                  minute: undefined
                                })}
                              </span>
                              <span>{transaction.title}</span>
                              <span>{transaction.groupLabel || getFinanceGroupLabel(transaction.groupSlug, groups)}</span>
                              <span>{getFinanceStatusLabel(transaction.status)}</span>
                              <strong
                                class={
                                  transaction.type === "income"
                                    ? "admin-finance-inline-positive"
                                    : "admin-finance-inline-negative"
                                }
                              >
                                {transaction.type === "income" ? "+" : "-"}
                                {formatCurrency(transaction.amount)}
                              </strong>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div class="admin-finance-empty">
                          <strong>Nog geen transacties in deze maand.</strong>
                          <p>Voeg een eerste transactie toe om activiteit te zien in het dashboard.</p>
                        </div>
                      )}
                    </section>
                  </div>

                  <div class="admin-finance-side">
                    <section class="admin-subpanel">
                      <div class="admin-subpanel-head">
                        <div>
                          <h4>Openstaande items</h4>
                          <p class="muted-small">Wat nog opvolging vraagt in {financeMonthLabel}.</p>
                        </div>
                        <button
                          class="btn btn-light"
                          type="button"
                          onClick={() => {
                            setFinanceStatusFilter("pending");
                            setFinanceView("transactions");
                          }}
                        >
                          Naar openstaand
                        </button>
                      </div>
                      <div class="admin-finance-focus-list">
                        {financePendingTransactions.length ? (
                          financePendingTransactions.slice(0, 4).map((transaction) => (
                            <button
                              class="admin-finance-focus-item"
                              type="button"
                              key={transaction.id ?? `${transaction.title}-${transaction.date}`}
                              onClick={() => {
                                openFinanceTransactionDetail(transaction);
                                setFinanceView("transactions");
                              }}
                            >
                              <div>
                                <strong>{transaction.title}</strong>
                                <p>
                                  {transaction.groupLabel || getFinanceGroupLabel(transaction.groupSlug, groups)} •{" "}
                                  {getFinanceCategoryLabel(transaction.categoryKey)}
                                </p>
                              </div>
                              <span>{formatCurrency(transaction.amount)}</span>
                            </button>
                          ))
                        ) : (
                          <div class="admin-finance-empty">
                            <strong>Geen openstaande items.</strong>
                            <p>Alles lijkt netjes verwerkt voor deze maand.</p>
                          </div>
                        )}
                      </div>
                    </section>

                    <section class="admin-subpanel">
                      <div class="admin-subpanel-head">
                        <div>
                          <h4>Groepen die aandacht vragen</h4>
                          <p class="muted-small">Subtiele signalen, zonder onnodige alerts.</p>
                        </div>
                        <button class="btn btn-light" type="button" onClick={() => setFinanceView("groups")}>
                          Naar groepen
                        </button>
                      </div>
                      <div class="admin-finance-group-list">
                        {financeAttentionGroups.length ? (
                          financeAttentionGroups.map((group) => (
                            <button
                              class="admin-finance-group-card admin-finance-group-card-action"
                              type="button"
                              key={group.slug || "general"}
                              onClick={() => {
                                setFinanceSelectedGroupSlug(group.slug);
                                setFinanceView("groups");
                              }}
                            >
                              <div class="admin-finance-group-head">
                                <strong>{group.name}</strong>
                                <span>{group.count} item(s)</span>
                              </div>
                              <p>Saldo: {formatCurrency(group.balance)}</p>
                              <div class="admin-finance-group-stats">
                                <span>In: {formatCurrency(group.income)}</span>
                                <span>Uit: {formatCurrency(group.expenses)}</span>
                                <span>Open: {formatCurrency(group.pending)}</span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div class="admin-finance-empty">
                            <strong>Geen groepen met dringende signalen.</strong>
                            <p>Alle zichtbare groepen lijken financieel stabiel in deze periode.</p>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </>
            )}

            {financeView === "groups" && financeGroupCards.length > 0 && (
              <div class="admin-finance-layout is-groups">
                <div class="admin-finance-main">
                  <section class="admin-subpanel admin-finance-groups-shell">
                    <div class="admin-subpanel-head">
                      <div>
                        <h4>Groepspagina's</h4>
                        <p class="muted-small">
                          Elke groep heeft een eigen ruimte met saldo, bewegingen en snelle acties.
                        </p>
                      </div>
                      <div class="admin-finance-toolbar-inline">
                        <div class="admin-finance-view-toggle" role="tablist" aria-label="Groepen weergave">
                          <button
                            class={financeGroupsView === "grid" ? "is-active" : ""}
                            type="button"
                            onClick={() => setFinanceGroupsView("grid")}
                          >
                            Grid
                          </button>
                          <button
                            class={financeGroupsView === "list" ? "is-active" : ""}
                            type="button"
                            onClick={() => setFinanceGroupsView("list")}
                          >
                            Lijst
                          </button>
                        </div>
                        <span class="admin-finance-count">{financeGroupCards.length} ruimte(s)</span>
                      </div>
                    </div>

                    <div
                      class={`admin-finance-group-tabs ${
                        financeGroupsView === "list" ? "is-list" : "is-grid"
                      }`}
                    >
                      {financeGroupCards.map((group) => {
                        const theme = getFinanceGroupTheme(group.themeKey);
                        const isActive = financeWorkspaceGroup?.slug === group.slug;
                        const groupSummary = financeGroupSummaries.find((item) => item.slug === group.slug);

                        return (
                          <button
                            class={`admin-finance-group-tab ${isActive ? "is-active" : ""}`}
                            type="button"
                            key={group.slug || "general"}
                            style={{
                              "--finance-group-accent": theme.accent,
                              "--finance-group-soft": theme.soft,
                              "--finance-group-glow": theme.glow
                            }}
                            onClick={() => {
                              setFinanceSelectedGroupSlug(group.slug);
                              setFinanceGroupFilter(group.slug);
                            }}
                          >
                            <strong>{group.name}</strong>
                            <span>
                              {group.slug
                                ? group.ageRange || group.schoolYears || "Eigen groep"
                                : "Gezamenlijke kosten"}
                            </span>
                            <small>{formatCurrency(groupSummary?.balance ?? 0)}</small>
                          </button>
                        );
                      })}
                    </div>

                    {financeWorkspaceGroup && (
                      <article
                        class="admin-finance-group-stage"
                        style={{
                          "--finance-group-accent": financeWorkspaceTheme.accent,
                          "--finance-group-soft": financeWorkspaceTheme.soft,
                          "--finance-group-glow": financeWorkspaceTheme.glow
                        }}
                      >
                        <div class="admin-finance-group-stage-copy">
                          <span class="admin-finance-group-stage-kicker">
                            {financeWorkspaceGroup.slug ? "Geselecteerde groep" : "Algemene pot"}
                          </span>
                          <h4>{financeWorkspaceGroup.name}</h4>
                          <p>
                            {financeWorkspaceGroup.slug
                              ? `Focus op ${financeWorkspaceGroup.name} in ${financeMonthLabel}.`
                              : `Hier hou je gedeelde kosten en inkomsten bij voor ${financeMonthLabel}.`}
                          </p>
                        </div>

                        <div class="admin-finance-group-stage-stats">
                          <div class="admin-finance-group-stage-card">
                            <span>Inkomsten</span>
                            <strong>{formatCurrency(financeWorkspaceIncome)}</strong>
                          </div>
                          <div class="admin-finance-group-stage-card">
                            <span>Uitgaven</span>
                            <strong>{formatCurrency(financeWorkspaceExpenses)}</strong>
                          </div>
                          <div class="admin-finance-group-stage-card">
                            <span>Openstaand</span>
                            <strong>{formatCurrency(financeWorkspacePending)}</strong>
                          </div>
                          <div class="admin-finance-group-stage-card">
                            <span>Bewegingen</span>
                            <strong>{financeWorkspaceMonthTransactions.length}</strong>
                          </div>
                        </div>

                        <div class="admin-finance-group-stage-stream">
                          <div class="admin-finance-group-stage-stream-head">
                            <strong>Laatste bewegingen</strong>
                            <div class="admin-sidebar-actions">
                              <button
                                class="btn btn-light"
                                type="button"
                                onClick={() => {
                                  setFinanceView("transactions");
                                  setFinanceGroupFilter(financeWorkspaceGroup.slug);
                                }}
                              >
                                Alle transacties
                              </button>
                              <button
                                class="btn"
                                type="button"
                                onClick={() => startFinanceDraft()}
                              >
                                Toevoegen aan {financeWorkspaceGroup.name}
                              </button>
                            </div>
                          </div>

                          {financeWorkspaceRecentTransactions.length ? (
                            <div class="admin-finance-group-stage-list">
                              {financeWorkspaceRecentTransactions.map((transaction) => (
                                <div
                                  class={`admin-finance-group-stage-item is-${transaction.type}`}
                                  key={transaction.id ?? `${transaction.title}-${transaction.date}`}
                                >
                                  <div>
                                    <strong>{transaction.title}</strong>
                                    <p>
                                      {formatAdminDate(transaction.date, {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                        hour: undefined,
                                        minute: undefined
                                      })}{" "}
                                      • {getFinanceCategoryLabel(transaction.categoryKey)}
                                    </p>
                                  </div>
                                  <span>
                                    {transaction.type === "income" ? "+" : "-"}
                                    {formatCurrency(transaction.amount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div class="admin-finance-empty">
                              <strong>Nog geen transacties voor deze groep.</strong>
                              <p>Gebruik de knop hierboven om de eerste beweging toe te voegen.</p>
                            </div>
                          )}
                        </div>
                      </article>
                    )}
                  </section>
                </div>

                <div class="admin-finance-side">
                  <section class="admin-subpanel">
                    <div class="admin-subpanel-head">
                      <div>
                        <h4>Alle groepssaldi</h4>
                        <p class="muted-small">Compact overzicht voor {financeMonthLabel}.</p>
                      </div>
                    </div>
                    <div class="admin-finance-group-list">
                      {financeGroupSummaries.length ? (
                        financeGroupSummaries.map((group) => (
                          <article class="admin-finance-group-card" key={group.slug || "general"}>
                            <div class="admin-finance-group-head">
                              <strong>{group.name}</strong>
                              <span>{group.count} item(s)</span>
                            </div>
                            <p>Saldo: {formatCurrency(group.balance)}</p>
                            <div class="admin-finance-group-stats">
                              <span>In: {formatCurrency(group.income)}</span>
                              <span>Uit: {formatCurrency(group.expenses)}</span>
                              <span>Open: {formatCurrency(group.pending)}</span>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div class="admin-finance-empty">
                          <strong>Nog geen bewegingen in {financeMonthLabel}.</strong>
                          <p>De groepskaarten vullen zich zodra er transacties zijn.</p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {financeView === "transactions" && (
              <div class="admin-finance-layout is-transactions">
                <div class="admin-finance-main">
                  <section class="admin-subpanel">
                    <div class="admin-subpanel-head">
                      <div>
                        <h4>Transacties</h4>
                        <p class="muted-small">
                          Werk met filters, snelle acties en een rustigere lijstweergave.
                        </p>
                      </div>
                      <span class="admin-finance-count">
                        {filteredFinanceTransactions.length} resultaat/resultaten
                      </span>
                    </div>

                    <div class="admin-inline-grid admin-inline-grid-wide admin-finance-filter-grid">
                      <TextField label="Zoeken" value={financeSearch} onInput={setFinanceSearch} />
                      <label class="admin-field">
                        <span>Type</span>
                        <select
                          value={financeTypeFilter}
                          onInput={(event) =>
                            setFinanceTypeFilter(
                              (event.currentTarget as HTMLSelectElement).value as
                                | "all"
                                | FinanceType
                            )
                          }
                        >
                          <option value="all">Alle types</option>
                          {financeTypeOptions.map((option) => (
                            <option value={option.value} key={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label class="admin-field">
                        <span>Status</span>
                        <select
                          value={financeStatusFilter}
                          onInput={(event) =>
                            setFinanceStatusFilter(
                              (event.currentTarget as HTMLSelectElement).value as FinanceStatusFilter
                            )
                          }
                        >
                          <option value="active">Actieve items</option>
                          <option value="all">Alles</option>
                          {financeStatusOptions.map((option) => (
                            <option value={option.value} key={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label class="admin-field">
                        <span>Categorie</span>
                        <select
                          value={financeCategoryFilter}
                          onInput={(event) =>
                            setFinanceCategoryFilter(
                              (event.currentTarget as HTMLSelectElement).value
                            )
                          }
                        >
                          <option value="all">Alle categorieën</option>
                          {financeCategoryOptions.map((option) => (
                            <option value={option.key} key={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div class="admin-finance-toolbar-pills">
                      <span class="admin-finance-toolbar-pill">
                        Inkomsten: {formatCurrency(financeFilteredIncomeTotal)}
                      </span>
                      <span class="admin-finance-toolbar-pill">
                        Uitgaven: {formatCurrency(financeFilteredExpenseTotal)}
                      </span>
                      <span class="admin-finance-toolbar-pill">
                        Openstaand: {financeFilteredPendingCount}
                      </span>
                      <span class="admin-finance-toolbar-pill">
                        Groep: {financeSelectedFilterGroupLabel}
                      </span>
                    </div>

                    <div class="admin-finance-list">
                      {filteredFinanceTransactions.length ? (
                        filteredFinanceTransactions.map((transaction) => {
                          const profileName =
                            profiles.find((item) => item.user_id === transaction.createdBy)?.full_name ||
                            profiles.find((item) => item.user_id === transaction.createdBy)?.email ||
                            "Onbekende gebruiker";

                          return (
                            <article
                              class={`admin-finance-row is-${transaction.type} is-${transaction.status} ${
                                financeSelectedTransactionId === transaction.id ? "is-selected" : ""
                              }`}
                              key={transaction.id ?? `${transaction.title}-${transaction.date}`}
                            >
                              <div class="admin-finance-row-main">
                                <div class="admin-finance-row-top">
                                  <div>
                                    <h4>{transaction.title}</h4>
                                    <p>
                                      {formatAdminDate(transaction.date, {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                        hour: undefined,
                                        minute: undefined
                                      })}{" "}
                                      | {transaction.groupLabel || getFinanceGroupLabel(transaction.groupSlug, groups)} |{" "}
                                      {getFinanceCategoryLabel(transaction.categoryKey)}
                                    </p>
                                  </div>
                                  <strong
                                    class={
                                      transaction.type === "income"
                                        ? "admin-finance-amount is-positive"
                                        : "admin-finance-amount is-negative"
                                    }
                                  >
                                    {transaction.type === "income" ? "+" : "-"}
                                    {formatCurrency(transaction.amount)}
                                  </strong>
                                </div>

                                <div class="admin-finance-tags">
                                  <span class={`admin-finance-tag is-${transaction.type}`}>
                                    {getFinanceTypeLabel(transaction.type)}
                                  </span>
                                  <span class={`admin-finance-tag is-${transaction.status}`}>
                                    {getFinanceStatusLabel(transaction.status)}
                                  </span>
                                  {transaction.paymentMethod && (
                                    <span class="admin-finance-tag">{transaction.paymentMethod}</span>
                                  )}
                                  {transaction.personName && (
                                    <span class="admin-finance-tag">{transaction.personName}</span>
                                  )}
                                </div>

                                {(transaction.description || transaction.receiptUrl) && (
                                  <div class="admin-finance-meta">
                                    {transaction.description && <p>{transaction.description}</p>}
                                    {transaction.receiptUrl && (
                                      <a href={transaction.receiptUrl} target="_blank" rel="noreferrer">
                                        {transaction.receiptFileName || "Bewijsstuk openen"}
                                      </a>
                                    )}
                                  </div>
                                )}

                                <p class="muted-small">
                                  Aangemaakt door {profileName}
                                  {transaction.updatedAt
                                    ? ` • laatst aangepast ${formatRelativeDate(transaction.updatedAt)}`
                                    : ""}
                                </p>
                              </div>

                              <div class="admin-finance-row-actions">
                                <button
                                  class="btn btn-light"
                                  type="button"
                                  onClick={() => openFinanceTransactionDetail(transaction)}
                                >
                                  Bekijken
                                </button>
                                <details class="admin-finance-row-menu">
                                  <summary>Meer</summary>
                                  <div class="admin-finance-row-menu-popover">
                                    <button
                                      class="btn btn-light"
                                      type="button"
                                      onClick={() => startFinanceDraft(transaction)}
                                    >
                                      Bewerken
                                    </button>
                                    <button
                                      class="btn btn-light"
                                      type="button"
                                      onClick={() => duplicateFinanceTransaction(transaction)}
                                    >
                                      Dupliceren
                                    </button>
                                    {transaction.status === "pending" && (
                                      <button
                                        class="btn btn-light"
                                        type="button"
                                        onClick={() =>
                                          updateFinanceTransactionStatus(
                                            transaction.id ?? "",
                                            transaction.categoryKey === "reimbursement"
                                              ? "reimbursed"
                                              : "paid"
                                          )
                                        }
                                      >
                                        {transaction.categoryKey === "reimbursement"
                                          ? "Markeer terugbetaald"
                                          : transaction.type === "income"
                                            ? "Markeer ontvangen"
                                            : "Markeer betaald"}
                                      </button>
                                    )}
                                    <button
                                      class="admin-remove"
                                      type="button"
                                      onClick={() => archiveFinanceTransaction(transaction)}
                                    >
                                      {transaction.id?.startsWith("temp-")
                                        ? "Verwijderen"
                                        : "Archiveren"}
                                    </button>
                                  </div>
                                </details>
                              </div>
                            </article>
                          );
                        })
                      ) : (
                        <div class="admin-finance-empty">
                          <strong>Geen transacties voor deze filters.</strong>
                          <p>Pas je filters aan of voeg een eerste transactie toe.</p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <div class="admin-finance-side">
                  <section class="admin-subpanel">
                    <div class="admin-subpanel-head">
                      <div>
                        <h4>Transactiedetail</h4>
                        <p class="muted-small">Snelle controle zonder je plaats in de lijst te verliezen.</p>
                      </div>
                    </div>
                    {financeSelectedTransaction ? (
                      <div class="admin-finance-detail-panel">
                        <div class="admin-finance-detail-top">
                          <div>
                            <span class={`admin-finance-tag is-${financeSelectedTransaction.type}`}>
                              {getFinanceTypeLabel(financeSelectedTransaction.type)}
                            </span>
                            <h4>{financeSelectedTransaction.title}</h4>
                            <p>
                              {formatAdminDate(financeSelectedTransaction.date, {
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                                hour: undefined,
                                minute: undefined
                              })}
                            </p>
                          </div>
                          <strong
                            class={
                              financeSelectedTransaction.type === "income"
                                ? "admin-finance-amount is-positive"
                                : "admin-finance-amount is-negative"
                            }
                          >
                            {financeSelectedTransaction.type === "income" ? "+" : "-"}
                            {formatCurrency(financeSelectedTransaction.amount)}
                          </strong>
                        </div>

                        <div class="admin-finance-detail-grid">
                          <div>
                            <span>Groep</span>
                            <strong>
                              {financeSelectedTransaction.groupLabel ||
                                getFinanceGroupLabel(financeSelectedTransaction.groupSlug, groups)}
                            </strong>
                          </div>
                          <div>
                            <span>Status</span>
                            <strong>{getFinanceStatusLabel(financeSelectedTransaction.status)}</strong>
                          </div>
                          <div>
                            <span>Categorie</span>
                            <strong>{getFinanceCategoryLabel(financeSelectedTransaction.categoryKey)}</strong>
                          </div>
                          <div>
                            <span>Betaalmethode</span>
                            <strong>{financeSelectedTransaction.paymentMethod || "Niet opgegeven"}</strong>
                          </div>
                          <div>
                            <span>Persoon</span>
                            <strong>{financeSelectedTransaction.personName || "Niet opgegeven"}</strong>
                          </div>
                          <div>
                            <span>Aangemaakt door</span>
                            <strong>{financeSelectedTransactionProfileName}</strong>
                          </div>
                        </div>

                        {financeSelectedTransaction.description && (
                          <div class="admin-finance-detail-block">
                            <span>Notities</span>
                            <p>{financeSelectedTransaction.description}</p>
                          </div>
                        )}

                        {financeSelectedTransaction.receiptUrl && (
                          <div class="admin-finance-detail-block">
                            <span>Bewijsstuk</span>
                            <a href={financeSelectedTransaction.receiptUrl} target="_blank" rel="noreferrer">
                              {financeSelectedTransaction.receiptFileName || "Bewijsstuk openen"}
                            </a>
                          </div>
                        )}

                        <div class="admin-finance-detail-actions">
                          <button
                            class="btn"
                            type="button"
                            onClick={() => startFinanceDraft(financeSelectedTransaction)}
                          >
                            Bewerken
                          </button>
                          <button
                            class="btn btn-light"
                            type="button"
                            onClick={() => duplicateFinanceTransaction(financeSelectedTransaction)}
                          >
                            Dupliceren
                          </button>
                          {financeSelectedTransaction.status === "pending" && (
                            <button
                              class="btn btn-light"
                              type="button"
                              onClick={() =>
                                updateFinanceTransactionStatus(
                                  financeSelectedTransaction.id ?? "",
                                  financeSelectedTransaction.categoryKey === "reimbursement"
                                    ? "reimbursed"
                                    : "paid"
                                )
                              }
                            >
                              Afwerken
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div class="admin-finance-empty">
                        <strong>Kies een transactie.</strong>
                        <p>Klik links op een item om details, bewijsstuk en acties te zien.</p>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}

            {financeView === "editor" && (
              <div class="admin-finance-layout is-editor">
                <div class="admin-finance-main">
                  <section class="admin-subpanel">
                    <div class="admin-subpanel-head">
                      <div>
                        <h4>{financeEditingId ? "Transactie bewerken" : "Nieuwe transactie"}</h4>
                        <p class="muted-small">
                          Een rustige fiche zoals in een echte backoffice: invullen, klaarzetten en opslaan.
                        </p>
                      </div>
                      {financeDraft && (
                        <button class="admin-remove" type="button" onClick={cancelFinanceDraft}>
                          Annuleren
                        </button>
                      )}
                    </div>

                    {financeDraft ? (
                      <>
                        <div class="admin-inline-grid admin-inline-grid-wide admin-finance-editor-grid">
                          <TextField
                            label="Titel"
                            value={financeDraft.title}
                            onInput={(value) =>
                              updateFinanceDraft((current) => ({ ...current, title: value }))
                            }
                          />
                          <label class="admin-field">
                            <span>Type</span>
                            <select
                              value={financeDraft.type}
                              onInput={(event) => {
                                const nextType = (event.currentTarget as HTMLSelectElement)
                                  .value as FinanceType;
                                const nextOptions = getFinanceCategoryOptions(nextType);
                                updateFinanceDraft((current) => ({
                                  ...current,
                                  type: nextType,
                                  categoryKey: nextOptions.some(
                                    (option) => option.key === current.categoryKey
                                  )
                                    ? current.categoryKey
                                    : (nextOptions[0]?.key ?? "")
                                }));
                              }}
                            >
                              {financeTypeOptions.map((option) => (
                                <option value={option.value} key={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label class="admin-field">
                            <span>Bedrag</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={financeDraft.amount || ""}
                              onInput={(event) =>
                                updateFinanceDraft((current) => ({
                                  ...current,
                                  amount: Number.parseFloat(
                                    (event.currentTarget as HTMLInputElement).value
                                  )
                                }))
                              }
                            />
                          </label>
                          <TextField
                            label="Datum"
                            type="date"
                            value={financeDraft.date}
                            onInput={(value) =>
                              updateFinanceDraft((current) => ({ ...current, date: value }))
                            }
                          />
                          <label class="admin-field">
                            <span>Groep</span>
                            <select
                              value={financeDraft.groupSlug}
                              onInput={(event) =>
                                updateFinanceDraft((current) => ({
                                  ...current,
                                  groupSlug: (event.currentTarget as HTMLSelectElement).value
                                }))
                              }
                            >
                              {profile?.role === "admin" && <option value="">Algemeen</option>}
                              {financeAccessibleGroups.map((group) => (
                                <option value={group.slug} key={group.slug}>
                                  {group.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label class="admin-field">
                            <span>Categorie</span>
                            <select
                              value={financeDraft.categoryKey}
                              onInput={(event) =>
                                updateFinanceDraft((current) => ({
                                  ...current,
                                  categoryKey: (event.currentTarget as HTMLSelectElement).value
                                }))
                              }
                            >
                              {financeDraftCategoryOptions.map((option) => (
                                <option value={option.key} key={option.key}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label class="admin-field">
                            <span>Status</span>
                            <select
                              value={financeDraft.status}
                              onInput={(event) =>
                                updateFinanceDraft((current) => ({
                                  ...current,
                                  status: (event.currentTarget as HTMLSelectElement)
                                    .value as FinanceStatus
                                }))
                              }
                            >
                              {financeStatusOptions.map((option) => (
                                <option value={option.value} key={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label class="admin-field">
                            <span>Betaalmethode</span>
                            <select
                              value={financeDraft.paymentMethod}
                              onInput={(event) =>
                                updateFinanceDraft((current) => ({
                                  ...current,
                                  paymentMethod: (event.currentTarget as HTMLSelectElement).value
                                }))
                              }
                            >
                              {financePaymentMethodOptions.map((option) => (
                                <option value={option} key={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div class="admin-grid">
                          <TextField
                            label={financeDraft.type === "income" ? "Ontvangen van" : "Betaald door"}
                            value={financeDraft.personName}
                            onInput={(value) =>
                              updateFinanceDraft((current) => ({ ...current, personName: value }))
                            }
                          />
                          <TextAreaField
                            label="Beschrijving"
                            value={financeDraft.description}
                            rows={4}
                            onInput={(value) =>
                              updateFinanceDraft((current) => ({ ...current, description: value }))
                            }
                          />
                        </div>

                        <FileField
                          label="Bewijsstuk URL"
                          value={financeDraft.receiptUrl}
                          onInput={(value) =>
                            updateFinanceDraft((current) => ({ ...current, receiptUrl: value }))
                          }
                          fileName={financeDraft.receiptFileName}
                          onFileNameInput={(value) =>
                            updateFinanceDraft((current) => ({
                              ...current,
                              receiptFileName: value
                            }))
                          }
                          client={supabase}
                          folder="finance"
                          accept=".pdf,image/*"
                        />

                        <div class="admin-post-actions">
                          <button class="btn" type="button" onClick={saveFinanceDraftToList}>
                            {financeEditingId ? "Wijziging klaarzetten" : "Aan lijst toevoegen"}
                          </button>
                          <button class="btn btn-light" type="button" onClick={cancelFinanceDraft}>
                            Annuleren
                          </button>
                        </div>
                      </>
                    ) : (
                      <div class="admin-finance-empty">
                        <strong>Geen open fiche.</strong>
                        <p>Kies hierboven `Nieuwe transactie` of open een item vanuit de transactielijst.</p>
                        <button class="btn" type="button" onClick={() => startFinanceDraft()}>
                          Nieuwe transactie starten
                        </button>
                      </div>
                    )}
                  </section>
                </div>

                <div class="admin-finance-side">
                  <section class="admin-subpanel">
                    <div class="admin-subpanel-head">
                      <div>
                        <h4>Editor-hulp</h4>
                        <p class="muted-small">Kleine shortcuts zoals in een financiële backoffice.</p>
                      </div>
                    </div>
                    <div class="admin-finance-shortcuts">
                      <button
                        class="admin-finance-shortcut"
                        type="button"
                        onClick={() => {
                          if (!financeDraft) {
                            startFinanceDraft();
                            return;
                          }
                          updateFinanceDraft((current) => ({
                            ...current,
                            type: "expense",
                            categoryKey: financeExpenseCategories[0]?.key ?? current.categoryKey,
                            status: "paid"
                          }));
                        }}
                      >
                        <strong>Snelle uitgave</strong>
                        <span>Vooraf ingesteld als betaalde uitgave</span>
                      </button>
                      <button
                        class="admin-finance-shortcut"
                        type="button"
                        onClick={() => {
                          if (!financeDraft) {
                            startFinanceDraft();
                            return;
                          }
                          updateFinanceDraft((current) => ({
                            ...current,
                            type: "income",
                            categoryKey: financeIncomeCategories[0]?.key ?? current.categoryKey,
                            status: "paid"
                          }));
                        }}
                      >
                        <strong>Snelle inkomst</strong>
                        <span>Vooraf ingesteld als ontvangen bedrag</span>
                      </button>
                      <button
                        class="admin-finance-shortcut"
                        type="button"
                        onClick={() => setFinanceView("transactions")}
                      >
                        <strong>Terug naar lijst</strong>
                        <span>Open de transacties met je huidige filters</span>
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            )}
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
                <p>Algemene contactpagina, groepsleiding en extra contactblokken.</p>
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
                <div>
                  <h4>Leiding per groep</h4>
                  <p class="muted-small">
                    Deze kaarten verschijnen op de contactpagina en gebruiken dezelfde leiding als in `Groepen`.
                  </p>
                </div>
              </div>
              {orderedContactGroups.map((group, index) => (
                <div class="admin-card-editor" key={group.id ?? group.slug ?? index}>
                  <div class="admin-subpanel-head">
                    <div>
                      <h4>{group.name}</h4>
                      <p class="muted-small">Pas hier de contactpersonen van {group.name} aan.</p>
                    </div>
                  </div>
                  <PeopleEditor
                    title="Leiding"
                    people={group.leaders}
                    onChange={(people) =>
                      setGroups((current) =>
                        current.map((item) =>
                          item.id === group.id || item.slug === group.slug ? { ...item, leaders: people } : item
                        )
                      )
                    }
                  />
                </div>
              ))}
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
                <div class="admin-card-editor" key={currentProfile.user_id}>
                  <div class="admin-inline-grid admin-inline-grid-wide">
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
                  <div class="admin-team-group-access">
                    <div class="admin-team-group-access-head">
                      <strong>Groepen die deze leider mag beheren</strong>
                      <span>
                        {currentProfile.role === "admin"
                          ? "Admins zien alles"
                          : currentProfile.managedGroupSlugs.length
                            ? `${currentProfile.managedGroupSlugs.length} gekoppeld`
                            : "Nog geen groepen"}
                      </span>
                    </div>
                    <div class="admin-team-group-chips">
                      {groups.map((group) => {
                        const isActive = currentProfile.managedGroupSlugs.includes(group.slug);

                        return (
                          <button
                            class={`admin-team-group-chip ${isActive ? "is-active" : ""}`}
                            type="button"
                            disabled={currentProfile.role === "admin"}
                            onClick={() =>
                              setProfiles((current) =>
                                current.map((item, itemIndex) => {
                                  if (itemIndex !== index) {
                                    return item;
                                  }

                                  return {
                                    ...item,
                                    managedGroupSlugs: isActive
                                      ? item.managedGroupSlugs.filter((slug) => slug !== group.slug)
                                      : [...item.managedGroupSlugs, group.slug].sort((left, right) =>
                                          left.localeCompare(right, "nl")
                                        )
                                  };
                                })
                              )
                            }
                          >
                            {group.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div class="admin-team-actions">
                    <p class="muted-small">
                      {currentProfile.user_id === session.user.id
                        ? "Je eigen account kun je hier niet verwijderen."
                        : currentProfile.role === "admin" &&
                            profiles.filter((item) => item.role === "admin").length <= 1
                          ? "De laatste admin kun je niet verwijderen."
                          : "Verwijderen haalt dit teamlid volledig uit de admin-login."}
                    </p>
                    <button
                      class="admin-remove"
                      type="button"
                      disabled={
                        removingProfileId === currentProfile.user_id ||
                        currentProfile.user_id === session.user.id ||
                        (currentProfile.role === "admin" &&
                          profiles.filter((item) => item.role === "admin").length <= 1)
                      }
                      onClick={() => void removeTeamMember(currentProfile)}
                    >
                      {removingProfileId === currentProfile.user_id
                        ? "Verwijderen..."
                        : "Uit team verwijderen"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
