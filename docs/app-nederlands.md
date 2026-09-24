# APP en néerlandais

Toute l’interface APP utilise désormais le néerlandais : accueil, navigation PC et mobile, agenda, tâches, comptes, membres, formulaires, validations, notifications, installation et écran hors ligne. Les dates et les montants utilisent `nl-BE`, avec le fuseau `Europe/Brussels`.

Les catégories standard de l’agenda s’affichent aussi en néerlandais lorsque la base renvoie encore leurs anciens libellés français. Les contenus saisis par les utilisateurs ne sont pas traduits.

## Base APP déjà installée

Dans le SQL Editor du même projet Supabase, exécuter le contenu complet de [20260924000100_app_dutch.sql](../supabase/migrations/20260924000100_app_dutch.sql). Ne pas relancer `install-app.sql` ni `schema.sql`.

Cette migration traduit les catégories standard, les nouvelles notifications de test et le texte générique des notifications Push. Elle conserve les droits d’accès, les comptes et l’historique. Elle peut être réexécutée. Les anciennes notifications déjà enregistrées conservent leur texte.

Pour une première installation, `install-app.sql` inclut déjà cette migration.

## Mise en ligne

Déployer la nouvelle version du site et de ses fonctions Netlify. Une application déjà ouverte propose ensuite **Nieuwe versie beschikbaar → Bijwerken**. Sur PC, l’installation reste accessible via **APP → Instellingen → App installeren**, lorsque le navigateur la propose.

## Vérifications locales

- 76 tests automatisés réussis, dont la localisation des anciennes catégories et du manifeste.
- Tests SQL des notifications réussis : messages néerlandais, droits d’accès et confidentialité conservés.
- Tests navigateur réussis : agenda, tâches, comptes, notifications, authentification et PWA sur PC et en vue mobile.
- Tests HTTP réussis : pages publiques, connexion, manifeste, serviceworker, écran hors ligne et validation du formulaire de contact.
- `astro check` : aucune erreur ni avertissement. Compilation de production et contrôles Netlify réussis.
- Test navigateur de la version compilée réussi : chargement interactif, connexion PC, formulaire de contact simulé et disposition mobile.

Les tests utilisent des bases temporaires et des services simulés. Aucune notification Push réelle ni invitation n’a été envoyée. La migration distante et le déploiement ne sont pas effectués par ces tests.
