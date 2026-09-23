export const appTabs = [
  { id: "app-home", label: "Accueil", description: "Bienvenue dans l’application Chiro", permission: "app.access" },
  { id: "app-agenda", label: "Agenda", description: "Activités et événements internes", permission: "events.read" },
  { id: "app-tasks", label: "Tâches", description: "Mes tâches et coordination d’équipe", permission: "app.access" },
  { id: "app-finance", label: "Comptes", description: "Dettes, dépenses partagées et remboursements", permission: "finance.access" },
  { id: "app-members", label: "Membres", description: "Membres Chiro et accès APP", permission: "members.read" },
  { id: "app-notifications", label: "Notifications", description: "Vos rappels privés", permission: "app.access" },
  { id: "app-settings", label: "Paramètres", description: "Application, notifications et appareils", permission: "app.access" }
] as const;
