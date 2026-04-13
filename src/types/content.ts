export interface Person {
  name: string;
  phone: string;
}

export interface SiteSettings {
  siteName: string;
  siteUrl: string;
  logoUrl: string;
  email: string;
  facebookUrl: string;
  instagramUrl: string;
  address: string;
  addressNote: string;
  mapEmbedUrl: string;
  mapGoogleUrl: string;
  mapAppleUrl: string;
  footerCopyright: string;
  footerDeveloper: string;
  analyticsId: string;
  footerAdminLabel: string;
}

export interface LinkAction {
  label: string;
  href: string;
}

export interface GalleryImage {
  imageUrl: string;
  alt: string;
  span: number;
}

export interface HomePage {
  banner: {
    eyebrow: string;
    title: string;
    subtitle: string;
    imageUrl: string;
    imageAlt: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
    secondaryCtaLabel: string;
    secondaryCtaHref: string;
  };
  hero: {
    badge: string;
    title: string;
    lead: string;
  };
  gallery: GalleryImage[];
  about: {
    title: string;
    body: string;
    ctaLabel: string;
    ctaHref: string;
  };
  practical: {
    title: string;
    items: string[];
    note: string;
  };
  history: {
    title: string;
    body: string;
  };
}

export interface GroupCardLink {
  groupSlug: string;
  title: string;
}

export interface ContactSection {
  id?: string;
  title: string;
  accentColor: string;
  sortOrder: number;
  people: Person[];
}

export interface ContactPage {
  title: string;
  generalTitle: string;
  generalBody: string;
  formTitle: string;
  successMessage: string;
  errorMessage: string;
  formCategories: string[];
  sectionsTitle: string;
  groupCards: GroupCardLink[];
  extraSections: ContactSection[];
}

export interface GroupsPage {
  title: string;
  lead: string;
}

export interface SongsPage {
  title: string;
  lead: string;
}

export interface PageCard {
  title: string;
  body: string;
  span: number;
}

export interface SimplePage {
  slug: string;
  title: string;
  lead: string;
  description: string;
  cards: PageCard[];
}

export interface ActivitiesPage extends SimplePage {
  postsTitle: string;
  postsEmptyText: string;
  bookletUrl: string;
  bookletFileName: string;
}

export interface Group {
  id?: string;
  slug: string;
  name: string;
  themeKey: string;
  ageRange: string;
  birthYears: string;
  schoolYears: string;
  description: string;
  imageUrl: string;
  imageAlt: string;
  sortOrder: number;
  leaders: Person[];
}

export interface RegistrationPage {
  title: string;
  lead: string;
  stepsTitle: string;
  steps: string[];
  tip: string;
  groupsTitle: string;
  clothesTitle: string;
  clothesBody: string;
  groupsTable: Array<{
    name: string;
    birthYears: string;
    ageRange: string;
    schoolYears: string;
  }>;
  merch: {
    title: string;
    subtitle: string;
    body: string;
    note: string;
    imageUrl: string;
    imageAlt: string;
    prices: string[];
    actions: LinkAction[];
  };
}

export interface CampOverviewItem {
  title: string;
  text: string;
}

export interface CampSupportBox {
  title: string;
  body: string;
}

export interface CampChecklistSection {
  title: string;
  note: string;
  items: string[];
}

export interface CampStep {
  title: string;
  text: string;
}

export interface CampPage {
  title: string;
  kicker: string;
  lead: string;
  heroImageUrl: string;
  heroImageAlt: string;
  ctas: LinkAction[];
  jumpLinks: LinkAction[];
  overviewTitle: string;
  overviewItems: CampOverviewItem[];
  importantTitle: string;
  importantImageUrl: string;
  importantImageAlt: string;
  importantItems: string[];
  importantNotice: string;
  priceTitle: string;
  priceItems: Array<{
    label: string;
    value: string;
  }>;
  bankAccount: string;
  bankMessage: string;
  cancellationPolicy: string;
  supportBoxes: CampSupportBox[];
  signupTitle: string;
  signupIntro: string;
  signupLinkUrl: string;
  signupLinkLabel: string;
  signupSteps: CampStep[];
  checklistTitle: string;
  checklistSections: CampChecklistSection[];
}

export interface Song {
  id?: string;
  title: string;
  lyrics: string;
  sortOrder: number;
}

export interface Post {
  id?: string;
  title: string;
  summary: string;
  body: string;
  eventDate: string;
  published: boolean;
  featured: boolean;
  createdAt?: string;
}

export interface ContactMessage {
  id?: string;
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
  createdAt?: string;
}

export interface SitePages {
  home: HomePage;
  groups: GroupsPage;
  contact: ContactPage;
  songs: SongsPage;
  activities: ActivitiesPage;
  registration: RegistrationPage;
  camp: CampPage;
  rental: SimplePage;
  insurance: SimplePage;
  privacy: SimplePage;
}

export interface SiteContent {
  siteSettings: SiteSettings;
  pages: SitePages;
  groups: Group[];
  contactSections: ContactSection[];
  songs: Song[];
  posts: Post[];
  contactMessages: ContactMessage[];
}
