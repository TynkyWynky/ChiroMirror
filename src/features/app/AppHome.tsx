import type { AppAccess } from "./types";

export default function AppHome({ userName, access }: { userName: string; access: AppAccess }) {
  return <section class="admin-panel" lang="nl">
    <header class="admin-page-heading">
      <div><p class="admin-eyebrow">APP</p><h1>Welkom, {userName}</h1>
        <p>Welkom in de interne omgeving van de Chiro.</p></div>
    </header>
    <div class="admin-subpanel"><h2>Je toegang</h2>
      <p>{access.member ? `Gekoppeld lid: ${access.member.first_name} ${access.member.last_name}${access.member.active ? "" : " (inactif)"}` : "Je account is niet gekoppeld aan een Chiro-lid."}</p>
      <p>APP-rollen: {access.roles.map(role => role.label).join(", ") || "Geen"}</p>
      <p>Het lidmaatschap, de APP-rollen en de SITE-toegang worden afzonderlijk beheerd.</p>
    </div>
  </section>;
}
