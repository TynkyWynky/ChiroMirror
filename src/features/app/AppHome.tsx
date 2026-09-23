import type { AppAccess } from "./types";

export default function AppHome({ userName, access }: { userName: string; access: AppAccess }) {
  return <section class="admin-panel" lang="fr">
    <header class="admin-page-heading">
      <div><p class="admin-eyebrow">APP</p><h1>Bienvenue, {userName}</h1>
        <p>Bienvenue dans l’espace interne de la Chiro.</p></div>
    </header>
    <div class="admin-subpanel"><h2>Vos accès</h2>
      <p>{access.member ? `Membre lié : ${access.member.first_name} ${access.member.last_name}${access.member.active ? "" : " (inactif)"}` : "Votre compte n’est pas lié à un membre Chiro."}</p>
      <p>Rôles APP : {access.roles.map(role => role.label).join(", ") || "Aucun"}</p>
      <p>L’adhésion, les rôles APP et les accès SITE sont gérés séparément.</p>
    </div>
  </section>;
}
