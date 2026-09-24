export const appTabs = [
  { id: "app-home", label: "Start", description: "Welkom in de Chiro-app", permission: "app.access" },
  { id: "app-agenda", label: "Agenda", description: "Interne activiteiten en evenementen", permission: "events.read" },
  { id: "app-tasks", label: "Taken", description: "Mijn taken en teamcoördinatie", permission: "app.access" },
  { id: "app-finance", label: "Rekeningen", description: "Schulden, gedeelde uitgaven en terugbetalingen", permission: "finance.access" },
  { id: "app-members", label: "Leden", description: "Chiro-leden en APP-toegang", permission: "members.read" },
  { id: "app-notifications", label: "Meldingen", description: "Je persoonlijke herinneringen", permission: "app.access" },
  { id: "app-settings", label: "Instellingen", description: "App, meldingen en apparaten", permission: "app.access" }
] as const;
