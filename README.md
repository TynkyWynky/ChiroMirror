# Chiro Negenmanneke Website

Nieuwe Astro/Supabase-versie van de site met:

- gewone login voor de leiding via `/admin/`
- verborgen login-link in de footer
- CRUD voor groepen, contactblokken, liedjes en posts
- beheerbare vaste pagina's zoals home, inschrijven, kamp, verhuur, verzekering en privacy
- contactformulier dat berichten opslaat in de admin

## Stack

- `Astro` + `@astrojs/netlify`
- `Supabase Auth` voor e-mail/wachtwoord login
- `Supabase Postgres` voor content
- `Supabase Storage` voor afbeeldingen
- `Preact` voor de admin-interface

## Lokale start

1. Installeer dependencies:

```bash
npm install
```

2. Maak een `.env` op basis van `.env.example`.

3. Start lokaal:

```bash
npm run dev
```

Controleer de code ook even met:

```bash
npm run check
```

## Supabase setup

1. Maak een nieuw Supabase-project.
2. Open de SQL editor en voer `supabase/schema.sql` volledig uit.
3. Maak in `Authentication > Users` eerst je eigen account aan of nodig jezelf uit.
4. Zet in `Authentication > URL Configuration` minstens deze redirect URLs:

- `http://localhost:4321/admin/`
- `http://localhost:4321/admin/auth-action/`
- `https://www.chironegenmanneke.be/admin/`
- `https://www.chironegenmanneke.be/admin/auth-action/`

5. Vul in `.env` deze variabelen in:

```env
PUBLIC_SUPABASE_URL=...
PUBLIC_SUPABASE_ANON_KEY=...
PUBLIC_SITE_URL=https://www.chironegenmanneke.be
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAIL=jouw@adres.be
```

6. Seed de huidige website-inhoud in Supabase:

```bash
npm run seed
```

Als `ADMIN_EMAIL` overeenkomt met een bestaande user, wordt die gebruiker meteen `admin`.

Belangrijk:

- Rerun `supabase/schema.sql` ook wanneer je latere updates uit deze repo binnenhaalt.
- Als een `SUPABASE_SERVICE_ROLE_KEY` ooit zichtbaar gedeeld werd, roteer die meteen in Supabase en update daarna `.env` en Netlify.
- Zet in `Authentication > URL Configuration` ook de `Site URL` zelf op `https://www.chironegenmanneke.be` en niet op een localhost-adres. De tekst in Supabase invite-mails gebruikt die waarde letterlijk.

## Netlify setup

Zet dezelfde environment variables ook in Netlify:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Laat `ADMIN_EMAIL` weg in Netlify.
Die variabele wordt alleen gebruikt door `npm run seed` om lokaal een bestaande gebruiker admin te maken. Omdat dit e-mailadres ook publiek op de site kan staan, kan Netlify het anders als "exposed secret" blokkeren.

Build command:

```bash
npm run check && npm run build
```

Publish directory:

```bash
dist
```

Node version:

```bash
22.13.0
```

Netlify Forms:

- De contactpagina stuurt opnieuw een formulier door met form name `contact`.
- Voeg in Netlify bij `Forms` een e-mailnotificatie toe naar het adres van Negenmanneke als die nog niet bestaat.
- Hetzelfde bericht wordt tegelijk in de admin-tab `Berichten` opgeslagen.

## Eerste login

- Open `/admin/` of klik op de subtiele footer-link `Leiding`.
- Log in met het account dat je in Supabase hebt aangemaakt.
- Een `admin` kan daarna andere leiders uitnodigen vanuit de tab `Team`.
- Uitnodigingen en wachtwoord resets landen eerst op `/admin/auth-action/` en gaan daarna automatisch door naar `/admin/`, waar de gebruiker meteen een nieuw wachtwoord kan instellen.

## Betrouwbare Invite-Mails

Supabase invite-links kunnen ongeldig worden als een mailscanner de standaardlink vooraf opent. Gebruik daarom in `Authentication > Email Templates > Invite user` best deze link naar de nieuwe auth-action pagina:

```html
<h2>Je bent uitgenodigd</h2>
<p>Klik hieronder om je account te activeren en een wachtwoord te kiezen.</p>
<p>
  <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">
    Account activeren
  </a>
</p>
```

## Belangrijke scripts

```bash
npm run dev
npm run check
npm run build
npm run preview
npm run import:legacy
npm run seed
```

## Inhoudsmodel

De seed en fallback-inhoud komt uit:

- `src/data/default-content.json`

Database-tabellen:

- `site_settings`
- `page_content`
- `groups`
- `contact_sections`
- `songs`
- `posts`
- `contact_messages`
- `profiles`

## Opmerking

- Het contactformulier verstuurt opnieuw via Netlify Forms een mailnotificatie en slaat het bericht tegelijk op in de admin-tab `Berichten`.
- Publieke pagina's lezen bewust via de publieke Supabase-sleutel; de service key wordt alleen server-side gebruikt voor admin-acties en het contact endpoint.
