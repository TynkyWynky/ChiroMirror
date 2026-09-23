import type { Permission } from "../../lib/auth/access.ts";

export const siteTabs = [
  { id: "overview", label: "Overzicht", description: "Recente activiteit en aandachtspunten", permission: "site.manage" },
  { id: "posts", label: "Posts", description: "Nieuws, foto's en activiteiten publiceren", permission: "site.manage" },
  { id: "messages", label: "Inbox", description: "Contactberichten van ouders en bezoekers", permission: "site.manage" },
  { id: "finance", label: "Financiën", description: "Bestaande transacties en groepsbudgetten", permission: "site.finance.manage" },
  { id: "home", label: "Homepage", description: "Banner, introductie en foto's", permission: "site.manage" },
  { id: "groups", label: "Groepen", description: "Groepsinformatie en leiding", permission: "site.manage" },
  { id: "registration", label: "Inschrijven", description: "Inschrijving, kledij en prijzen", permission: "site.manage" },
  { id: "camp", label: "Kamp", description: "Kampinformatie en inschrijvingen", permission: "site.manage" },
  { id: "contact", label: "Contactpagina", description: "Contactpersonen en formulierteksten", permission: "site.manage" },
  { id: "songs", label: "Liedjes", description: "Liedteksten en liedbundel", permission: "site.manage" },
  { id: "pages", label: "Overige pagina's", description: "Activiteiten, verhuur, verzekering en privacy", permission: "site.manage" },
  { id: "site", label: "Instellingen", description: "Naam, contactgegevens en website-instellingen", permission: "site.manage" },
  { id: "team", label: "Team & toegang", description: "Teamleden en SITE-rechten", permission: "site.team.manage" }
] as const satisfies ReadonlyArray<{ id: string; label: string; description: string; permission: Permission }>;
