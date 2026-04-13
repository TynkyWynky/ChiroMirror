import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "src", "data");
const outputFile = path.join(outputDir, "default-content.json");

const groupMeta = {
  ribbels: { name: "Ribbels", themeKey: "ribbels" },
  speelclub: { name: "Speelclub", themeKey: "speelclub" },
  rakwi: { name: "Rakwi", themeKey: "rakwi" },
  tito: { name: "Tito", themeKey: "tito" },
  keti: { name: "Keti", themeKey: "keti" },
  aspi: { name: "Aspi", themeKey: "aspi" }
};

function readHtml(fileName) {
  return fs.readFileSync(path.join(rootDir, fileName), "utf8");
}

function readPage(fileName) {
  return load(readHtml(fileName), { decodeEntities: false });
}

function normalizeWhitespace(value) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeAssetPath(value = "") {
  return value
    .replace(/^https:\/\/www\.chironegenmanneke\.be/, "")
    .replace(/^assets\//, "/assets/")
    .replace("Tito.jpg", "tito-cover.jpg")
    .replace("Keti.jpg", "keti-cover.jpg");
}

function escapeInline(value) {
  return value.replace(/\s+/g, " ").trim();
}

function inlineNodeToMarkdown(node, $) {
  if (node.type === "text") {
    return node.data.replace(/\s+/g, " ");
  }

  if (node.type !== "tag") {
    return "";
  }

  const $node = $(node);
  const tagName = node.tagName.toLowerCase();
  const content = $node
    .contents()
    .map((_, child) => inlineNodeToMarkdown(child, $))
    .get()
    .join("");

  if (tagName === "br") {
    return "\n";
  }

  if (tagName === "strong" || tagName === "b") {
    return `**${escapeInline(content)}**`;
  }

  if (tagName === "em" || tagName === "i") {
    return `*${escapeInline(content)}*`;
  }

  if (tagName === "a") {
    const href = $node.attr("href") || "";
    return `[${escapeInline(content)}](${href})`;
  }

  if (tagName === "small") {
    return escapeInline(content);
  }

  return content;
}

function listToMarkdown($, $list, ordered = false) {
  return $list
    .children("li")
    .map((index, item) => {
      const line = normalizeWhitespace(
        $(item)
          .contents()
          .map((_, child) => inlineNodeToMarkdown(child, $))
          .get()
          .join("")
      );
      const prefix = ordered ? `${index + 1}. ` : "- ";
      return `${prefix}${line}`;
    })
    .get()
    .join("\n");
}

function elementToMarkdown($, $root) {
  const parts = [];

  $root.contents().each((_, node) => {
    if (node.type === "text") {
      const text = normalizeWhitespace(node.data || "");
      if (text) {
        parts.push(text);
      }
      return;
    }

    if (node.type !== "tag") {
      return;
    }

    const $node = $(node);
    const tagName = node.tagName.toLowerCase();

    if (tagName === "p") {
      const text = normalizeWhitespace(
        $node
          .contents()
          .map((__, child) => inlineNodeToMarkdown(child, $))
          .get()
          .join("")
      );
      if (text) {
        parts.push(text);
      }
      return;
    }

    if (tagName === "ul") {
      const text = listToMarkdown($, $node, false);
      if (text) {
        parts.push(text);
      }
      return;
    }

    if (tagName === "ol") {
      const text = listToMarkdown($, $node, true);
      if (text) {
        parts.push(text);
      }
      return;
    }

    if (tagName === "div" || tagName === "section" || tagName === "article") {
      const text = elementToMarkdown($, $node);
      if (text) {
        parts.push(text);
      }
    }
  });

  return normalizeWhitespace(parts.join("\n\n"));
}

function extractPeople($, $paragraphs) {
  return $paragraphs
    .map((_, paragraph) => ($(paragraph).html() || "").split(/<br\s*\/?>/i))
    .get()
    .flat()
    .map((part) => normalizeWhitespace(load(`<div>${part}</div>`).text()))
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(":");
      return {
        name: normalizeWhitespace(name),
        phone: normalizeWhitespace(rest.join(":"))
      };
    })
    .filter((person) => person.name && person.phone);
}

function extractCardShape($, card) {
  const $card = $(card);
  return {
    title: normalizeWhitespace($card.find("h2, h3").first().text()),
    body: elementToMarkdown($, $card),
    span: $card.hasClass("span-6") ? 6 : 12
  };
}

function buildSiteSettings(index$) {
  const socialLinks = index$(".logo-row a");
  return {
    siteName: "Chiro Negenmanneke",
    siteUrl: "https://www.chironegenmanneke.be",
    logoUrl: "/assets/Chirologo_700px.png",
    email: (socialLinks.eq(2).attr("href") || "").replace("mailto:", ""),
    facebookUrl: socialLinks.eq(0).attr("href") || "",
    instagramUrl: socialLinks.eq(1).attr("href") || "",
    address: "Gustave Gibonstraat 1A, 1600 Sint-Pieters-Leeuw",
    addressNote: "(op de speelplaats van de Sint-Stevensschool)",
    mapEmbedUrl: index$(".map-wrapper iframe").attr("src") || "",
    mapGoogleUrl: index$(".map-actions a").eq(0).attr("href") || "",
    mapAppleUrl: index$(".map-actions a").eq(1).attr("href") || "",
    footerCopyright: normalizeWhitespace(index$("footer > p.muted").first().text()),
    footerDeveloper: normalizeWhitespace(index$("footer > p.muted").eq(1).text()),
    analyticsId: "G-YGJ0JRJ1D5",
    footerAdminLabel: "Leiding"
  };
}

function buildHomepage(index$) {
  const aboutCard = index$(".card").filter((_, card) =>
    normalizeWhitespace(index$(card).find("h2").first().text()) === "Wat is Chiro?"
  );
  const practicalCard = index$(".card").filter((_, card) =>
    normalizeWhitespace(index$(card).find("h2").first().text()) === "Praktisch"
  );
  const historyCard = index$(".card").filter((_, card) =>
    normalizeWhitespace(index$(card).find("h2").first().text()) === "Geschiedenis"
  );

  return {
    banner: {
      eyebrow: normalizeWhitespace(index$(".banner-eyebrow").text()),
      title: normalizeWhitespace(index$(".banner-title").text()),
      subtitle: normalizeWhitespace(index$(".banner-sub").text()),
      imageUrl: normalizeAssetPath(index$(".banner-image").attr("src") || ""),
      imageAlt: normalizeWhitespace(index$(".banner-image").attr("alt") || ""),
      primaryCtaLabel: normalizeWhitespace(index$(".banner-actions a").eq(0).text()),
      primaryCtaHref: index$(".banner-actions a").eq(0).attr("href") || "inschrijven.html",
      secondaryCtaLabel: normalizeWhitespace(index$(".banner-actions a").eq(1).text()),
      secondaryCtaHref: index$(".banner-actions a").eq(1).attr("href") || "groepen.html"
    },
    hero: {
      badge: normalizeWhitespace(index$(".hero .badge").first().text()),
      title: normalizeWhitespace(index$(".hero h1").first().text()),
      lead: normalizeWhitespace(index$(".hero .lead").first().text())
    },
    gallery: index$(".gallery img")
      .map((_, image) => ({
        imageUrl: normalizeAssetPath(index$(image).attr("src") || ""),
        alt: normalizeWhitespace(index$(image).attr("alt") || ""),
        span: index$(image).hasClass("span-6") ? 6 : 4
      }))
      .get(),
    about: {
      title: normalizeWhitespace(aboutCard.find("h2").first().text()),
      body: elementToMarkdown(index$, aboutCard.find("p")),
      ctaLabel: normalizeWhitespace(aboutCard.find(".btn").text()),
      ctaHref: aboutCard.find(".btn").attr("href") || "inschrijven.html"
    },
    practical: {
      title: normalizeWhitespace(practicalCard.find("h2").first().text()),
      items: practicalCard
        .find("li")
        .map((_, item) => normalizeWhitespace(index$(item).text()))
        .get(),
      note: normalizeWhitespace(practicalCard.find(".muted").text())
    },
    history: {
      title: normalizeWhitespace(historyCard.find("h2").first().text()),
      body: historyCard
        .find("p")
        .map((_, paragraph) => normalizeWhitespace(index$(paragraph).text()))
        .get()
        .join("\n\n")
    }
  };
}

function buildGroups(groups$, contact$) {
  const phoneLookup = new Map();
  contact$(".card[id^='contact-']").each((_, card) => {
    const $card = contact$(card);
    const cardId = ($card.attr("id") || "").replace("contact-", "");
    if (groupMeta[cardId]) {
      phoneLookup.set(cardId, extractPeople(contact$, $card.find("p")));
    }
  });

  return groups$(".groepen-grid article.groep")
    .map((index, article) => {
      const $article = groups$(article);
      const slug = Object.keys(groupMeta).find((key) => $article.hasClass(key));
      const group = groupMeta[slug];
      const metaText = normalizeWhitespace($article.find(".meta").text());
      const metaParts = metaText.split("·").map((part) => normalizeWhitespace(part));
      const leaderNames = normalizeWhitespace($article.find(".groep-list li").text())
        .replace(/^Leiding:\s*/i, "")
        .split("·")
        .map((name) => normalizeWhitespace(name))
        .filter(Boolean);
      const phonePeople = phoneLookup.get(slug) || [];
      const leaders = leaderNames.map((name) => {
        const person = phonePeople.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
        return {
          name,
          phone: person?.phone || ""
        };
      });

      return {
        slug,
        name: group?.name || `Groep ${index + 1}`,
        themeKey: group?.themeKey || slug || `groep-${index + 1}`,
        ageRange: metaParts[0]?.replace(/^Leeftijd:\s*/i, "") || "",
        birthYears: metaParts[1]?.replace(/^Geboortejaar:\s*/i, "") || "",
        schoolYears: metaParts[2] || "",
        description: normalizeWhitespace($article.find(".groep-body > p").eq(1).text()),
        imageUrl: normalizeAssetPath($article.find(".cover").attr("src") || ""),
        imageAlt: normalizeWhitespace($article.find(".cover").attr("alt") || ""),
        sortOrder: index + 1,
        leaders
      };
    })
    .get();
}

function buildContact(contact$, groups) {
  const generalMarkdown = normalizeWhitespace(
    contact$(".card")
      .first()
      .find("p")
      .first()
      .contents()
      .map((_, node) => inlineNodeToMarkdown(node, contact$))
      .get()
      .join("")
  );

  const extraSections = [];
  contact$(".card").each((_, card) => {
    const $card = contact$(card);
    const title = normalizeWhitespace($card.find("h3").first().text());
    const id = $card.attr("id") || "";

    if (!title) {
      return;
    }

    const idSlug = id.replace("contact-", "");
    if (idSlug && groupMeta[idSlug]) {
      return;
    }

    if (title === "Contactformulier") {
      return;
    }

    if (title === "Groepsleiding" || title === "Volwassen begeleider") {
      extraSections.push({
        title,
        accentColor: title === "Groepsleiding" ? "#f472b6" : "#94a3b8",
        sortOrder: extraSections.length + 1,
        people: extractPeople(contact$, $card.find("p"))
      });
    }
  });

  return {
    title: normalizeWhitespace(contact$("main h1").first().text()),
    generalTitle: normalizeWhitespace(contact$(".card h2").first().text()),
    generalBody: generalMarkdown,
    formTitle: "Contactformulier",
    successMessage: normalizeWhitespace(contact$("#form-success").text()),
    errorMessage: normalizeWhitespace(contact$("#form-error").text()),
    formCategories: contact$("select[name='categorie'] option")
      .map((_, option) => normalizeWhitespace(contact$(option).text()))
      .get()
      .filter(Boolean),
    sectionsTitle: "Contacteer de leiding",
    groupCards: groups.map((group) => ({
      groupSlug: group.slug,
      title: group.name
    })),
    extraSections
  };
}

function buildSongs(songs$) {
  return songs$(".song")
    .map((index, item) => ({
      title: normalizeWhitespace(songs$(item).find(".song-title").text()),
      lyrics: normalizeWhitespace(songs$(item).find(".lyrics").text()),
      sortOrder: index + 1
    }))
    .get();
}

function buildSimplePage($, fileName) {
  return {
    slug: fileName.replace(".html", ""),
    title: normalizeWhitespace($("main h1").first().text()),
    lead: normalizeWhitespace($(".lead").first().text()),
    description: normalizeWhitespace($("meta[name='description']").attr("content") || ""),
    cards: $(".hero .card")
      .map((_, card) => extractCardShape($, card))
      .get()
  };
}

function buildRegistrationPage($, groups) {
  const stepsCard = $(".steps");
  const clothesCard = $(".card").filter((_, card) =>
    normalizeWhitespace($(card).find("h2").first().text()) === "Chirokledij & afdelingen"
  );

  return {
    title: normalizeWhitespace($("main h1").first().text()),
    lead: normalizeWhitespace($(".lead").first().text()),
    stepsTitle: normalizeWhitespace(stepsCard.find("h2").first().text()),
    steps: stepsCard
      .find("li")
      .map((_, item) => normalizeWhitespace($(item).text()))
      .get(),
    tip: normalizeWhitespace(stepsCard.find(".callout").text()),
    groupsTitle: "Afdelingen & leeftijden",
    clothesTitle: normalizeWhitespace(clothesCard.find("h2").first().text()),
    clothesBody: normalizeWhitespace(clothesCard.find("p").first().text()),
    groupsTable: groups.map((group) => ({
      name: group.name,
      birthYears: group.birthYears,
      ageRange: group.ageRange,
      schoolYears: group.schoolYears
    })),
    merch: {
      title: normalizeWhitespace($(".merch .section-title h2").text()),
      subtitle: normalizeWhitespace($(".merch-card h3").first().text()),
      body: $(".merch-card ul li")
        .map((_, item) => normalizeWhitespace($(item).text()))
        .get()
        .join("\n"),
      note: normalizeWhitespace($(".muted-small").text()),
      imageUrl: normalizeAssetPath($(".merch-img-wrap img").attr("src") || ""),
      imageAlt: normalizeWhitespace($(".merch-img-wrap img").attr("alt") || ""),
      prices: $(".price-pill")
        .map((_, pill) => normalizeWhitespace($(pill).text()))
        .get(),
      actions: $(".merch-card .btn")
        .map((_, link) => ({
          label: normalizeWhitespace($(link).text()),
          href: $(link).attr("href") || ""
        }))
        .get()
    }
  };
}

function buildCampPage($) {
  return {
    title: normalizeWhitespace($(".camp-masthead-copy h1").text()),
    kicker: normalizeWhitespace($(".camp-kicker").text()),
    lead: normalizeWhitespace($(".camp-masthead-copy .lead").text()),
    heroImageUrl: normalizeAssetPath($(".camp-masthead-visual img").attr("src") || ""),
    heroImageAlt: normalizeWhitespace($(".camp-masthead-visual img").attr("alt") || ""),
    ctas: $(".camp-cta-row a")
      .map((_, link) => ({
        label: normalizeWhitespace($(link).text()),
        href: $(link).attr("href") || ""
      }))
      .get(),
    jumpLinks: $(".camp-jumpbar a")
      .map((_, link) => ({
        label: normalizeWhitespace($(link).text()),
        href: $(link).attr("href") || ""
      }))
      .get(),
    overviewTitle: normalizeWhitespace($(".camp-hero-card h2").first().text()),
    overviewItems: $(".camp-pill")
      .map((_, pill) => ({
        title: normalizeWhitespace($(pill).find("strong").text()),
        text: normalizeWhitespace($(pill).find("span").text())
      }))
      .get(),
    importantTitle: normalizeWhitespace($(".camp-note-card h2").first().text()),
    importantImageUrl: normalizeAssetPath($(".camp-inline-photo").attr("src") || ""),
    importantImageAlt: normalizeWhitespace($(".camp-inline-photo").attr("alt") || ""),
    importantItems: $(".camp-note-card .checklist li")
      .map((_, item) => normalizeWhitespace($(item).text()))
      .get(),
    importantNotice: normalizeWhitespace($(".camp-note-card .callout").text()),
    priceTitle: normalizeWhitespace($("#camp-price h2").first().text()),
    priceItems: $("#camp-price .camp-price-list div")
      .map((_, row) => ({
        label: normalizeWhitespace($(row).find("span").text()),
        value: normalizeWhitespace($(row).find("strong").text())
      }))
      .get(),
    bankAccount: normalizeWhitespace($("#camp-price .camp-bank-box p").first().text()).replace(/^Rekeningnummer\s*/i, ""),
    bankMessage: normalizeWhitespace($("#camp-price .camp-bank-box p").eq(1).text()).replace(/^Mededeling\s*/i, ""),
    cancellationPolicy: normalizeWhitespace($("#camp-price > p").first().text()),
    supportBoxes: $("#camp-price .camp-soft-box")
      .map((_, box) => ({
        title: normalizeWhitespace($(box).find("h3").text()),
        body: normalizeWhitespace($(box).find("p").text())
      }))
      .get(),
    signupTitle: normalizeWhitespace($("#camp-signup h2").text()),
    signupIntro: normalizeWhitespace($("#camp-signup > p").last().prev().text() || $("#camp-signup > p").first().text()),
    signupLinkUrl: $("#camp-signup a").attr("href") || "",
    signupLinkLabel: normalizeWhitespace($("#camp-signup a").text()),
    signupSteps: $("#camp-signup .camp-step-list li")
      .map((_, item) => ({
        title: normalizeWhitespace($(item).find("strong").text()),
        text: normalizeWhitespace($(item).find("span").text())
      }))
      .get(),
    checklistTitle: normalizeWhitespace($("#camp-checklist h2").text()),
    checklistSections: $("#camp-checklist .camp-pack-card")
      .map((_, card) => {
        const $card = $(card);
        if ($card.hasClass("camp-pack-note")) {
          return {
            title: normalizeWhitespace($card.find("h3").text()),
            note: normalizeWhitespace($card.find("p").text()),
            items: []
          };
        }

        return {
          title: normalizeWhitespace($card.find("summary").text()),
          note: normalizeWhitespace($card.find("p").first().text()),
          items: $card
            .find("li")
            .map((__, item) => normalizeWhitespace($(item).text()))
            .get()
        };
      })
      .get()
  };
}

function buildActivitiesPage($) {
  const base = buildSimplePage($, "activiteiten.html");
  return {
    ...base,
    bookletUrl: "",
    bookletFileName: "chiro-negenmanneke-boekje.pdf",
    postsTitle: "Nieuws & activiteiten",
    postsEmptyText: "Er staan nog geen berichten online. Kijk later nog eens terug."
  };
}

function main() {
  const index$ = readPage("index.html");
  const groups$ = readPage("groepen.html");
  const contact$ = readPage("contact.html");
  const songs$ = readPage("chiroliedjes.html");
  const inschrijven$ = readPage("inschrijven.html");
  const kamp$ = readPage("kamp.html");
  const activiteiten$ = readPage("activiteiten.html");
  const verhuur$ = readPage("verhuur.html");
  const verzekering$ = readPage("verzekering.html");
  const privacy$ = readPage("privacy.html");

  const groups = buildGroups(groups$, contact$);

  const data = {
    siteSettings: buildSiteSettings(index$),
    pages: {
      home: buildHomepage(index$),
      groups: {
        title: normalizeWhitespace(groups$("main h1").first().text()),
        lead: normalizeWhitespace(groups$(".lead").first().text())
      },
      contact: buildContact(contact$, groups),
      songs: {
        title: normalizeWhitespace(songs$("main h1").first().text()),
        lead: normalizeWhitespace(songs$(".lead").first().text())
      },
      activities: buildActivitiesPage(activiteiten$),
      registration: buildRegistrationPage(inschrijven$, groups),
      camp: buildCampPage(kamp$),
      rental: buildSimplePage(verhuur$, "verhuur.html"),
      insurance: buildSimplePage(verzekering$, "verzekering.html"),
      privacy: buildSimplePage(privacy$, "privacy.html")
    },
    groups,
    contactSections: buildContact(contact$, groups).extraSections,
    songs: buildSongs(songs$),
    posts: [],
    contactMessages: []
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Legacy content exported to ${outputFile}`);
}

main();
