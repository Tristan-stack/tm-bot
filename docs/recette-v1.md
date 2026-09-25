# Recette V1 — Launch Bot sur devnet (V1-46)

Recette de la V1 contre les critères d'acceptation du §15 de `context_bot.md`, la règle d'affichage du §4.5 et les conventions du §14. Elle rassemble les preuves automatisées, les scénarios manuels à exécuter sur devnet, les écarts trouvés et les décisions encore ouvertes. C'est la condition de démarrage de la V2 (V2-01).

|           |                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date      | 25/09/2026                                                                                                                                                                     |
| Base      | `develop` au commit `3cd2830` (V1-38 `/announce`), plus les changements de V1-46 (commit à venir)                                                                              |
| Périmètre | V1-01 à V1-45. **V1-39 (post du canal Succès) est en cours chez le collègue de Tristan** : voir [§10](#10-v1-39-en-cours)                                                      |
| Statut    | Preuves automatisées : **44 critères sur 44 couverts** (le 4 est retiré par D23). Scénarios manuels : R1 exécuté pour sa partie garde-fou, **R2 à R10 à exécuter par Tristan** |

Légende des statuts :

- ✅ **Prouvé** : un test automatisé couvre tout le critère ; il passe le 25/09/2026 sur la base ci-dessus.
- 🟡 **Prouvé, à confirmer sur devnet** : les tests couvrent le critère, le scénario manuel de la carte reste à cocher (bout en bout, vrai Telegram, vraie chaîne).
- ⏳ **Manuel** : seule l'exécution sur devnet peut le prouver.

## 1. Rejouer la recette

| Commande                                                                                                       | Ce qu'elle prouve                                                                 | Résultat du 25/09/2026                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build` sur un clone propre | Qualité (§14), les tests sans base                                                | Vert sur un clone de `3cd2830` dans `C:\dev\rc` avec les changements de V1-46 appliqués (voir [§5.4](#54-qualité))                                                                                               |
| `pnpm db:up` puis `pnpm test:db`                                                                               | Les mêmes tests, plus les tests d'intégration PostgreSQL                          | 154 fichiers, 2 078 tests verts, 4 ignorés (les tests devnet), après D24                                                                                                                                         |
| `pnpm test:devnet` (optionnel)                                                                                 | Les tests qui parlent au devnet public (V1-13, V1-21)                             | Solde réel lu ✓, compte Global de pump.fun lu et décodé ✓ ; transfert de 0.001 SOL ignoré : le faucet a refusé l'airdrop (429). Les 4 retraits réels de Tristan le couvrent ([§7](#7-frais-observés-sur-devnet)) |
| `pnpm check:i18n`                                                                                              | Aucun texte affiché hors `packages/shared/src/i18n/en.ts` (§14)                   | 0 texte hors `en.ts`                                                                                                                                                                                             |
| `pnpm screens:catalog`                                                                                         | Le catalogue des écrans à relire, dans `scripts/out/screens.html` (non versionné) | 49 écrans, 1 302 messages, tous conformes aux règles du §4.5                                                                                                                                                     |

## 2. Outils ajoutés par V1-46

Ils restent en place pour la V2.

- **Règles du §4.5 sur chaque message des tests** : `packages/shared/src/server/screen-rules.ts` (`screenIssues`, exporté par `@launchbot/shared/test`). Le faux transport Telegram des tests du bot (`interceptApi` de `apps/bot/src/test-harness.ts`) vérifie chaque message envoyé à un utilisateur. Un test qui dessine un écran fautif échoue, avec la règle enfreinte :
  - en-tête qui s'ouvre sur le nom de l'écran en gras (sans nom de réseau depuis D24) ;
  - du texte au-dessus du clavier en plus de l'en-tête ;
  - 4 096 caractères au plus, 1 024 pour une légende ;
  - HTML accepté par Telegram (balises connues et fermées, `&` échappé) ;
  - aperçus de liens désactivés ;
  - callback data de 64 octets au plus ;
  - alerte de 200 caractères au plus.

  Les messages du worker ont leur propre test (`apps/worker/src/screens.test.ts`). Les tests de la navigation elle-même, dont les écrans sont factices, s'en retirent avec `interceptApi(bot, replies, { screens: false })`.

- **Catalogue d'écrans** : `pnpm screens:catalog` (`scripts/screens-catalog.ts`). Il relance les tests du bot et du worker en enregistrant chaque message (`catalogScreen`), puis écrit une page HTML :
  - les messages sont regroupés par écran, avec leurs variantes, leur clavier et les tests qui les produisent ;
  - les réponses aux clics (alertes et toasts) sont listées à part ;
  - les clés et seeds de test de `/getall` sont masquées.
- **Contrôle i18n** : `pnpm check:i18n` (`scripts/check-i18n.ts`, API du compilateur TypeScript). Il parcourt `apps/bot/src`, `apps/worker/src` et `packages/shared/src` (hors `i18n/`, `server/`, vocabulaire du générateur et ligne de commande des jobs) et refuse deux choses :
  - `sent` : une chaîne littérale passée à Telegram, à un écran (`renderScreen`, `renderInputScreen`, `tree`…) ou à un bouton ;
  - `sentence` : une phrase écrite ailleurs que dans une erreur, un log, du SQL ou un message zod.

  Son test (`scripts/check-i18n.test.ts`) le fait tourner sur tout le dépôt : il fait partie de `pnpm test`.

- **Scan des logs** :
  - `apps/bot/src/no-secrets-in-logs.test.ts` : logger en `debug`, sortie debug de grammY activée (`DEBUG=grammy*`) ;
  - `packages/solana/src/tx/no-secrets-in-logs.test.ts` : la signature d'un transfert, en `debug`.
- **Callback data** : `apps/bot/src/callback-data.test.ts`. Chaque builder de chaque domaine est appelé avec ses arguments les plus longs (cuid de 25 caractères, nonce de 16, id Telegram de 19 chiffres), soit 123 variantes.

## 3. Critères du §15 et preuves

Toutes les preuves automatisées ont été exécutées le 25/09/2026 sur `3cd2830` + V1-46. La colonne « Ticket » donne le ticket qui a écrit la preuve ; son commit se trouve avec `git log --grep "V1-xx"`. « V1-46 » marque une preuve ajoutée par cette recette. Les tests `*.int.test.ts` ne tournent qu'avec `pnpm test:db`.

### Interface

| #   | Critère                                                                                    | Preuve automatisée                                                                                                                                                                                                                                                                                                                                                 | Manuel                                        | Ticket        | Statut |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------- | ------ |
| 1   | Aucun écran n'affiche seulement des boutons : description et infos au-dessus du clavier    | `packages/shared/src/ui/ui.test.ts` › renderScreen › « refuses a screen with neither description nor info » ; **tous les messages de tous les tests** du bot et du worker passent `screenIssues` (règle « nothing but the header above the keyboard »)                                                                                                             | Catalogue relu ([§4](#4-revue-45-des-écrans)) | V1-03, V1-46  | ✅     |
| 2   | Tout blocage (fonds, info manquante, Premium) est écrit à l'écran, pas seulement en alerte | `navigation.test.ts` › blockWithFlag ; fonds : `launch.test.ts` (étapes 1/4 et 2/4), `pay.test.ts` « a wallet that cannot pay », `withdraw.test.ts` ; info manquante : `token-step.test.ts` « Continue without a name and a ticker » ; Premium : `ai-hooks.test.ts` « without Premium: the alert, the flag… » ; les 13 flags du §4.5 ([§4.3](#43-les-flags-du-45)) | R4 à R7                                       | V1-10 à V1-37 | 🟡     |

### Accès

| #   | Critère                                                                       | Preuve automatisée                                                                                                                                                | Manuel | Ticket       | Statut |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------ | ------ |
| 3   | Pas de menu avant d'avoir rejoint le canal du bot                             | `features/access/access.test.ts` › access gate, I've joined, /start ; `services/channel-membership.test.ts` « fails closed on a Telegram error »                  | R2     | V1-06, V1-41 | 🟡     |
| 4   | ~~Une nouvelle version des Terms redemande l'acceptation~~                    | Retiré du §15 le 25/09/2026 (D23)                                                                                                                                 | —      | V1-41        | —      |
| 5   | À l'entrée de Launch Coin, un utilisateur sorti du canal revoit l'écran canal | `launch.test.ts` › the entry › « stops at the channel screen with its note; « I've joined » resumes without a second check » ; `access.test.ts` › resume registry | R2     | V1-35        | 🟡     |
| 6   | Dans un groupe ou un canal, le bot n'exécute rien                             | `bot.test.ts` › privateOnly › « performs no action on %s » (groupe, supergroupe, clic en groupe, post de canal, autre bot)                                        | R2     | V1-04        | 🟡     |

### Accueil

| #   | Critère                                                         | Preuve automatisée                                                                                                                                                                                                                                             | Manuel                   | Ticket              | Statut |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------- | ------ |
| 7   | Le compteur affiche le nombre réel d'abonnements actifs         | `subscriptions.int.test.ts` › countActiveSubscribers (requête réelle, cache 60 s) ; `home.test.ts` › home handlers › « shows the number of active subscribers the database counts (§15) » (**V1-46**)                                                          | R3 (SQL de comparaison)  | V1-07, V1-46        | 🟡     |
| 8   | Prix SOL muet depuis 10 min → montants USD masqués              | `packages/solana/src/price/sol-usd.test.ts` « serves the last price 9 min after it… null after 10 min » ; `home.test.ts` « hides every USD amount when the price is unknown » ; `wallets.test.ts`, `caption.test.ts`, `user-data.test.ts`                      | R3 (hôte du prix bloqué) | V1-07               | 🟡     |
| 9   | Refresh met à jour les soldes, au plus une fois toutes les 10 s | `home.test.ts` › home handlers › « reads fresh balances again for a Refresh 10 s after the previous one (§15) » (**V1-46** : relit à 0 s, cache à 9,999 s, relit à 10 s) ; `wallets.test.ts`, `launch.test.ts` « two Refresh within 10 s read the chain once » | R3                       | V1-07, V1-08, V1-46 | 🟡     |

### Simulation

| #   | Critère                                                                                                              | Preuve automatisée                                                                                                                                                                                                                                                                                                                                                            | Manuel                              | Ticket               | Statut |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------- | ------ |
| 10  | Même seed, mêmes paramètres : mêmes trades                                                                           | `packages/sim-engine/src/simulation.test.ts` « replays the same run from the same config, whatever the slicing », « replays the same run with a dev buy of 1 SOL and a bundle (D22) » (**V1-46**) ; `flow.test.ts`, `rng.test.ts`, `dmath.test.ts` ; `sim-runner.test.ts` « plays the same trades as the engine in one go, at x1 and at x5 »                                  | —                                   | V1-18 à V1-20, V1-26 | ✅     |
| 11  | Sans vente du dev, 1 000 seeds par preset : prix final au-dessus du prix après les achats du dev (dev buy et bundle) | `apps/bot/src/services/simulation.test.ts` › « acceptance (§15, D22) » › 1 SOL + bundle **3, 5, 10 et 20 SOL** (config réelle de `buildSimConfig`), seeds 1 à 1 000 : 1 000/1 000 au-dessus (**V1-46**, pire ratio observé ×1,25) ; l'ancien modèle reste couvert (`simulation.test.ts` et `flow.test.ts` du moteur, dev buy 3/5/10 sans bundle, pour les lignes d'avant D22) | —                                   | V1-19, V1-20, V1-46  | ✅     |
| 12  | Arrêt à 3 min simulées, à 100 % vendu ou à la fin de la curve                                                        | `simulation.test.ts` (moteur) « ends on timeout at 180 s… », « ends on position_closed… », « ends on curve_complete… » ; `live.test.ts` « closes the position with Sell 100%… »                                                                                                                                                                                               | R5                                  | V1-20, V1-26         | 🟡     |
| 13  | Vente du dev par la formule de la curve, impact et frais inclus                                                      | `simulation.test.ts` (moteur) « sells the dev's tokens through the curve: the vectors of the card » ; `curve.test.ts` « selling the dev buy back at once returns 2.9403 SOL… »                                                                                                                                                                                                | —                                   | V1-18, V1-20         | ✅     |
| 13b | Message de simulation et PNL card envoyés avec `protect_content`                                                     | `live.test.ts` « sends the protected photo… » (`protect_content: true`) ; « closes the position with Sell 100%… » : la carte est `editMessageMedia` du **même** message protégé, jamais un message à part (**V1-46**)                                                                                                                                                         | R5 (ni transfert ni enregistrement) | V1-26, V1-46         | 🟡     |

### Générateur

| #   | Critère                                                                    | Preuve automatisée                                                                                                                                                                                         | Manuel             | Ticket              | Statut |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------- | ------ |
| 14  | Chaque Generate propose un token différent, dans les limites               | `packages/shared/src/token/generator.test.ts` « stays within the limits over 10 000 generations », « never repeats the name or the ticker of the previous draft » ; `token-step.test.ts`                   | R5 (20 × Generate) | V1-15               | 🟡     |
| 15  | Sans Premium, 🔒 AI Generate : alerte Premium, rien de généré              | `ai-hooks.test.ts` « without Premium: the alert, the flag, nothing generated, no row » ; `ai-generate.test.ts`                                                                                             | R5                 | V1-17               | 🟡     |
| 16  | Sans IA branchée : mention « coming soon » sur l'écran Token et les offres | `ai-hooks.test.ts` « shows the coming soon mention to everyone… » ; `subscribe.test.ts` › offer clicks › « says « coming soon » while the bot has no AI provider, as in V1 (§15) » (**V1-46**, par le bot) | R5, R6             | V1-17, V1-29, V1-46 | 🟡     |

### Parcours

| #   | Critère                                                                     | Preuve automatisée                                                                                                                                                                                                                                                                               | Manuel | Ticket               | Statut |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------- | ------ |
| 17  | Chaque écran de parcours affiche le compteur d'étape et le résumé des choix | `ui.test.ts` › flowHeader ; écrans des parcours Simulation, Launch, Withdraw (`simulation/screens.test.ts`, `launch/screens.test.ts`, `withdraw.test.ts`) ; `launch.test.ts` › « keeps the choices above Edit and above each field input of the Token step (§15) » (**V1-46**, écart E2 corrigé) | R5, R7 | V1-16 à V1-37, V1-46 | 🟡     |

### Wallets

| #   | Critère                                                                                                                       | Preuve automatisée                                                                                                                                                                                                                                                      | Manuel                   | Ticket               | Statut |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------- | ------ |
| 18  | Message d'import (clé ou seed) supprimé, valide ou non                                                                        | `import.test.ts` › import handlers, sensitive message guard, no leak                                                                                                                                                                                                    | R4                       | V1-12                | 🟡     |
| 19  | Une seed donne la même adresse que Phantom (premier compte)                                                                   | `packages/solana/src/keys/derivation.test.ts` « gives the address Phantom shows for the 12-word vector » (+ 24 mots, vecteurs SLIP-0010) ; `wallets.int.test.ts` « derives the Phantom address of a phrase… »                                                           | R4 (seed Phantom)        | V1-09                | 🟡     |
| 20  | Un wallet qui permet encore un retrait ne se supprime pas                                                                     | `wallets.test.ts` › delete handlers ; `packages/db/src/services/wallets.test.ts` › checkDeletable ; `wallets.int.test.ts` › delete                                                                                                                                      | R4                       | V1-11                | 🟡     |
| 21  | Retrait laissant entre 0 et le minimum rent-exempt : refusé avant l'envoi                                                     | `packages/solana/src/tx/transfer.test.ts` › validateTransfer « refuses to leave dust under the rent-exempt minimum » ; `withdraw.test.ts` › withdraw handlers › « refuses an amount that would leave dust under the rent minimum, with nothing sent (§15) » (**V1-46**) | R4                       | V1-13, V1-14, V1-46  | 🟡     |
| 22  | Chaque saisie (nom, adresse, montant, clé) a « ❌ Cancel »                                                                    | `ui.test.ts` « refuses an input screen without Cancel » (`renderInputScreen` refuse un écran de saisie sans Cancel ; toutes les saisies du bot passent par lui) ; écrans de saisie testés un par un (rename, retrait, import, champs Token, Custom, `/announce`)        | R4                       | V1-03, V1-10 à V1-14 | 🟡     |
| 43  | Wallet créé : seed de 12 mots ; seed et clé privée rendues par `/getall` → même adresse dans Phantom (décision du 16/09/2026) | `derivation.test.ts` « creates a 12-word English phrase that imports back to the same address » ; `vault.test.ts` ; `wallets.int.test.ts` « stores a wallet the vault can give back to /getall » ; `user-data.test.ts` « reveals each key and phrase once… »            | R4 (import dans Phantom) | V1-09, V1-10, V1-43  | 🟡     |

### Subscribe

| #   | Critère                                                                                     | Preuve automatisée                                                                                                                                                                                                                                                        | Manuel | Ticket              | Statut |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------- | ------ |
| 23  | Une adresse de dépôt par facture, montant SOL figé 30 min                                   | `payments.int.test.ts` › createInvoice « freezes the price of the moment for 30 minutes on a new deposit address » ; `constraints.int.test.ts` ; `worker.int.test.ts` « a pending invoice expires at 30 minutes »                                                         | R6     | V1-28               | 🟡     |
| 24  | Facture payée : une seule activation, même si le worker et « I've paid » la voient ensemble | `payments.int.test.ts` › concurrency (§15) ; `subscription-activation.int.test.ts` (50 tours parallèles) ; `worker.int.test.ts` « a tick and « I've paid » at the same time: one plan » ; `wallet-payments.int.test.ts` « two Confirms of one invoice at once: one send » | R6     | V1-27, V1-28, V1-32 | ✅     |
| 25  | Paiement partiel : rien d'activé, reste affiché                                             | `invoice.test.ts` (shared et bot) ; `payments.int.test.ts` « reports a partial payment with the exact rest » ; `worker.int.test.ts` « a partial payment is recorded, nothing activates »                                                                                  | R6     | V1-28, V1-30        | 🟡     |
| 26  | Racheter la même offre prolonge au lieu de remplacer                                        | `packages/shared/src/subscription/rules.test.ts` « extends the same plan… » ; `subscription-activation.int.test.ts` « is extended by a payment of the same plan »                                                                                                         | R6     | V1-27               | 🟡     |
| 27  | Sans prix SOL, aucune facture                                                               | `payments.int.test.ts` « creates nothing without a SOL price » ; `features/subscribe/invoice.test.ts` « refuses %s: alert, and the offers with the line »                                                                                                                 | R3     | V1-28               | 🟡     |
| 28  | Facture annulée ou expirée, payée en entier dans les 24 h : activée                         | `invoice.test.ts` (shared) ; `payments.int.test.ts` « accepts a full payment up to 24 h after the expiry, not after » ; `worker.int.test.ts` « a canceled invoice paid in full within its 24 h activates, not after »                                                     | R6     | V1-28, V1-32        | 🟡     |
| 29  | Classic → Premium : avertissement avant la facture                                          | `subscribe.test.ts` › warning Classic → Premium, offer clicks « warns before Premium during Classic… »                                                                                                                                                                    | R6     | V1-29               | 🟡     |

### Launch Coin

| #   | Critère                                                                                      | Preuve automatisée                                                                                                                                                                                                                            | Manuel | Ticket       | Statut |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------ | ------ |
| 30  | Sans abonnement actif : renvoi vers Subscribe                                                | `launch.test.ts` › the entry « sends %s to the offers, with the note », « a plan that ends mid-flow… »                                                                                                                                        | R7     | V1-35        | 🟡     |
| 31  | Solde insuffisant : montant manquant affiché, suite bloquée                                  | `launch.test.ts` (étapes 1/4 et 2/4, Custom) ; `launch/screens.test.ts` ; `packages/shared/src/launch/funds.test.ts`                                                                                                                          | R7     | V1-35, V1-36 | 🟡     |
| 32  | Dev buy fixe 1 SOL ; bundle Custom hors 3–20 SOL refusé, en simulation comme au launch (D22) | `services/simulation.test.ts` « buys 1 SOL then the bundle… » ; `sim-inputs.test.ts` › parseBundleAmount « refuses %j » ; `funds.test.ts` › parseLaunchBundleInput ; `simulation.test.ts` (bot) et `launch.test.ts` (Custom refusé avec flag) | R5, R7 | V1-22, V1-36 | 🟡     |

### Support et admin

| #   | Critère                                                                                                                    | Preuve automatisée                                                                                                                                                                                                                         | Manuel                         | Ticket | Statut |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------ | ------ |
| 33  | Le code support correspond à l'offre actuelle                                                                              | `features/support/support.test.ts` ; `support-code.test.ts` ; `user-data.test.ts` « flags a code that does not say the plan of now »                                                                                                       | R8                             | V1-40  | 🟡     |
| 34  | Commandes admin réservées à `ADMIN_TELEGRAM_IDS`                                                                           | `guard.test.ts` « answers nothing to /%s from anyone else, and logs the denial » (5 commandes), clics et saisies admin ; `env.test.ts`                                                                                                     | R8                             | V1-38  | 🟡     |
| 35  | `/announce` ne publie rien sans aperçu et confirmation                                                                     | `announce.test.ts` (aperçu, Publish sans canal refusé, Cancel, anciens brouillons inactifs, une seule publication)                                                                                                                         | R8 (fait par Tristan le 25/09) | V1-38  | 🟡     |
| 36  | `/grant` montre un résumé avant d'activer                                                                                  | `grant.test.ts` (NEW, EXTEND, UPGRADE, REFUSED, Confirm, Cancel, plan changé entre-temps)                                                                                                                                                  | R8                             | V1-42  | 🟡     |
| 37  | `/purge` transfère d'abord les SOL à la trésorerie ; une facture payable le bloque                                         | `purge.test.ts` (ordre : sweep, avis à l'utilisateur, suppression ; échec du sweep → rien supprimé) ; `account-deletion.int.test.ts` ; `inactive-accounts.int.test.ts` « a purge moves the SOL of an active account, as PURGE_SWEEP rows » | R8                             | V1-44  | 🟡     |
| 44  | `/getall` : fiche sans secret, clé et seed après « Reveal keys », message supprimé après 60 s (aussi après un redémarrage) | `user-data.test.ts` (fiche sans clé, révélation unique, suppression planifiée entre 60 et 65 s) ; `sensitive-sweeper.test.ts` ; `support-data.int.test.ts` « keeps the keys messages due for the sweeper, across a restart »               | R8 (redémarrage réel)          | V1-43  | 🟡     |

### Données

| #   | Critère                                                                                                                                                    | Preuve automatisée                                                                                                                                                                                                                     | Manuel | Ticket       | Statut |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------ | ------ |
| 38  | Compte inactif 24 h supprimé, même avec abonnement, facture ou fonds ; admins exemptés ; SOL transférés d'abord à la trésorerie, tracés avec l'ID Telegram | `packages/shared/src/inactivity.test.ts` ; `retention.test.ts` ; `inactive-accounts.int.test.ts` « moves the SOL to the treasury, then deletes the account… » ; `support-data.int.test.ts`                                             | R9     | V1-45        | 🟡     |
| 39  | Aucun avertissement avant la suppression d'un compte inactif                                                                                               | `apps/worker/src/jobs/retention.test.ts` › « sends nothing to the user, before or after the deletion of their account (§15) » (**V1-46** : le job reçoit un envoyeur complet et n'appelle que les admins, et pas pour une suppression) | R9     | V1-45, V1-46 | 🟡     |

### API, transactions, démarrage

| #   | Critère                                                                  | Preuve automatisée                                                                                                                                                                                                                                                                                    | Manuel                | Ticket       | Statut |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------ | ------ |
| 40  | Requête sous `/api` sans `initData` valide → 401                         | `apps/api/src/server.test.ts` › routes under /api « the same 401 for %s » ; › errors « answers 404 in JSON for an unknown route, 401 under /api without a valid initData », « answers 401 to anything under /api without a valid initData, with no route at all (D21) » (**V1-46**, écart E1 corrigé) | R10                   | V1-05, V1-46 | 🟡     |
| 41  | Chaque transaction estime sa priority fee avant l'envoi, dans les bornes | `priority-fee.test.ts` « stays inside the bounds of the configuration » ; `send.test.ts` « decrypts the key only once everything is estimated, and to sign » ; `fees.test.ts` ; observé sur les 5 transferts réels du bot ([§7](#7-frais-observés-sur-devnet))                                        | R10 (borne max basse) | V1-13        | 🟡     |
| 42  | Le bot refuse de démarrer si le RPC n'est pas devnet                     | `bot.test.ts` › createBotService « never starts when the RPC is not devnet » ; `packages/solana/src/guard.test.ts` ; **R1 exécuté sur les vrais endpoints** le 25/09/2026 ([§6](#r1--démarrage))                                                                                                      | R1 (démarrage réel)   | V1-04        | 🟡     |

## 4. Revue §4.5 des écrans

### 4.1 Règles vérifiées sur chaque message

Chaque message envoyé par les 813 tests du bot et du worker passe `screenIssues` ([§2](#2-outils-ajoutés-par-v1-46)) : **aucune violation**. Au premier passage, le contrôle a relevé 33 cas :

- les écrans factices des tests de la navigation elle-même : exclus avec `screens: false` ;
- trois **avis** envoyés en texte simple, sans en-tête ni clavier :
  - l'avertissement du garde des messages sensibles (« ⚠️ Your message looked like a private key or seed phrase, so it was deleted. … ») ;
  - l'erreur générique (« ❌ Something went wrong. Please try again. ») ;
  - « Your data has been deleted. » envoyé par `/purge`.

  Ils ne portent pas le gabarit du §4.5 (voir l'écart ouvert [O2](#82-ouverts)). La règle retenue : un message **avec des boutons**, ou en HTML, est un écran complet ; un message sans bouton ni HTML est un avis, ou la copie d'un message de l'utilisateur (l'aperçu de `/announce`), contrôlé sur ses seules limites.

- l'aperçu de `/announce`, qui recopie le message de l'admin avec ses entités, sans `parse_mode` : c'est voulu.

Les valeurs saisies par un utilisateur sont échappées partout où elles s'affichent (test avec `<b>x</b> & co`) :

- noms de wallets et tokens : tests existants de `wallets`, `launch`, `simulation`, `token-step`, `pay`, `home` ;
- prénom et wallets dans `/whois`, `/getall` et `/purge` : ajoutés par V1-46 ;
- messages du worker : `apps/worker/src/screens.test.ts`, V1-46.

### 4.2 Navigation (Back, Menu, Cancel)

Relevé sur le catalogue (49 écrans, 1 302 messages) :

- Tout sous-écran des parcours a « ⬅️ Back » ou « ❌ Cancel ». Tout écran profond (récap, fin de simulation, résultats) a « 🏠 Menu ».
- Écrans sans aucun des trois, **par conception** :
  - l'accueil ;
  - l'écran canal (« 📢 Join channel » / « ✅ I've joined », pas de menu avant l'adhésion) ;
  - le message de simulation en direct (Sell, Pause, vitesse, §6.1) ;
  - le rappel de fin d'abonnement du worker (« 🔄 Renew » seul, §8.4).
- Messages sans clavier :
  - alertes admin (MANUAL REFUND, SWEEP FAILED, OLD DEPOSIT ADDRESS) ;
  - `/whois` ;
  - parties de `/getall` ;
  - message des clés (supprimé après 60 s) ;
  - écrans transitoires « Sending… » ;
  - résultat d'un `/grant` annulé.

### 4.3 Les flags du §4.5

| Flag (texte exact)                                                          | Clé `en.ts`                           | Test qui l'affiche à l'écran                                                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ℹ️ Not joined yet. Join the channel, then tap I've joined.`                | `access.channel.notJoined.flag`       | `access.test.ts` « alerts and writes the line on the screen when the user has not joined »                                                                                |
| `🕒 Updated 14:32 UTC`                                                      | `common.updated(time)`                | `home.test.ts` « renders the mockup of §4.3 »                                                                                                                             |
| `⚠️ Missing: name, ticker`                                                  | `token.missing(fields)`               | `token-step.test.ts` « Continue without a name and a ticker… »                                                                                                            |
| `🔒 AI Generate: Premium only`                                              | `token.ai.premiumOnly.flag`           | `ai-hooks.test.ts` « without Premium… »                                                                                                                                   |
| `🤖 AI model coming soon: AI Generate uses the standard generator for now.` | `token.ai.comingSoon`                 | `ai-hooks.test.ts` « shows the coming soon mention to everyone… »                                                                                                         |
| Ligne du wallet avec `⚠️ Insufficient funds (… missing)` (§8.3, §10.1)      | `subscribe.payFromWallet.walletShort` | `pay.test.ts` « lists the wallets, oldest first, with what each one lacks » ; `launch/screens.test.ts` « lists every wallet with whether it can pay the smallest launch » |
| Note `⚠️ INSUFFICIENT FUNDS` avec le wallet et le manque (dev buy + bundle) | `launch.bundle.insufficient`          | `launch/screens.test.ts` « after a click on a bundle too high: the note and Refresh »                                                                                     |
| `⏳ Waiting for payment · last check 14:32 UTC`                             | `subscribe.invoice.lastCheck(time)`   | `features/subscribe/invoice.test.ts` « after « I've paid »: the last check, then the time left »                                                                          |
| `Classic: available when your Premium ends`                                 | `subscribe.classicDuringPremium.flag` | `subscribe.test.ts` « refuses Classic during Premium: alert, and the line on the screen »                                                                                 |
| Compteur `2/5`, `limit reached` à la limite                                 | `wallets.counter(count, limit)`       | `wallets.test.ts` « counts %i/%i in the header: %s »                                                                                                                      |
| `🚧 Token creation arrives in V2.`                                          | `launch.recap.v2Notice`               | `launch/screens.test.ts` « sums up the launch, and says nothing is created in V1 »                                                                                        |
| `⚠️ A simulation is already running.`                                       | `sim.live.alreadyRunning.flag`        | `live.test.ts` « refuses a second simulation while one runs, with the flag on the recap »                                                                                 |
| `⚠️ The simulator is busy. Try again in a minute.`                          | `sim.live.busy.flag`                  | `live.test.ts` « refuses when the runner is full… »                                                                                                                       |

Le flag « Frais de vente insuffisants » (§10.3) est de la V2.

## 5. Contrôles transverses (§14)

### 5.1 Textes

- `pnpm check:i18n` : 0 texte hors `en.ts` après correction de l'écart E3.
- Restent hors `en.ts` par convention, et ce ne sont pas des textes :
  - les unités des formateurs de `packages/shared/src/format/` (`SOL`, `UTC`, noms des mois) ;
  - l'unité `SOL` de la légende de la PNL card (`solWithUsd` dans `simulation/caption.ts`, même convention).

### 5.2 Secrets

- **Bot** (`apps/bot/src/no-secrets-in-logs.test.ts`), avec le logger en debug et la sortie debug de grammY capturée :
  - flux déroulés :
    - `/getall` puis Reveal keys (vrai déchiffrement), dont un envoi refusé par Telegram, avec les clés dans le `payload` de l'erreur ;
    - import par clé et par seed ;
    - clé et seed envoyées hors import (en texte et en légende) ;
    - un retrait et un paiement depuis un wallet, jusqu'à l'envoi ;
  - rien trouvé : ni la clé base58, ni la seed (ni trois mots consécutifs), ni `BOT_TOKEN`, ni la clé de chiffrement (hex et base64), ni `encSecretKey` / `encMnemonic` ;
  - la sortie de grammY ne contient que « Processing update n » et les noms de méthodes.
- **Signature** (`packages/solana/src/tx/no-secrets-in-logs.test.ts`), celle de tout transfert V1 (retrait, paiement depuis un wallet, sweeps), en debug : aucune clé dans les logs, que l'envoi réussisse ou échoue. Six scénarios :
  - confirmé d'emblée ;
  - rediffusion refusée ;
  - blockhash expiré puis re-signature ;
  - transaction échouée on-chain ;
  - RPC coupé pendant la confirmation ;
  - simulation refusée.
- **Base** : `wallets.int.test.ts` (déjà là depuis V1-12) vérifie que la seed n'est ni stockée en clair ni loguée.
- Défenses en place :
  - pino masque les clés `text`, `caption`, `privateKey`, `seed`, `mnemonic`, `encSecretKey`, `BOT_TOKEN`… ;
  - le sérialiseur `err` ne garde que le nom et le message ;
  - chaque ligne est nettoyée des secrets d'environnement ;
  - `addSecretScrubber` (heuristiques clés et seeds) n'est pas branché, par décision de V1-12 (voir [O6](#82-ouverts)).
- À savoir : `DEBUG=grammy*` écrit sur stderr sans passer par pino. Le test montre qu'il n'y a pas de contenu de message, mais il ne faut pas l'activer en production.

### 5.3 Code

- `strict: true` dans `tsconfig.base.json`, plus `noUncheckedIndexedAccess`.
- **Toute saisie passe par zod** : non, c'est l'écart [O1](#82-ouverts).
  - Validées par un schéma zod : l'adresse de retrait (`solanaAddressSchema`), les arguments des commandes admin, le code d'offre et l'id de facture des callbacks, l'`initData` de l'API.
  - Validées par des parseurs purs testés de `shared`, un choix fait et noté ticket par ticket : le nom de wallet (`walletNameIssue`), le montant de retrait (`parseSolToLamports`), les champs Token (`parseTokenField`), le bundle Custom (`parseBundleAmount`, `parseLaunchBundleInput`), l'image (`imageFileIdOf`), `/announce` (`announceContentOf`), la clé et la seed (`parsePrivateKey`, `parseSeedPhrase`).
- En-têtes de parcours : tous par `ui.flowHeader` (Simulation, Launch, Withdraw).
  - Pay from my wallet n'est pas un parcours numéroté dans le §8.3 : `ui.screenHeader`, cohérent.
  - Les écrans « Sending », succès et échec du retrait viennent après les étapes : `screenHeader`, cohérent.
- Aucun `devnet` ni `?cluster=devnet` codé en dur dans le code de production hors de `packages/shared/src/cluster.ts`, après correction de l'écart E4. Les restes à trancher au passage mainnet sont dans [O4](#82-ouverts).

### 5.4 Qualité

- **Clone propre** (25/09/2026) : clone de `develop` dans `C:\dev\rc` (chemin court pour Windows), changements de V1-46 appliqués, sans `.env`. `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build` : **vert**.
  - Tests : 137 fichiers, 1 927 tests passés, 156 ignorés (base et devnet).
  - Build : bundle de la Mini App inchangé, 219,88 kB (68,71 kB gzip).
  - Un premier passage avait fait échouer un test de V1-46, qui supposait une longueur fixe pour une clé base58. Il a été corrigé avant le second passage.
- **Dépôt** : lint et typecheck verts, Prettier vert (seul `.claude/settings.local.json`, qui n'est pas au projet, est signalé), `pnpm test:db` vert (154 fichiers, 2 078 tests, après D24).
- Tests fragiles connus, verts seuls, lents sous la charge complète :
  - `generateLocalToken` sur 10 000 générations ;
  - l'API `GET /health` ;
  - la vidéo ffmpeg de la PNL card.

## 6. Scénarios manuels devnet (R0 à R10)

À exécuter par Tristan (le bot et le worker tournent sur son poste, avec son `.env`). Pour chaque scénario, noter la date, le commit et la preuve (capture, signature explorer) et cocher. Les textes attendus sont ceux de `en.ts`.

### R0 · Préparation

- [ ] Bot `@tm_launch_bot` **administrateur des 3 canaux** avec « Publier des messages » : Launch Bot community (`CHANNEL_BOT_ID`), Annonces (`CHANNEL_ANNOUNCEMENTS_ID`), Succès (`CHANNEL_SUCCESS_ID`). Le 25/09, le bot n'était pas admin de Succès : sans ça, le contrôle de démarrage le signale et V1-39 ne pourra pas publier.
- [ ] Un groupe de test avec le bot dedans.
- [ ] Deux comptes Telegram :
  - U, utilisateur ;
  - A, dont l'ID est dans `ADMIN_TELEGRAM_IDS`.

  Bot et worker redémarrés après tout changement de `ADMIN_TELEGRAM_IDS`.

- [ ] `.env` complet (§12), `SOLANA_CLUSTER=devnet`, `TREASURY_WALLET` devnet alimenté une fois, environ 10 SOL devnet (faucet.solana.com), une seed Phantom **de test**.
- [ ] `pnpm db:up`, `pnpm db:deploy`, puis bot et worker démarrés (`pnpm dev` ou deux terminaux).
- Délais longs : dates modifiées en base (SQL ci-dessous), jobs lancés à la main avec `pnpm --filter @launchbot/worker job accounts.delete-inactive|data.expired-cleanup [--now <date ISO>]`.

### R1 · Démarrage

Exécuté le 25/09/2026 pour la partie garde-fou : `assertDevnet` (celui que le bot et le worker appellent au démarrage) sur les vrais endpoints, sans `.env` ni token.

| Cas                                              | Résultat                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `SOLANA_CLUSTER=mainnet-beta`                    | Refusé : « Refusing to start: SOLANA_CLUSTER must be "devnet". »      |
| `devnet` + `https://api.mainnet-beta.solana.com` | Refusé : « …is not a devnet RPC (unexpected genesis hash). »          |
| `devnet` + `https://api.testnet.solana.com`      | Refusé : même message                                                 |
| `devnet` + RPC injoignable                       | Refusé : « …cannot reach SOLANA_RPC_URL to verify the cluster. »      |
| `devnet` + `https://api.devnet.solana.com`       | Accepté (hash genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) |

À faire par Tristan, bot et worker arrêtés (un seul poller par token) :

- [ ] `SOLANA_CLUSTER=mainnet-beta` dans `.env` → `pnpm --filter @launchbot/bot start` s'arrête avec le refus, sans poll.
- [ ] `SOLANA_CLUSTER=devnet` + `SOLANA_RPC_URL=https://api.mainnet-beta.solana.com` → arrêt (bot et worker).
- [ ] `.env` d'origine → démarrage.

### R2 · Accès

- [ ] U neuf `/start` → écran « 📢 ONE LAST STEP » (plus d'écran Terms depuis D23).
- [ ] « ✅ I've joined » sans avoir rejoint → alerte + `ℹ️ Not joined yet. Join the channel, then tap I've joined.`
- [ ] Rejoindre Launch Bot community → accueil, 5 lignes de menu, sans Terms ni Privacy.
- [ ] Quitter le canal → « 🚀 Launch Coin » → écran canal + « Join the channel to launch a coin. » → rejoindre → « I've joined » → reprise du parcours.
- [ ] Dans le groupe : `/start` et chaque commande admin (même par A) → aucune réponse.

### R3 · Accueil

- [ ] Compteur « ⭐ n active subscribers » = `SELECT count(DISTINCT "userId") FROM "Subscription" WHERE status = 'ACTIVE' AND "expiresAt" > now();` (écart possible de 60 s : cache).
- [ ] Alimenter un wallet, « 🔄 Refresh » deux fois en moins de 10 s (le second ne relit pas la chaîne), puis après 10 s → solde à jour et « 🕒 Updated HH:MM UTC ». Sans changement → toast « Already up to date ».
- [ ] Couper l'hôte de `SOL_PRICE_API_URL` sans redémarrer (Windows : ligne `127.0.0.1 api.coingecko.com` dans `C:\Windows\System32\drivers\etc\hosts`, puis `ipconfig /flushdns`), attendre plus de 10 min → `📈 SOL —`, aucun montant USD, nouvelle facture refusée (« Payments are temporarily unavailable. »). Retirer la ligne ensuite.

### R4 · Wallets

- [ ] Sans abonnement, Create jusqu'à 3 (D1) → « 👛 WALLETS · 3/3 · limit reached » + `⚠️ Wallet limit reached. Upgrade to get more.`
- [ ] Import par clé, puis par seed : invalide, doublon, valide → le message est toujours effacé, et le texte attendu s'affiche.
- [ ] Seed Phrase de test Phantom → même adresse que Phantom.
- [ ] Wallet à 2 SOL → Delete bloqué → « Withdraw all » (Max présélectionné).
- [ ] Retrait laissant entre 0 et 0.00089 SOL, ou moins de 0.00089 SOL vers une adresse vide → refusé sans signature.
- [ ] Retrait valide → lien explorer, `Withdrawal` CONFIRMED.
- [ ] « ❌ Cancel » sur le nom, l'adresse, le montant, la clé, la seed.
- [ ] Wallet créé par le bot → `/getall` (compte A) → Reveal keys → clé et seed importées dans Phantom → même adresse.

### R5 · Générateur et simulation

- [ ] 20 × Generate → tokens différents.
- [ ] Continue sans nom → alerte + `⚠️ Missing: name, ticker`.
- [ ] Sans Premium, « 🔒 AI Generate » → alerte + `🔒 AI Generate: Premium only`, rien ne change.
- [ ] Premium (`/grant`) → `🤖 AI model coming soon: …` + une ligne `AiGeneration`.
- [ ] Bundle Custom `2.5`, `21`, `abc` refusés.
- [ ] Récap : lignes Dev buy, Bundle et Total, et « DEMO — Bullish scenario. Not a prediction or a real result. »
- [ ] « ▶️ Start simulation » :
  - photo protégée (ni transfert ni enregistrement), mention DEMO en tête de légende ;
  - édition toutes les 3 s, Pause fige le chrono, x5 termine en environ 36 s ;
  - Sell 25 % fait baisser la bougie ;
  - Sell 100 % → PNL card animée **sur le même message**, sans bouton de partage ;
  - Run again repart à 0:00 ;
  - Menu ouvre l'accueil sous la carte.
- [ ] Redémarrer le bot puis cliquer sur une ancienne simulation → « This simulation is over ».

### R6 · Subscribe

- [ ] Offres sans abonnement → « AI token generator (AI model coming soon) ».
- [ ] Deux factures → deux adresses, montant figé 30 min.
- [ ] Payer la moitié → reçu + reste, rien d'activé.
- [ ] Compléter → activation + message du worker « ✅ Payment received ».
- [ ] « I've paid » aussitôt → une seule `Subscription` pour ce paiement.
- [ ] Racheter la même offre → `expiresAt` prolongé.
- [ ] Classic actif → Premium → `⚠️ Your remaining Classic time will be lost.`
- [ ] Premium actif → clic Classic → alerte + `Classic: available when your Premium ends`.
- [ ] Facture annulée puis payée en entier en moins de 24 h → activée.
- [ ] **« Pay from my wallet » → frais estimés, envoi** : jamais fait on-chain à ce jour (la seule facture payée l'a été depuis Phantom, [§7](#7-frais-observés-sur-devnet)).
- [ ] Sweep vers la trésorerie → `Payment.status` SWEPT (worker lancé).

### R7 · Launch Coin

- [ ] Sans abonnement → offres + `⭐ Launch Coin needs an active subscription.`
- [ ] Wallet à 0.4 SOL → `⚠️ Insufficient funds (3.600 SOL missing)` + note au clic.
- [ ] Wallet à 4.2 SOL, bundle 5 SOL → note « ⚠️ INSUFFICIENT FUNDS » (1.800 SOL missing) + Refresh, suite bloquée.
- [ ] Bundle Custom `2.5` et `21` refusés.
- [ ] Étapes 3 et 4 : compteur, choix déjà faits au-dessus (y compris sur Edit et les saisies du Token, corrigé par V1-46), récap Dev buy, Bundle et Total.
- [ ] « Create token » → alerte « Token creation arrives in V2. », rien de créé.

### R8 · Support et admin

- [ ] Code support `F-…`, puis `P-…` après `/grant`.
- [ ] U : `/announce`, `/grant`, `/whois`, `/getall`, `/purge` → aucune réponse.
- [ ] A : `/announce` → aperçu, rien publié avant Publish (fait le 25/09).
- [ ] `/grant` → résumé avec date de fin.
- [ ] `/whois` sans secret.
- [ ] `/getall` → fiche sans secret → Reveal keys → clé + seed, message supprimé après 60 s, **aussi après un redémarrage du bot**.
- [ ] `/purge` d'un compte avec des fonds → SOL à la trésorerie (`Withdrawal` PURGE_SWEEP) puis purge ; U reçoit « Your data has been deleted. ».

### R9 · Données

SQL (compte de U, par son ID Telegram) :

```sql
UPDATE "User" SET "lastActiveAt" = now() - interval '23 hours' WHERE "telegramId" = <id>;
UPDATE "User" SET "lastActiveAt" = now() - interval '25 hours' WHERE "telegramId" = <id>;
```

puis `pnpm --filter @launchbot/worker job accounts.delete-inactive` (ajouter `--now <date ISO>` pour avancer l'horloge du passage).

- [ ] −23 h → job → rien.
- [ ] −25 h avec abonnement actif, facture PENDING et wallet à 1 SOL :
  - transfert vers `TREASURY_WALLET`, avec une ligne `Withdrawal` INACTIVITY_SWEEP portant l'ID Telegram ;
  - puis compte supprimé ;
  - aucun message reçu par U.
- [ ] Compte de A à −25 h → gardé.
- [ ] RPC coupé pendant le job → compte gardé, nouvel essai au passage suivant.

### R10 · API et transactions

- [ ] `curl -i http://localhost:3001/api/anything` → 401 `{"error":"unauthorized"}`. Même chose avec l'en-tête `x-telegram-init-data: user=1&hash=00`. Avant V1-46, cette requête répondait 404 (écart E1).
- [ ] `PRIORITY_FEE_MAX_MICROLAMPORTS` bas (par exemple 1000) puis redémarrage → un retrait, un paiement depuis un wallet et un sweep. Dans l'explorer, les instructions ComputeBudget restent dans les bornes.

## 7. Frais observés sur devnet

Transactions réelles des tests manuels de Tristan, lues sur le devnet le 25/09/2026 (signatures de la table `Withdrawal` et de l'adresse de dépôt de la facture payée ; données publiques). Bornes du `.env.example` : minimum 0 µL.

| Transaction                                       | Frais payés     | ComputeBudget                                            | Unités consommées |
| ------------------------------------------------- | --------------- | -------------------------------------------------------- | ----------------- |
| Retrait (4 fois, 23/09 et 25/09)                  | 5 000 lamports  | limite 540 CU, prix 0 µL/CU                              | 450               |
| Sweep d'une facture vers la trésorerie (24/09)    | 5 000 lamports  | limite 540 CU, prix 0 µL/CU                              | 450               |
| Paiement de la facture depuis **Phantom** (24/09) | 79 934 lamports | limite 562 CU, prix 133 333 334 µL/CU (fixé par Phantom) | 450               |

Lecture :

- **Transferts du bot** : 450 unités consommées, limite 450 × 1,2 (`CU_MARGIN`) = 540. Le prix vaut 0 µL/CU parce que la médiane des priority fees récentes du devnet est nulle : la borne basse s'applique (critère 41). Frais réels = frais de base de 5 000 lamports, exactement ce que la ligne `Withdrawal.feeLamports` a estimé.
- **Aucun paiement « Pay from my wallet » on-chain à ce jour.** La facture payée l'a été depuis Phantom : 0.5062 SOL envoyés pour 0.506177077 attendus, soit l'arrondi supérieur à 4 décimales affiché ; activée normalement. À faire en R6.
- Pour la V2 (V2-01) : ces chiffres concernent un transfert simple. Le coût d'un launch reste à mesurer.

## 8. Écarts

### 8.1 Corrigés dans V1-46

| #   | Écart                                                                                                                                          | Critère                                        | Correction                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Sous `/api`, un chemin sans route répondait **404** sans `initData` (aucune route n'existe depuis D21) : R10 aurait échoué                     | 40                                             | `apps/api/src/server.ts` : le 404 du scope `/api` passe derrière `requireTelegramUser`, donc 401 d'abord. Tests dans `server.test.ts`                                                    |
| E2  | Launch, étape 3/4 : les écrans Edit et de saisie d'un champ du Token montraient le compteur sans le résumé des choix (wallet, dev buy, bundle) | 17                                             | `renderInputScreen` accepte `summary` (shared) ; `buildEditChoiceScreen` et `buildFieldInputScreen` reçoivent les lignes du parcours (`config.summaryLines`). Test dans `launch.test.ts` |
| E3  | « X community » écrit dans `packages/shared/src/token/display.ts`, hors `en.ts`                                                                | §14                                            | `en.token.xCommunity`                                                                                                                                                                    |
| E4  | « Solana **devnet** is not responding… » : nom du réseau dans un texte (texte proposé D19)                                                     | D8                                             | « Solana is not responding. Try again in a moment. »                                                                                                                                     |
| E5  | Test des 1 000 seeds sur l'ancien modèle (dev buy = preset, sans bundle)                                                                       | 11                                             | Test du modèle D22 : 1 SOL + bundle 3/5/10/20 par `buildSimConfig`                                                                                                                       |
| E6  | Preuves partielles ou absentes                                                                                                                 | 7, 9, 10, 13b, 16, 21, 39 ; §4.5 (échappement) | Tests ajoutés (voir [§3](#3-critères-du-15-et-preuves))                                                                                                                                  |

### 8.2 Ouverts

À trancher par Tristan, reportés sur DEC-06 (et DEC-05 pour O4). Aucun ne met en défaut un critère du §15 tel qu'il est écrit.

| #   | Écart                                                                                                                                                                                                                                                                                                             | Proposition                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | §14 « toute saisie passe par zod » : la plupart des saisies passent par des parseurs purs testés de `shared` ([§5.3](#53-code))                                                                                                                                                                                   | Amender le §14 : « chaque saisie passe par un validateur unique et testé, schéma zod ou parseur pur de shared ». Sinon, une carte pour envelopper les parseurs dans des schémas zod, sans effet visible |
| O2  | Trois avis sans le gabarit du §4.5 (garde des messages sensibles, erreur générique, « Your data has been deleted. »)                                                                                                                                                                                              | Les garder comme avis : pas de clavier, pas d'écran. Ou les passer au gabarit (en-tête)                                                                                                                 |
| O3  | « 🔁 Run again » sous la PNL card : limite de simulations, simulateur plein et simulation en cours ne donnent qu'une alerte. La légende de la carte n'est pas réécrite, contrairement au récap qui porte le flag. Hors des catégories du critère 2, mais contraire à la règle générale du §4.5                    | Garder (message média, blocage passager). Ou une petite carte pour ajouter le flag à la légende (`editMessageCaption`)                                                                                  |
| O4  | Restes D8 pour le passage mainnet (DEC-05). **Réglé par D24 le 25/09/2026** : le texte d'import « …works on mainnet » et la ligne « 🧪 Network: Solana Devnet » sont retirés, le log du worker ne nomme plus le réseau. Reste le défaut `SOLANA_RPC_URL` devnet de `env.ts`, une valeur de config jamais affichée | Rien à faire en V1                                                                                                                                                                                      |
| O5  | Critère 42 côté worker : `createWorkerService` appelle `assertDevnet` en premier (`apps/worker/src/index.ts`), sans test propre, car il lit le `.env` au démarrage                                                                                                                                                | Garder (même fonction que le bot, testée). Ou injecter l'env comme `createBotService` pour le tester                                                                                                    |
| O6  | `addSecretScrubber` (heuristiques clés et seeds sur chaque ligne de log) jamais branché, par décision de V1-12                                                                                                                                                                                                    | Rien en V1 : le scan des logs ne trouve rien. À reconsidérer en V2                                                                                                                                      |
| O7  | 36 textes marqués `// proposed text (D19)` dans `en.ts`                                                                                                                                                                                                                                                           | Relecture finale par Tristan (D19)                                                                                                                                                                      |

## 9. Décisions ouvertes (DEC-06)

Comportement constaté le 25/09/2026 :

| Décision                                                          | Proposition de DEC-06                                  | Constaté dans le code                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2 Launch Coin sans abonnement                                    | B : bouton pour tous, parcours réservé aux abonnés     | B (`launch.test.ts` › the entry)                                                                                                                          |
| D6 Bouton du récap Launch                                         | A : « Create token » + alerte                          | A (« Token creation arrives in V2. » + `🚧` sur le récap)                                                                                                 |
| D9 Quota AI Generate                                              | A : chaque clic Premium compte, jour UTC               | A : ligne `AiGeneration` TEXT par clic Premium même en repli local, jour calendaire UTC, « AI Generate today: n/50 » dans `/getall`                       |
| D12 Run again                                                     | A (seed client)                                        | Remplacé par D21 : seed tirée par le bot, nouvelle ligne `Simulation`, même message                                                                       |
| D14 Création de la Simulation                                     | A : au récap                                           | A, conservé après D21 : créée ou réutilisée pendant 1 h au récap, `sim:go:<id>` la démarre                                                                |
| D15 Image du token                                                | A : proxy API                                          | Caduc depuis D21 : logo lu côté serveur et dessiné dans l'image                                                                                           |
| D19 Textes manquants                                              | A : textes proposés marqués                            | A : 36 marques à relire (O7)                                                                                                                              |
| D24 (25/09/2026) Mention du réseau                                | —                                                      | Aucune : ni badge `🧪 Devnet`, ni ligne « Network », ni avertissement « mainnet » à l'import, ni réseau dans les posts Succès ; le garde-fou devnet reste |
| Seuil de fonds bloquants                                          | Budget de frais d'un retrait                           | `isBalanceWithdrawable` (budget de frais) pour Delete, `/purge`, inactivité                                                                               |
| Refresh de l'étape 2 Launch                                       | Après un clic sur un montant trop haut                 | Après le clic (`launch/screens.test.ts`)                                                                                                                  |
| Arrondi des factures                                              | Attendu au lamport, affiché à 4 décimales vers le haut | Tel quel (paiement Phantom de 0.5062 SOL pour 0.506177077, activé)                                                                                        |
| « coming soon » sur l'écran Token                                 | Pour tous                                              | Pour tous (critère 16)                                                                                                                                    |
| « Wallet limit reached. Upgrade to get more. » à un Premium 10/10 | Texte gardé                                            | Gardé                                                                                                                                                     |
| Paiements après suppression                                       | Détachés                                               | Détachés, surveillés, remboursement manuel (V1-33)                                                                                                        |
| Nouveaux (V1-46)                                                  | —                                                      | O1, O2, O3, O5 ci-dessus ; §17 « Post Succès et bundle » ([§10](#10-v1-39-en-cours))                                                                      |

## 10. V1-39 en cours

V1-39 (format du post du canal Succès et service de publication, branché en V2-04 selon D4) est développé par le collègue de Tristan. Il n'est pas couvert par cette recette. Aucun critère du §15 ne dépend de lui : le post automatique après un launch est de la V2.

Points pour V1-39, relevés pendant la recette :

- **Bundle dans le post** : le §17 laisse ouvert « Post Succès et bundle » (dev buy et bundle séparés, ou total avec la part cumulée). La carte V1-39 montre encore un seul dev buy de 3 SOL, d'avant D22.
- **Consentement** : depuis D23, aucun accord de l'utilisateur n'est enregistré pour la publication dans le canal Succès. La carte V1-39 cite encore les Terms (§11.2). Question portée par DEC-03.
- **Aide aux erreurs d'envoi** : V1-38 fournit `sendFailureOf` et `retryAfterMs` dans `apps/bot/src/navigation/telegram-errors.ts` (pas de `describeTelegramSendError`). `postAnnouncement` (`apps/bot/src/features/admin/announce-publisher.ts`) montre le motif « un nouvel essai après un 429 ».
- **Droits** : le bot doit être administrateur du canal Succès avec « Publier des messages » (R0). Ce n'était pas le cas le 25/09.
- **Outils de recette qui couvriront V1-39 sans rien ajouter** :
  - `pnpm check:i18n` parcourt `apps/bot/src` et `packages/shared/src`, donc `channels/` ;
  - les règles d'écran du transport de test ignorent les posts dans un canal (`chat_id` en `-100…` ou `@…`), mais un aperçu envoyé à un chat privé sera contrôlé comme un écran ;
  - les tests du service et du formateur prévus par la carte s'ajoutent à `pnpm test`.
- **À rejouer quand V1-39 sera fusionné dans `develop`** :
  - [ ] `pnpm check:i18n` ;
  - [ ] `pnpm test:db` ;
  - [ ] `pnpm screens:catalog` ;
  - [ ] le script de prévisualisation vers un canal de test (avec image, sans image, sans lien, description longue), rendu mobile et bureau ;
  - [ ] compléter cette section.
