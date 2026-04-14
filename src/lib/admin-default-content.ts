import type { SiteContent } from "@/types/content";

export const adminDefaultContent = {
  siteSettings: {
    siteName: "",
    siteUrl: "",
    logoUrl: "",
    email: "",
    facebookUrl: "",
    instagramUrl: "",
    address: "",
    addressNote: "",
    mapEmbedUrl: "",
    mapGoogleUrl: "",
    mapAppleUrl: "",
    footerCopyright: "",
    footerDeveloper: "",
    analyticsId: "",
    footerAdminLabel: ""
  },
  pages: {
    home: {
      banner: {
        eyebrow: "",
        title: "",
        subtitle: "",
        imageUrl: "",
        imageAlt: "",
        primaryCtaLabel: "",
        primaryCtaHref: "",
        secondaryCtaLabel: "",
        secondaryCtaHref: ""
      },
      hero: {
        badge: "",
        title: "",
        lead: ""
      },
      gallery: [],
      about: {
        title: "",
        body: "",
        ctaLabel: "",
        ctaHref: ""
      },
      practical: {
        title: "",
        items: [],
        note: ""
      },
      history: {
        title: "",
        body: ""
      }
    },
    groups: {
      title: "",
      lead: ""
    },
    contact: {
      title: "",
      generalTitle: "",
      generalBody: "",
      formTitle: "",
      successMessage: "",
      errorMessage: "",
      formCategories: [],
      sectionsTitle: "",
      groupCards: [],
      extraSections: []
    },
    songs: {
      title: "",
      lead: ""
    },
    activities: {
      slug: "",
      title: "",
      lead: "",
      description: "",
      bookletUrl: "",
      bookletFileName: "",
      cards: [],
      postsTitle: "",
      postsEmptyText: ""
    },
    registration: {
      title: "",
      lead: "",
      stepsTitle: "",
      steps: [],
      tip: "",
      groupsTitle: "",
      clothesTitle: "",
      clothesBody: "",
      groupsTable: [],
      merch: {
        title: "",
        subtitle: "",
        body: "",
        note: "",
        imageUrl: "",
        imageAlt: "",
        prices: [],
        actions: []
      }
    },
    camp: {
      title: "",
      kicker: "",
      lead: "",
      heroImageUrl: "",
      heroImageAlt: "",
      ctas: [],
      jumpLinks: [],
      overviewTitle: "",
      overviewItems: [],
      importantTitle: "",
      importantImageUrl: "",
      importantImageAlt: "",
      importantItems: [],
      importantNotice: "",
      priceTitle: "",
      priceItems: [],
      bankAccount: "",
      bankMessage: "",
      cancellationPolicy: "",
      supportBoxes: [],
      signupTitle: "",
      signupIntro: "",
      signupLinkUrl: "",
      signupLinkLabel: "",
      signupSteps: [],
      checklistTitle: "",
      checklistSections: []
    },
    rental: {
      slug: "",
      title: "",
      lead: "",
      description: "",
      cards: []
    },
    insurance: {
      slug: "",
      title: "",
      lead: "",
      description: "",
      cards: []
    },
    privacy: {
      slug: "",
      title: "",
      lead: "",
      description: "",
      cards: []
    }
  },
  groups: [],
  contactSections: [],
  songs: [],
  posts: [],
  contactMessages: []
} as SiteContent;
