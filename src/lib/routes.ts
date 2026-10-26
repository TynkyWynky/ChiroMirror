export const primaryNav = [
  { label: "Groepen", href: "/groepen.html" },
  { label: "Activiteiten", href: "/activiteiten.html" },
  { label: "Kamp", href: "/kamp.html" },
  {
    label: "Praktisch",
    children: [
      { label: "Praktisch overzicht", href: "/praktisch.html" },
      { label: "Verzekering", href: "/verzekering.html" },
      { label: "Privacy", href: "/privacy.html" },
      { label: "Chiroliedjes", href: "/chiroliedjes.html" },
      { label: "Verhuur", href: "/verhuur.html" }
    ]
  },
  { label: "Contact", href: "/contact.html" },
  { label: "Inschrijven", href: "/inschrijven.html" }
] as const;

export const publicNavLinks = primaryNav.flatMap<{ label: string; href: string }>(
  (item) => "children" in item ? item.children : [item]
);
