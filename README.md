# Launch Bot

Bot Telegram pour créer et simuler des launchs de memecoins Solana via pump.fun. La simulation se
joue dans le chat : le bot édite l'image du graphique en direct, avec les boutons de vente dessous
(décision du 24/09/2026, §6.5 du contexte). Pas de Terms of Service ni de Privacy Policy
(décision du 25/09/2026, §11.2) : la Mini App reste en place, mais ne sert plus aucune page.
Projet perso, **devnet uniquement**.

- Spécification produit : [context_bot.md](context_bot.md)
- Tickets, décisions (D1–D23) et suivi : [board Trello « Launch Bot »](https://trello.com/b/Rx4KkRAj/launch-bot)

## Structure

```
apps/
  bot/         grammY : menus, parcours, commandes admin
  api/         Fastify : validation initData (rejoint le process du bot) ; plus de route métier
  worker/      jobs pg-boss : paiements, transferts, rappels, comptes inactifs, nettoyage
  webapp/      Vite + React : Mini App, sans page depuis le 25/09/2026
packages/
  sim-engine/  moteur de simulation, TypeScript pur, sans réseau
  sim-render/  images de la simulation : graphique en PNG (resvg), PNL card animée sur un clip (ffmpeg)
  solana/      wallets, soldes, retraits, chiffrement ; pump.fun et PumpSwap en V2
  db/          schéma Prisma, client et services métier partagés
  shared/      types, constantes, schémas zod, textes du bot ; env et logger côté serveur
```

Dépendances internes autorisées. pnpm n'expose à un package que les dépendances de son
`package.json` ; ESLint ajoute les règles de `shared`, `sim-engine`, `api` et `webapp` :

| Package        | Peut importer                                                         |
| -------------- | --------------------------------------------------------------------- |
| `shared`       | aucun package interne                                                 |
| `sim-engine`   | rien : ni package interne, ni API Node                                |
| `sim-render`   | `shared`, `sim-engine` ; Node autorisé (police embarquée, resvg)      |
| `db`, `solana` | `shared`                                                              |
| `api`          | `shared`, `db` — jamais `solana` : elle démarre sans garde-fou devnet |
| `worker`       | `shared`, `db`, `solana`                                              |
| `bot`          | `shared`, `db`, `solana`, `sim-engine`, `api`                         |
| `webapp`       | `shared` (entrée universelle, sans `en` ni `E`)                       |

`@launchbot/shared` a deux entrées : `.` (navigateur + Node) et `./server` (Node uniquement :
`loadEnv`, `parseEnv`, `createLogger`, `scrubSecrets`, `runEvery`…). La Mini App n'importe jamais `./server`,
`db` ni `solana`.

L'entrée universelle fournit les briques de tous les écrans : textes `en` et emojis `E`
(`src/i18n/`), gabarit `renderScreen` / `renderInputScreen`, boutons, `navRow` et découpage des
messages longs `splitHtmlMessage` (`src/ui/`), codec
`encodeCallback` / `decodeCallback`, constantes métier, config de cluster, formateurs
(`src/format/`, tout en UTC, SOL en lamports `bigint`) et schémas zod. ESLint y interdit tout import
`node:*` ou `server`, et `sideEffects: false` laisse Vite retirer ce que la Mini App n'utilise pas.
Chaque process lie le cluster une fois au démarrage : `const ui = createUi(env.SOLANA_CLUSTER)`, puis
`ui.screenHeader(title, counter?)` et `ui.flowHeader({ flow, step })` portent le badge du cluster.

Emplacement des services : logique Telegram dans `apps/bot`, accès Solana dans `packages/solana`,
services métier Prisma partagés entre apps dans `packages/db/src/services/`, avec dépendances
injectées (Solana, prix, horloge) pour rester testables.

## Prérequis

- Node.js 22 LTS ou plus récent
- pnpm via corepack : `corepack enable` (la version est figée par `packageManager`)
- Docker (PostgreSQL)

## Installation

```sh
pnpm install
cp .env.example .env        # PowerShell : Copy-Item .env.example .env
pnpm db:up                  # PostgreSQL 16 + bases launchbot et launchbot_test
pnpm dev                    # bot, worker et webapp en parallèle
```

Clé de chiffrement des wallets (`WALLET_ENCRYPTION_KEY`, 32 octets en base64) :

```sh
openssl rand -base64 32
# ou, sans openssl :
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**À sauvegarder hors de la machine.** Toutes les clés privées et seed phrases des wallets sont
chiffrées avec elle : la perdre, ou la changer sans migration, les rend irrécupérables, y compris
pour le support (`/getall`). Aucune rotation n'est prévue en V1.

Base locale : `DATABASE_URL=postgresql://launchbot:launchbot@localhost:5440/launchbot`. Le conteneur
publie le port **5440** et non 5432, pour ne pas entrer en conflit avec un PostgreSQL installé sur la
machine. Pour en changer : `POSTGRES_PORT` dans `.env`, et adapter `DATABASE_URL`. La base
`launchbot_test` est créée au premier démarrage du volume ; pour repartir de zéro :
`docker compose down -v`.

## Scripts

| Script                   | Rôle                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`               | bot, worker et webapp en mode watch (`tsx watch`, `vite`)                                                                           |
| `pnpm build`             | `tsc -b` sur tout le graphe, puis `vite build` pour la webapp                                                                       |
| `pnpm typecheck`         | `tsc -b` sur les 8 projets (références de projets)                                                                                  |
| `pnpm lint`              | ESLint (typescript-eslint avec types, `no-console`)                                                                                 |
| `pnpm format`            | Prettier (`pnpm format:check` pour vérifier)                                                                                        |
| `pnpm test`              | Vitest, un projet par app/package (`pnpm test:watch` en continu)                                                                    |
| `pnpm test:db`           | avec `RUN_DB_TESTS=1` : tests d'intégration sur `launchbot_test`                                                                    |
| `pnpm test:devnet`       | avec `RUN_DEVNET_TESTS=1` : tests qui appellent le RPC devnet                                                                       |
| `sim:report`             | `pnpm --filter @launchbot/sim-engine sim:report [seeds]` : réglage du moteur (V1-19)                                                |
| `render:sample`          | `pnpm --filter @launchbot/sim-render render:sample [seed] [dossier]` : images d'exemple dans `packages/sim-render/out/` (V1-25)     |
| `job`                    | `pnpm --filter @launchbot/worker job <accounts.delete-inactive\|data.expired-cleanup> [--now <ISO>]` : un passage à la main (V1-45) |
| `pnpm db:up` / `db:down` | démarre / arrête PostgreSQL                                                                                                         |

Un seul package : `pnpm --filter @launchbot/shared test`.

Les tests d'intégration sont ignorés par défaut. Convention :

```ts
describe.skipIf(!process.env.RUN_DB_TESTS)("PaymentService (db)", () => { … });
```

## Base de données

Schéma Prisma : [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma) (8 modèles V1 du
§13, `SubscriptionGrant` de /grant et `SensitiveMessage` de /getall, plus la table `Session` que
grammY utilise). Le client généré (`packages/db/src/generated/`) n'est pas commité : `pnpm install` lance
`prisma generate`, qui ne demande ni base ni `.env`.

| Script             | Rôle                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `pnpm db:generate` | régénère le client après une modification du schéma                                            |
| `pnpm db:migrate`  | `prisma migrate dev` : crée et applique une migration (dev)                                    |
| `pnpm db:deploy`   | `prisma migrate deploy` : applique les migrations commitées                                    |
| `pnpm db:reset`    | vide la base de dev et rejoue tout (confirmation dans un terminal)                             |
| `pnpm db:seed`     | seed de dev idempotent : un utilisateur Premium et un brouillon de token (voir « Abonnement ») |
| `pnpm db:studio`   | Prisma Studio                                                                                  |

Ces scripts lisent `DATABASE_URL` dans le `.env` racine. Chaque ticket ajoute sa propre migration.
Prisma ne sait pas exprimer une contrainte CHECK : elle s'écrit à la main dans une migration SQL
(`wallet_mnemonic_check`).

`pnpm test:db` supprime puis recrée la base de test et y applique les migrations avec
`prisma migrate deploy`. L'URL vient de `TEST_DATABASE_URL`, sinon de `DATABASE_URL` avec le suffixe
`_test`. Une base dont le nom ne finit pas par `_test` est refusée. Chaque suite a sa propre base
(`resetTestDatabase("bot")` → `launchbot_bot_test`), car Vitest lance les projets en parallèle.

```ts
import { prisma, isUniqueViolation } from "@launchbot/db";
```

`prisma` est créé au premier usage : importer `@launchbot/db` ne demande ni base ni configuration.
À savoir :

- lamports en `BigInt`, jamais en `number` ; `BigInt` et `Decimal` ne passent pas dans
  `JSON.stringify` (conversion explicite dans l'API et les logs) ;
- ne jamais activer le log de requêtes Prisma : les paramètres contiennent les clés chiffrées ;
- une erreur Prisma peut contenir la ligne SQL fautive (`detail: Failing row contains…`) : logger
  `error.code`, pas l'erreur entière, dans le code qui touche `Wallet` et `Payment` ;
- aucun `prisma.user.delete` hors de `deleteUserData` (service de suppression de compte, V1-44 :
  /purge et comptes inactifs de V1-45) : la cascade efface les clés des wallets.

## Configuration

Les 23 variables du §12 sont dans [.env.example](.env.example). Elles sont validées au démarrage
par `loadEnv()` (`packages/shared/src/server/env.ts`). Une chaîne vide compte comme une variable
absente. Si la configuration est invalide, le process affiche la liste des variables fautives,
**jamais leurs valeurs**, puis s'arrête avec le code 1 :

```
Invalid environment configuration:
  - WALLET_ENCRYPTION_KEY: must be valid base64 that decodes to exactly 32 bytes
  - WEBAPP_URL: must be an https:// URL
```

Le `.env` de la racine est chargé quel que soit le dossier courant. Les variables déjà présentes
dans l'environnement réel priment sur le fichier. Variables optionnelles hors §12 : `LOG_LEVEL`
(défaut `info`) et `POSTGRES_PORT` (docker-compose).

`WEBAPP_URL` doit être une URL en `https://`, même si la Mini App ne sert plus aucune page : le CORS
de l'API n'autorise que son origine. Aucun bouton du bot ne l'ouvre plus, donc une URL qui ne répond
pas ne gêne rien.

### Logs

Tout passe par `createLogger(name)` (pino) ; `console` est interdit par ESLint. JSON en production
(`NODE_ENV=production`), `pino-pretty` sinon. Deux protections :

1. `redact` censure les clés sensibles des objets loggés (`secretKey`, `privateKey`, `seedPhrase`,
   `mnemonic`, `initData`, `token`, `iv`, `authTag`, en-têtes `authorization` et
   `x-telegram-init-data`…), jusqu'à deux niveaux de profondeur (`a.b.secretKey`). Au-delà, rien
   n'est censuré : logger des objets plats, jamais un `ctx` grammY ni un objet métier entier.
2. Chaque ligne sérialisée (message, erreur, stack) passe par `scrubSecrets` : valeurs exactes de
   `BOT_TOKEN`, `WALLET_ENCRYPTION_KEY`, `DATABASE_URL` et d'un RPC privé, tout motif de token de
   bot, identifiants et query strings des URL (`?api-key=…`).

Ne jamais logger `process.env` ni l'objet `Env`. Ne jamais activer `DEBUG=grammy*` hors poste
local : il affiche le contenu des updates.

## Telegram

### BotFather

1. `/newbot` → copier le token dans `BOT_TOKEN`.
2. `/setjoingroups` → **Disable** : le bot ne fonctionne qu'en conversation privée.

Inutile de faire `/setcommands` : le bot enregistre sa commande `/start` lui-même au démarrage. Les
commandes admin n'apparaissent que dans le menu de chaque admin (`setAdminCommands`, voir « Garde
admin »), jamais dans la liste par défaut.

Le bot ne répond qu'en **conversation privée** : `/start` se tape dans le chat ouvert depuis
`https://t.me/<username_du_bot>`. Tapé dans un canal ou un groupe, il ne se passe rien, par
conception (§4.1), et rien n'apparaît dans les logs au niveau `info`.

### Canaux

Créer les trois canaux (canal du bot, Succès, Annonces), puis ajouter le bot comme
**administrateur** de chacun : c'est nécessaire pour y publier et pour vérifier l'adhésion
(`getChatMember`). Pour un canal public, `CHANNEL_*_ID` accepte directement `@nom_du_canal` ; pour
un canal privé, c'est l'ID numérique `-100…`. `CHANNEL_*_URL` est le lien `https://t.me/…`, et le
compte support va dans `SUPPORT_URL` (un lien `https://t.me/<username>` reçoit le code support en
premier message, voir « Écran Support »).

### Mini App et API en local (HTTPS obligatoire)

La Mini App ne sert plus aucune page depuis le retrait des Terms et de la Privacy Policy
(25/09/2026, V1-41) : aucun tunnel n'est nécessaire pour tester le bot. Ce qui suit reste valable
pour une page à venir.

Telegram n'ouvre une Mini App qu'en HTTPS. En local, **un seul tunnel** suffit : Vite sert la Mini
App sur le port 5173 et relaie `/api` vers l'API locale (`server.proxy`), donc la Mini App et son API
partagent l'origine du tunnel.

```sh
pnpm --filter @launchbot/bot start     # le bot ET l'API (port 3001), dans le même process
pnpm --filter @launchbot/webapp dev    # Vite sur 5173, avec le proxy /api → 127.0.0.1:3001
cloudflared tunnel --url http://localhost:5173
# ou
ngrok http 5173
```

Copier l'URL https obtenue dans `WEBAPP_URL` **et** dans `API_URL`, puis relancer **le bot et
Vite** : tous les deux lisent `.env` au démarrage seulement (Vite injecte `API_URL` dans le bundle
à ce moment-là). Les
hôtes `.trycloudflare.com`, `.ngrok-free.app`, `.ngrok.app` et `.loca.lt` sont déjà autorisés dans
`server.allowedHosts` de [apps/webapp/vite.config.ts](apps/webapp/vite.config.ts) : pour un autre
fournisseur de tunnel, y ajouter son hôte, sinon Vite refuse la requête. L'URL d'un quick tunnel
change à chaque lancement. Sans `winget`, le binaire se télécharge depuis les releases GitHub de
cloudflared (`cloudflared-windows-amd64.exe`). localtunnel (`npx localtunnel --port 5173`) marche
aussi mais impose une page d'avertissement par IP, instable dans Telegram. Variante : deux tunnels
(Mini App et API), avec `API_URL` sur le second ; le CORS de l'API n'autorise que l'origine de
`WEBAPP_URL`.

Tester une page : s'envoyer un bouton `web_app`, depuis le chat privé avec le bot, jamais depuis un
canal.

```sh
curl "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
  -H "content-type: application/json" \
  -d '{"chat_id": <ton_id>, "text": "Page", "reply_markup": {"inline_keyboard":
       [[{"text": "Open", "web_app": {"url": "https://<tunnel>/<page>"}}]]}}'
```

Aujourd'hui, toute route répond « Page not found. », dans Telegram comme dans un navigateur. Hors de
Telegram, une page s'afficherait aussi ; seuls les appels à l'API sont refusés, faute d'`initData`.

`API_URL` est la **seule** variable du `.env` injectée dans le bundle (`define` de Vite). En
production, l'hébergement statique doit renvoyer
`index.html` pour toute route (`public/_redirects` le fait sur Cloudflare Pages et Netlify ; sur
nginx, `try_files $uri /index.html`), et ne doit envoyer ni `X-Frame-Options: DENY` ni
`frame-ancestors` restrictif : Telegram Web affiche la Mini App dans une iframe.

### API

`GET /health` est public et répond `{"status":"ok"}`, sans rien dire de l'environnement.

**Tout ce qui est sous `/api` est protégé par défaut.** Aucune route n'y est montée depuis le
24/09/2026 (D21) ; une route de la Mini App se déclarerait dans l'option `routes` de
`buildApiServer`, sans `preHandler` : le périmètre `/api` applique
`app.requireTelegramUser` à chacune, donc une route ne peut pas devenir publique par oubli. Ce
preHandler valide l'en-tête `X-Telegram-Init-Data` comme le décrit la doc Telegram (HMAC avec la clé
`WebAppData`, champs triés, comparaison en temps constant, `auth_date` d'une heure au plus). Tout
échec donne le même `401 {"error":"unauthorized"}` ; la raison n'est que dans les logs `debug`,
jamais l'en-tête. `request.telegramUser` n'est jamais `undefined` : le lire sur une route non
protégée lève une erreur, au lieu de donner un utilisateur vide que Prisma transformerait en requête
sans filtre de propriétaire.

Erreurs : un seul chemin de sortie, avec un mot fixe par statut et jamais le message de l'erreur. Un
4xx voulu passe tel quel — une route lève une erreur portant `statusCode` 403, 404 ou 429 — et tout
le reste répond `500 {"error":"internal"}` (mots de `API_ERROR_CODES`, V1-05). Une URL mal formée
suit le même chemin.

L'API seule : `pnpm --filter @launchbot/api start`. Elle ne parle jamais à Solana, et ESLint lui
interdit `@launchbot/solana` : c'est ce qui permet qu'elle démarre sans garde-fou devnet.

## Le bot

`pnpm --filter @launchbot/bot start` lance [apps/bot/src/main.ts](apps/bot/src/main.ts), qui passe
`createBotService()` et `createApiService()` à `runProcess` : le bot et l'API, dans le même process. Tout le démarrage
se fait dans le `start()` du service, donc un refus est loggé proprement (nom et message de l'erreur,
jamais de stack) et le process sort en code 1. Ordre de démarrage :

1. `loadEnv()` ;
2. **garde-fou devnet** : `assertDevnet` compare le hash genesis du RPC à celui du devnet. Un
   cluster autre que devnet, un hash différent ou un RPC injoignable refusent le démarrage. Les logs
   ne montrent que l'hôte du RPC, jamais sa query, qui peut contenir une clé d'API ;
3. `SELECT 1` sur PostgreSQL ;
4. `bot.init()` (le token n'apparaît dans aucun log) ;
5. vérification des droits du bot dans ses trois canaux (voir « Premier accès ») ;
6. `setMyCommands` (liste par défaut, puis celle de chaque admin), le balayeur des messages de
   clés (V1-43), puis long polling (`bot.start` supprime lui-même le webhook).

Chaîne de middlewares, dans cet ordre : `privateOnly` (en groupe ou en canal le bot ne fait rien,
aucune écriture en base), `ensureAnswered`, `touchUser` (activité, qui pilote la purge à 24 h),
sessions, **`sensitiveMessageGuard`** (V1-12), limite globale de fréquence, `access.gate` (premier
accès), conversations, puis `/start`, la saisie attendue, la garde admin (V1-38) et le routeur de
callbacks. Les commandes admin passent donc après la gate : un admin rejoint le canal aussi. Le garde anti-secret est **avant** la limite de fréquence et la gate :
une clé collée doit quitter le chat même si l'utilisateur est limité ou n'a pas rejoint le canal —
en échange, un update au-dessus de la limite coûte désormais un upsert `User` et une lecture de
session.
`ensureAnswered` **englobe** la suite : une fois les handlers passés, il ferme toute callback query
restée sans réponse. Placé en fin de chaîne, il serait sauté par tout handler qui n'appelle pas
`next()`, ce que font les commandes et le plugin conversations. `bot.catch` logge la forme de
l'update et l'erreur — jamais `ctx.update`, un texte de message ou `GrammyError.payload`.

Le logger ne garde d'une erreur que son nom et son message nettoyé (serializer `err`) : un
`log.error({ err })` ne peut donc pas laisser fuir une stack ou les champs propres de l'erreur.

Navigation à message unique : `showScreen(ctx, screen)` édite l'écran en place sur un clic, envoie un
nouveau message après une saisie et désarme le clavier de l'ancien. Il renvoie `not_modified` quand
Telegram refuse une édition identique, ce dont le Refresh se sert pour répondre « Already up to
date ». `blockWithFlag` répond une alerte et réécrit l'écran avec le flag (§4.5).

Sessions et conversations partagent la table `Session` (préfixe `conversation-` pour les secondes).
Une session que la version en place ne sait pas lire est jetée et reconstruite, donc un déploiement
ne casse aucune conversation. **Aucun secret en session** : les lignes sont en clair.

### Simulate a Launch : bundle, récap et création de la simulation (V1-22)

`registerSimulation` ([apps/bot/src/features/simulation/simulation.ts](apps/bot/src/features/simulation/simulation.ts))
branche « 📊 Simulate a Launch » sur le parcours complet : étape 1/3 Token (V1-16, Back = menu),
étape 2/3 Bundle, étape 3/3 Récap. Écrans dans
[screens.ts](apps/bot/src/features/simulation/screens.ts), logique dans
[apps/bot/src/services/simulation.ts](apps/bot/src/services/simulation.ts) (`buildSimConfig`,
`prepare`), lignes `Simulation` via `createSimulationStore` (`@launchbot/db`). Le parcours
provisoire de V1-16 est remplacé.

**Décision du 25/09/2026** : le dev achète toujours **1 SOL** (`DEV_BUY_SOL`), puis le **bundle**
choisi achète au bloc suivant, depuis le même wallet. La simulation suit le même modèle que Launch
Coin : l'étape 2 choisit le bundle (3 / 5 / 10 SOL, Custom de 3 à 20 SOL), plus le dev buy.

- **Bundle** : `[ 3 SOL ][ 5 SOL ][ 10 SOL ]`, `✏️ Custom`, `⬅️ Back` (vers Token). Description
  (« The dev buys 1 SOL at launch, then the bundle buys in the next block… ») puis infos
  (`🪙 Moon Otter · $OTTR`, `💰 Dev buy: 1 SOL`, `📦 Bundle: not selected yet` ou le montant).
  Custom : écran de saisie avec les valeurs actuelles, `Allowed: 3 to 20 SOL, up to 3 decimals.` et
  `❌ Cancel` ; `parseBundleAmount` (`@launchbot/shared`, la grammaire SOL de `parseSolToLamports`)
  accepte « 3.5 », « 3,5 », « 5 sol », 3 décimales max, ni signe ni exposant, et rend le montant
  en SOL et en lamports exacts (Launch Coin) ; refus → flag `⚠️ Invalid amount…`, la saisie reste
  ouverte (message de l'utilisateur supprimé, écran édité, V1-04).
- **Récap** : bloc TOKEN (`renderTokenRecapBlock`, repris par V1-37 : nom · ticker, description si
  présente, `🖼 Image: ✅` ou `—`, `🔗 Links: none` ou `Website · X · Telegram` en liens `<a>`),
  puis `renderBuyLines` (repris par V1-37) : `💰 Dev buy: 1 SOL (≈ 3.4% of supply)`,
  `📦 Bundle: 5 SOL (≈ 14.3% of supply)` (ce que le bundle ajoute après le dev buy) et
  `🧮 Total: 6 SOL (≈ 17.7% of supply)`, sur `devBuySupplyShare` du moteur, calculé sur la courbe
  **stockée** dans la Simulation, jamais sur une relecture ; une Simulation stockée avant le
  bundle n'affiche que son dev buy. Puis `⏱ Duration: 3 min max`, mention
  `⚠️ DEMO — Bullish scenario…` (`en.sim.demoBanner`, reprise par le message de simulation).
  Clavier : `▶️ Start simulation` en callback `sim:go:<simId>` (V1-26, D21 : il démarre la
  simulation dans le chat ; jusqu'au 24/09/2026 c'était un bouton `web_app` vers la Mini App),
  puis `⬅️ Back` / `🏠 Menu`. La création de la Simulation à l'affichage du récap (D14) est
  conservée : le clic lit la ligne et la joue.
- **Création de la Simulation (D14)** : à l'affichage du récap, pas au clic. La plus récente du
  même utilisateur, brouillon, dev buy et bundle est reprise si elle a moins d'1 h
  (`SIMULATION_REUSE_MS`, proposition) ; sinon contrôle de la limite (`RATE_LIMITS.simulation`,
  10 par 10 min, D17 ; une reprise ne compte pas) puis création : seed `crypto.randomInt(0, 2^31)`,
  `params` = SimConfig complet (`buildSimConfig` : dev buy de 1 SOL, `bundleSol`,
  `presetForAmount(bundleSol)`, `durationSec` 180, courbe de
  `getCurveParams()` V1-21, `solUsdPrice` V1-07 ou `null`), validé par `assertSimConfig` et
  `simConfigSchema` ; les colonnes `devBuySol` et `bundleSol` sont tirées de ce config, comme le
  seed. `prepare` est le seul endroit qui connaît le dev buy fixe ; Run again recopie le config.
  Un brouillon édité devient un nouveau `tokenDraftId` (copie à l'écriture V1-16), donc une
  nouvelle Simulation.
- **Blocages écrits à l'écran** : limite → alerte + flag `⚠️ Too many simulations…` sur le
  Bundle, aucune ligne créée ; nom ou ticker manquant, brouillon disparu → écran Token avec
  `⚠️ Missing: …` (`tokenStep.requireReadyDraft`, le brouillon accepté par Continue est passé
  d'écran en écran sans relecture) ; erreur inattendue → flag générique de V1-04, détail dans les logs seulement.
- **Schémas partagés** (`@launchbot/shared`, qui ne dépend pas du moteur) : `curveParamsSchema`,
  `presetParamsSchema`, `simConfigSchema` (les règles de `assertSimConfig`, jamais les bornes d'une
  saisie, pour qu'une ligne stockée reste lisible ; `bundleSol` vaut 0 par défaut : les lignes d'avant
  le bundle se relisent), `seedSchema` ; `formatSolNumber(sol)` (« 5 SOL »,
  « 3.5 SOL »).
- **Session** : `sim.bundleSol` (Back depuis le récap réaffiche le montant) ; le brouillon reste
  dans `tokenStep.SIMULATION`, la Simulation est retrouvée par la règle de reprise (pas d'id en
  session). Saisie en attente : `pendingInput.kind = "sim_amount"`.
- Callback data : `sim:open`, `sim:b:3|5|10`, `sim:b:c`, `sim:cc`, `sim:bk:tok`, `sim:bk:b`
  (test ≤ 64 octets ; un ancien bouton `sim:dev:*` reçoit le toast « bouton expiré » du routeur).
- Pas de verrou anti double clic (proposition de la carte non retenue) : grammY traite les updates
  d'un chat en séquence, et la reprise absorbe le second clic. `renderBuyLines` et
  `renderTokenRecapBlock` vivent dans `apps/bot`, pas dans `packages/shared` qui ne peut pas
  importer le moteur.

### Générateur : AI Generate (V1-17)

Le clic sur « AI Generate » est réservé aux abonnés Premium, limité à 50 générations par jour UTC
(D9), et utilise en V1 le générateur local : aucun fournisseur IA n'est branché avant DEC-02.

- **Fournisseurs** : `AiTokenTextProvider` et `AiTokenLogoProvider`
  ([packages/shared/src/ai/types.ts](packages/shared/src/ai/types.ts)) reçoivent le token précédent et
  un `AbortSignal`, rien d'autre (§11.3). `createAiProviders(env)`
  ([providers.ts](apps/bot/src/services/ai/providers.ts)) renvoie `{ text: null, logo: null }`
  même avec `LLM_API_KEY` / `IMAGE_API_KEY`, et logue au démarrage un avertissement qui nomme la
  variable, jamais sa valeur (les deux clés sont déjà dans la liste des secrets masqués du logger).
  `isAiModelAvailable(providers)` = un fournisseur texte existe : c'est la règle qui retire la
  mention « coming soon » de l'écran Token et, en V1-29, de l'écran des offres.
- **Quota** : `createAiQuotaStore({ prisma })`
  ([ai-generations.ts](packages/db/src/services/ai-generations.ts)) — `reserveText(userId, now)`
  compte les lignes `AiGeneration` TEXT depuis `startOfUtcDay(now)` et en insère une, dans une
  transaction sous verrou consultatif par utilisateur (deux clics à 49/50 n'en acceptent qu'un,
  test d'intégration `RUN_DB_TESTS=1`) ; `recordLogo` ajoute une ligne LOGO non comptée
  (proposition : un clic = une génération). `nextUtcMidnight` donne le `resetsAt`.
- **Service** : `createAiGenerateService({ quota, providers, hasActivePremium })`
  ([ai-generate.ts](apps/bot/src/services/ai/ai-generate.ts)), testable sans Telegram.
  `generate(userId, previous)` relit l'offre, réserve le quota, puis prend le texte du fournisseur
  (délai `AI_TEXT_TIMEOUT_MS`, sortie validée par `generatedTokenSchema`) ou du générateur local ;
  un fournisseur en échec, trop lent ou hors règles donne `source: "LOCAL_FALLBACK"` et le clic
  compte quand même. Le logo (délai `AI_LOGO_TIMEOUT_MS`) est renvoyé en octets, `null` en échec.
  Résultats : `NOT_PREMIUM`, `QUOTA_REACHED { used, limit, resetsAt }`, `OK { token, logo, source,
used, limit }`.
- **Hooks de l'écran Token** ([ai-hooks.ts](apps/bot/src/features/token-step/ai-hooks.ts),
  construits par `createTokenStep` lui-même à partir de `ai` et `providers`) : `extraLines` donne la ligne
  `🤖 AI generations today: 13/50` aux Premium (info, après le bloc) et la mention
  `🤖 AI model coming soon: AI Generate uses the standard generator for now.` à tout le monde
  (note, après les flags) tant que `isAiModelAvailable` est faux. Le clic : limite de fréquence
  `RATE_LIMITS.generate` (partagée avec Generate) → alerte + flag ; `NOT_PREMIUM` → alerte
  « 🔒 AI Generate is a Premium feature. » + flag « 🔒 AI Generate: Premium only » ;
  `QUOTA_REACHED` → alerte + flag « daily limit reached (50/50). Resets at 00:00 UTC. » ; `OK` →
  `applyTokenValues` (nom, ticker, description ; image et liens conservés) et le flag
  « AI model unavailable: used the standard generator. » en repli. Avec un fournisseur, la query
  est répondue tout de suite et l'écran affiche « 🤖 Generating… » pendant l'appel ; un logo est
  envoyé par `sendPhoto` dans le chat, le message supprimé, et son `file_id` remplace
  `imageFileId` (proposition à valider en DEC-02).

### Générateur : écran Token réutilisable (V1-16)

L'étape Token (§5) est un composant unique, `createTokenStep({ ui, drafts, data, ai, providers })`
([token-step.ts](apps/bot/src/features/token-step/token-step.ts)), configuré par parcours : étape
1/3 de Simulate a Launch, étape 3/4 de Launch Coin. `tokenStep.mount(router, inputs)` branche une
fois le domaine `tok` et la saisie `token_field` ; chaque parcours appelle
`tokenStep.registerFlow(config)` avec la cible de son Back (`backData` : `nav:home` pour la
simulation, l'étape 2 pour le launch — un bouton qui ne fait que naviguer, comme partout), ses
lignes de résumé (`summaryLines`, LAUNCH : wallet, dev buy et bundle ; un appelant qui les a déjà les passe
à `showTokenStep(ctx, flow, { summaryLines })`) et son `onContinue(ctx, draft)` — qui
reçoit toujours un brouillon avec `name` et `symbol` non nuls. L'id du brouillon vit dans la session
du step, par parcours. Les hooks d'AI Generate (V1-17, lignes d'info et de notes sur l'écran, et le
clic) sont construits par le step à partir de `ai` et `providers` ; le libellé du bouton vient de
`data.hasActivePremium(userId)` (`🔒` sans Premium actif, `🤖` avec).

- **Écrans** ([screens.ts](apps/bot/src/features/token-step/screens.ts)), purs et testés sur le
  mockup du §5 : `renderTokenStep(ui, { flow, draft, isPremium, backData, summaryLines, infos,
flags, notes })` (en-tête de parcours, description, résumé, bloc TOKEN, infos, flags, notes,
  clavier), l'écran de choix
  d'Edit, et `buildFieldInputScreen(ui, flow, field, draft)` pour les sept saisies (valeur
  courante, règle, erreur, Cancel — et « 🗑 Remove » pour image et liens déjà remplis). Champ vide
  → `—`, ticker via `formatTicker`, liens via `formatLinkForDisplay`, toute valeur utilisateur
  échappée. Callback data `tok:<op>:<s|l>[:<champ>]` (`TOKEN_CB`), toutes sous 20 octets : le
  routeur dispatche sur l'op, chaque handler relit le parcours avec `tokenFlowOf`.
- **Brouillon** : `createTokenDraftService({ prisma })`
  ([token-drafts.ts](packages/db/src/services/token-drafts.ts)) avec `getOwnedDraft(userId, id)`
  (null pour le brouillon d'un autre) et `write(userId, id | null, patch)` : création paresseuse à
  la première écriture, **copie à l'écriture** si une `Simulation` référence le brouillon (D14 : une
  simulation garde le token avec lequel elle a été créée), mise à jour sinon. `applyTokenValues`
  garde en session l'id renvoyé, et passe le brouillon écrit à `showTokenStep({ draft })` pour que
  l'écran ne le relise pas.
- **Session** : `tokenStep[flow] = { draftId?, showMissing? }`, conservé d'un écran à l'autre (le
  menu retrouve le même brouillon) ; la saisie est le `pendingInput`
  `{ kind: "token_field", flow, field, since }` de V1-11, donc fermée par tout autre écran, et
  ignorée après `TOKEN_INPUT_TIMEOUT_MS` (10 min, proposition) avec le flag « This input expired ».
- **Boutons** : Generate = `generateLocalToken({ previous })` (nom, ticker, description
  remplacés ; image et liens conservés), limité par `RATE_LIMITS.generate` (alerte + flag
  `tooManyActions`). Continue sans nom ou sans ticker : alerte « Add a name and ticker first. » et
  flag `⚠️ Missing: name, ticker` (ou le seul champ manquant), qui **reste** et suit les champs
  jusqu'à ce que les deux soient là (proposition). Remove met la colonne à null.
- **Saisies** : texte brut → `parseTokenField` → écriture ou écran de saisie avec l'erreur
  (`errorTextOf`, un texte par code de V1-15) ; image → `imageFileIdOf(message)` : la plus grande
  taille d'une photo, ou un document `image/jpeg|png|webp` ≤ `TOKEN_IMAGE_MAX_BYTES` (20 MB, limite
  de `getFile`), tout autre message est refusé à l'écran. Après une saisie, l'écran revient en
  place (`mode: "edit"`).
- **Provisoire** ([simulation/provisional.ts](apps/bot/src/features/simulation/provisional.ts),
  remplacé par V1-22) : `sim:open` (le bouton du menu) ouvre l'étape Token en SIMULATION, son Back
  est `nav:home`, Continue affiche l'étape 2/3 « The dev buy step is coming soon. » avec Back →
  `sim:open` et Menu.

### Générateur : générateur local et règles des champs (V1-15)

Module pur de `packages/shared` ([src/token/](packages/shared/src/token/)), sans API Node : la
Mini App peut l'embarquer. `generateLocalToken({ rng?, previous? })` compose `<Adjectif> <Nom>`
depuis les listes de [words.ts](packages/shared/src/token/words.ts) (128 × 128, ASCII, ≤ 12
caractères, aucune marque ni promesse de gain — test de liste noire), un ticker de 3 à 6 lettres
selon trois stratégies (`OTTR`, `MOTTER`, `MOTR`) et une description de 1 à 3 phrases. Avec
`previous`, le résultat diffère toujours sur le nom **et** le ticker : 20 tirages, puis parcours
déterministe des combinaisons. Chaque sortie passe `generatedTokenSchema`.

`parseTokenField(field, raw)` ([fields.ts](packages/shared/src/token/fields.ts)) normalise et valide
les six champs texte du §5 — NFC, retours à la ligne en espaces, caractères de contrôle refusés,
longueurs du nom et du ticker en **octets UTF-8** (`utf8ByteLength`, jamais `.length`), ticker
mesuré **après** upper-case et NFC (`ΐ` passe de 2 à 4 octets), description de 1 à 3 phrases et
280 caractères, site en `https://` seulement, X et Telegram normalisés en `https://x.com/<handle>`
et `https://t.me/<username>` (invitations en `t.me/+<hash>`). Erreurs typées
`{ field, code, max?, actual?, unit? }` sans texte ; les schémas zod `token*Schema` enveloppent les
mêmes fonctions et portent l'erreur dans `issue.params` (`tokenFieldErrorOf`). Les limites sont des
constantes uniques de `constants.ts` (`TOKEN_NAME_MAX_BYTES`, `TOKEN_TICKER_MAX_BYTES`,
`TOKEN_DESCRIPTION_MAX_SENTENCES`, `TOKEN_DESCRIPTION_MAX_CHARS`, `TOKEN_URL_MAX_LENGTH`), à relire
en V2-01 face à `create_v2`. `display.ts` fournit `formatTicker`, `formatLinkForDisplay` et
`missingRequiredFields` (nom et ticker seulement, §5).

### Wallets : import et messages sensibles (V1-12)

Deuxième façon d'obtenir un wallet, et le point le plus sensible de la V1 : aucun secret dans le
chat, la session, les logs ni en clair en base.

- **Écrans** ([screens.ts](apps/bot/src/features/wallets/screens.ts),
  [import.ts](apps/bot/src/features/wallets/import.ts)) : `wal:imp` ouvre IMPORT WALLET (l'avertissement
  « Never import a wallet that holds real funds… », le compteur `👛 Wallets: 2/5`, Back → liste),
  `wal:imp:key` et `wal:imp:seed` arment la saisie correspondante (les deux codes n'existent qu'une
  fois, dans `IMPORT_CODE` : `WALLET_CB.importFormat(format)` les écrit, `importFormatOf(code)` les
  relit). Le compteur vient de `wallets.getQuota(userId)` — un `count` et l'abonnement, jamais une
  lecture de soldes : atteinte, l'écran ne s'ouvre pas, la liste se réaffiche avec l'alerte et le
  flag « Wallet limit reached. ». Les saisies n'ont pas de ligne « Current » (un secret n'a pas de
  valeur courante) mais une expiration `⌛ Expires at 14:34 UTC` (`IMPORT_INPUT_TIMEOUT_MS`, 2 min,
  D18) et un Cancel qui ramène à la liste (§9.4).
- **Session** : `pendingInput = { kind: "wallet_import", format, expiresAt }` — **jamais le secret**.
  Expiration paresseuse : l'état reste jusqu'au prochain message, pour qu'une clé envoyée en retard
  soit quand même supprimée et que « Import expired. Please start again. » s'affiche ; fonctionne
  après un redémarrage (D16).
- **Garde** ([sensitive-input.ts](apps/bot/src/middleware/sensitive-input.ts)) : sur `message` et
  `edited_message` privés, texte et légende. Si un import attend (`waiting(ctx)` rend ce que la
  session porte, le middleware ignore tout le reste de la section), le texte est lu puis le message
  **supprimé avant toute validation** — un nouvel essai, sauf refus définitif de Telegram
  (`isUndeletable`, les 429 étant déjà repris par `autoRetry`) —, et le consommateur répond ; sinon, un texte que
  `looksLikePrivateKey` / `looksLikeSeedPhrase` (V1-09) reconnaît est supprimé et **la chaîne
  s'arrête**, donc il ne peut pas tomber dans une saisie ouverte pour autre chose (un Rename V1-11),
  suivi d'un message séparé sans bouton qui n'écrase pas l'écran courant. Une adresse publique et un
  texte normal passent. Suppression impossible → ligne « Couldn't delete your message. Delete it
  yourself now. » sur l'écran suivant. Une commande (`/…`) suit son cours normal et abandonne l'import.
- **Service** (`importWallet(userId, format, secret)`, [wallets.ts](packages/db/src/services/wallets.ts)) :
  ordre imposé par §9.4 — parsing (V1-09, injecté via `parseSecret`), puis insertion. Elle partage
  avec Create la transaction verrouillée (`pg_advisory_xact_lock` par utilisateur, limite et adresse
  relues dedans, nom `Wallet N`), qui est la seule autorité sur la limite : contrairement à Create,
  l'import ne pré-vérifie pas le quota, puisque la clé est déjà parsée quand il le saurait.
  Chiffrement **avant** le verrou (PBKDF2). `IMPORTED_KEY`
  avec `derivationPath` nul, ou `IMPORTED_SEED` avec `m/44'/501'/0'/0'` et la phrase normalisée
  chiffrée en plus de la clé (décision du 16/09/2026, récupération par le support via `/getall`,
  V1-43). Doublon `(userId, publicKey)` : contrôle dans le verrou **et** capture du `P2002` ; le même
  wallet réimporté dans l'autre format reste un doublon (la phrase n'est pas ajoutée), alors que deux
  utilisateurs peuvent détenir la même clé (§13). `secretKey.dispose()` dans un `finally`, quel que
  soit le résultat.
- **Fréquence** (D17) : `RATE_LIMITS.walletImport`, 5 tentatives / 10 min par utilisateur
  (proposition), comptées après l'expiration et avant le parsing — dépassement → « Too many import
  attempts. Try again in a few minutes. ». Un message de plus de `IMPORT_SECRET_MAX_CHARS`
  (1 000 caractères) est refusé sans être parsé — une constante, pas un schéma zod, comme
  `walletNameIssue` en V1-11 : l'appelant veut la raison.
- **Hygiène** : le plugin conversations n'est pas utilisé pour ces saisies (il persisterait l'update
  dans PostgreSQL) ; la redaction pino couvre maintenant `text` et `caption`, en plus des colonnes de
  clés ; aucune erreur de parsing ne remonte de message d'origine (un code). `DEBUG=grammy*` est
  interdit hors local : il trace les appels API. Telegram peut garder le secret dans une notification
  push sur l'appareil de l'utilisateur — hors de notre contrôle.
- **Tests** : [import.test.ts](apps/bot/src/features/wallets/import.test.ts) (écrans, ordre
  suppression → parsing, expiration à 2 min en fake timers, garde, « no leak » : le secret n'est ni
  dans les logs capturés, ni dans la session stockée, ni dans ce qu'on envoie à Telegram) ;
  `importWallet` dans [wallets.test.ts](packages/db/src/services/wallets.test.ts) et
  [wallets.int.test.ts](packages/db/src/services/wallets.int.test.ts) (vraie base, vrai coffre :
  adresse Phantom du vecteur 12 mots, phrase stockée normalisée même saisie en majuscules, aucun
  octet lisible dans la ligne `Wallet`).

### Wallets : retrait de SOL (V1-14)

Le seul moyen de sortir des fonds du bot (aucune clé n'est montrée, décision du 16/09/2026) :
adresse, avertissement éventuel, montant, confirmation, résultat. Il remplace les écrans provisoires
« Withdraw » (V1-10) et « Withdraw all » (V1-11), et consomme la brique V1-13.

- **Service** (`createWithdrawalService`, [withdrawals.ts](packages/db/src/services/withdrawals.ts),
  dans `db` comme les wallets de V1-10 : la table `Withdrawal` est aussi lue par `/getall` V1-43 et
  écrite par le balayage V1-45) : V1-13 est injecté sous la forme d'un `TransferApi`
  (`estimateFee`, `rentMin`, `prepare`, `send`, `lookup`, construit par
  [services/transfer.ts](apps/bot/src/services/transfer.ts) sur la connexion du process et les
  bornes de `.env`), avec le vault et le budget de frais de V1-11. `check(userId, walletId)` part
  de `readFreshWallet` ([balances.ts](packages/db/src/services/balances.ts), la lecture **sans
  cache** que Delete partage : pas le Refresh, pas de throttle), refuse un solde non lu ou sous le
  budget de frais (`nothing_to_withdraw`) et donne les frais estimés, Max (`computeMaxAmount`, dans
  `shared` désormais) et le minimum rent-exempt ; `quote(userId, walletId, to, amount)` résout
  25 % / 50 % sur le solde frais (`resolveWithdrawAmount`, arrondi inférieur au lamport, proposition)
  puis appelle `prepareTransfer` ; `execute(userId, walletId, to, amount)` lit les colonnes de clé de
  la ligne `Wallet` — la seule lecture hors vault, remise à `sendTransfer` qui déchiffre au moment
  de signer —, refuse une ligne PENDING de moins de `WITHDRAWAL_IN_FLIGHT_MS` (2 min, proposition :
  **le verrou qui survit à un redémarrage**), règle une ligne PENDING plus vieille depuis la chaîne
  (`lookupSignature` : posée → CONFIRMED, échouée → FAILED, absente → FAILED `BLOCKHASH_EXPIRED`,
  jamais diffusée → FAILED `NEVER_SENT`, encore en cours de vote → laissée PENDING), puis envoie :
  **une seule quote**, celle de V1-13, dont `onPrepared` écrit la ligne PENDING avant la diffusion,
  puis `onSubmitted` la signature avant la confirmation, et la fin en CONFIRMED (signature,
  `feeLamports`, `lamports` réellement déplacés — Max est recalculé à l'envoi) ou FAILED (`error` =
  code + détail court de V1-13, jamais un secret, 500 caractères) ; un résultat `landed: 'unknown'`
  laisse la ligne PENDING avec sa signature (proposition). `resolve(userId, walletId)` relit depuis
  la chaîne la dernière ligne PENDING du wallet — la base est la seule source de « en vol », pas la
  session. Une signature écrite par `onSubmitted` n'est jamais effacée par l'échec qui suit.
- **Écrans** ([withdraw-screens.ts](apps/bot/src/features/wallets/withdraw-screens.ts)) : en-tête
  de parcours V1-03 `📤 WITHDRAW` en 3 étapes « Address › Amount › Confirm », ou 2 en mode
  Withdraw all (`flows.WITHDRAW` / `flows.WITHDRAW_ALL`, proposition) ; les textes du contexte sont
  « Send the destination address. » et les libellés des boutons, tout le reste est proposé (D19).
  Étape 1 : saisie de l'adresse avec la ligne From, le solde et, en mode all, « Amount: Max ». Étape
  1 bis : avertissement hors courbe ed25519 avec « ⚠️ Continue anyway ». Étape 2 : Available, « ⛽
  Fees: ≈ 0.000005 SOL · Max: 2.499995 SOL » (`estimateTransferFee`, un appel RPC), 25 % / 50 % /
  Max / ✏️ Custom ; la saisie Custom écrit les bornes. Étape 3 : From, adresse complète en `code`,
  montant et frais **exacts** (`formatSolExact` : toutes les décimales non nulles, 3 au moins),
  « (Max) » quand c'est le solde, réseau. Résultat : succès avec la signature en lien
  `explorer.solana.com/tx/…?cluster=devnet` (D8), Back to wallet / Menu ; échec avec la raison
  (`txFailureText`, sur `en.tx.errors`), « Nothing was sent. » seulement sur `landed: 'no'`, le lien
  de la signature sur `unknown`, Try again / Back to wallet. Un montant refusé à l'étape 2 prend
  les deux textes plus courts de §9.5 (`en.wallets.withdraw.amount.refused`, par code) et sinon le
  texte de V1-13 (`refusalOf`, sur `warn`). Le minimum rent-exempt s'affiche « 0.00089 SOL » (5
  décimales, §9.5), pas au lamport.
- **Parcours** ([withdraw.ts](apps/bot/src/features/wallets/withdraw.ts)) : `openWithdraw(ctx,
walletId, { preset })` (nom fixé par V1-11) sur `wal:wd:<id>` et `wal:wdall:<id>` ; les étapes
  sont `wal:wx:<step>` (`go`, `p25`, `p50`, `max`, `cus`, `ok:<token>`, `re`), l'état en session
  `withdraw = { walletId, mode, toAddress?, amount?, confirmToken? }` (montant en chaîne, JSON n'a
  pas de bigint ; jamais un secret ni un solde) et les saisies `pendingInput = { kind:
"withdraw_address" | "withdraw_amount" }`. **L'état vit exactement le temps des écrans du
  parcours** : `showScreen` reçoit `withdraw: state` sur chacun d'eux et tout autre écran — Cancel
  et Back to wallet (`wal:v:<id>`), Menu, la liste, un blocage, le résultat d'un succès — l'efface,
  comme `pendingInput` ; un vieux bouton d'étape est « This button has expired ». Adresse :
  `solanaAddressSchema`, refus de celle du wallet source, `isOnCurve` (V1-09) pour le 1 bis ; un
  autre wallet de l'utilisateur est accepté. Chaque choix de montant passe par `quote` : refusé →
  étape 2 avec le flag et l'alerte de la règle (`⚠️ Insufficient funds (0.100 SOL missing)`, minimum
  rent-exempt, adresse vide) ; en mode all, un Max refusé bascule en mode normal (proposition). La
  confirmation est requotée à l'affichage et **porte un jeton** (`wal:wx:ok:<8 hex>`, rangé en
  session, remplacé à chaque affichage et dépensé avant l'envoi) : un second clic est un bouton
  périmé — ce jeton et la ligne PENDING remplacent le drapeau `inFlight` en session que la carte
  proposait (la session n'est écrite qu'à la fin de l'update, elle ne survivrait pas à un arrêt en
  plein envoi ; grammY traite les updates l'un après l'autre). Sur Confirm : refus à bas coût
  d'abord, avec alerte (`resolve` trouve une tentative encore PENDING, `RATE_LIMITS.withdrawal`
  5 / 10 min), puis la query est répondue tout de suite (`acknowledge`), l'écran « ⏳ Sending 1.250
  SOL… » sans bouton, `execute`, le résultat. Try again : `resolve` d'abord — confirmée → succès,
  encore PENDING → confirmation avec « ⚠️ A previous attempt may still go through. Check the
  explorer first. », sinon confirmation requotée (solde, frais).
- **Saisies** ([navigation/inputs.ts](apps/bot/src/navigation/inputs.ts)) : le routeur de saisies
  annoncé en V1-12 — un `createInputRouter()` où chaque section enregistre son handler par `kind`
  (`wallet_rename` de V1-11, `withdraw_address`, `withdraw_amount`), un seul `bot.on("message")`
  monté après le gate. Il porte les deux règles du garde V1-12, qui les lui emprunte désormais :
  `deleteMessageNow` (le message de l'utilisateur supprimé au mieux, proposition) et `isCommand` (une
  commande suit son cours). L'import reste consommé par le garde, avant la limite de fréquence.
- **Partagé** : `formatSolExact` (`formatSol` avec `minDecimals`) et `parseSolToLamports` qui accepte
  l'unité (`1 SOL`, `0,5sol`) dans `format/sol.ts` ; `computeMaxAmount` dans `wallets.ts` ;
  `WITHDRAWAL_PRESETS_PCT`, `WITHDRAWAL_IN_FLIGHT_MS`, `WITHDRAWAL_ERROR_MAX_CHARS` ;
  `en.wallets.withdraw.*` et `warn(text)` exporté (la paire `{ alert, flag }` d'une phrase) ;
  `E.destination` ; les textes `tx.errors` des règles de rente et de fonds acceptent un montant
  absent (une simulation refuse sans chiffre). V1-13 : `sendTransfer` prend un `TransferRequest`
  (les quatre champs qu'il relit) et un `onPrepared(quote)`, tout refus de `prepareTransfer` porte
  `rentMinLamports`, `lookupSignature` lit l'historique d'une signature et `outcomeOf` est la
  seule lecture d'un statut de signature — l'envoi l'utilise aussi, et un statut `processed` n'est
  **jamais** re-signé, même une fois le blockhash expiré (le bloc peut encore être confirmé).
- **Tests** : [withdraw.test.ts](apps/bot/src/features/wallets/withdraw.test.ts) (écrans sur les
  maquettes de §9.5, adresse invalide / du wallet / hors courbe, Cancel et Menu qui ferment le
  parcours, parts, Custom avec virgule et unité, refus avec flag, Confirm → Sending → résultat, double
  Confirm → un seul envoi, limite de fréquence, tentative en vol, échec → Try again, résultat inconnu
  → `resolve`, Withdraw all en deux étapes) ;
  [withdrawals.test.ts](packages/db/src/services/withdrawals.test.ts) (V1-13 simulé : lignes
  CONFIRMED / FAILED / PENDING, Max recalculé, verrou en vol, règlement d'une ligne périmée, bloc
  encore en cours de vote) et
  [withdrawals.int.test.ts](packages/db/src/services/withdrawals.int.test.ts) (vraie base : §13,
  ligne conservée sans wallet après suppression). Le harnais du bot expose `fakeWithdrawals`,
  `testQuote`, `testWithdrawal` ; celui de `db` `testTransferQuote`.

### Transactions Solana : frais, envoi et confirmation (V1-13)

La brique d'envoi vit dans [packages/solana/src/tx/](packages/solana/src/tx/) : aucun écran, aucune
table, aucune lecture de `process.env`. Comme le vault, tout est injecté —
`TxContext = { rpc, priorityFee: { minMicroLamports, maxMicroLamports } }`, plus un `wait` que les
tests remplacent. Le retrait (V1-14), Pay from my wallet (V1-31), le transfert vers la trésorerie
(V1-33) et la V2 passent tous par là. **Déviation assumée** : la connexion et les bornes voyagent
ensemble dans un contexte plutôt qu'en paramètres séparés à chaque appel, parce que chaque fonction a
besoin des deux. Le `rpc` du contexte doit être la connexion du process (`getSolanaRpc`) : le cache
du minimum rent-exempt est indexé dessus.

- **Priority fee** (§12, [priority-fee.ts](packages/solana/src/tx/priority-fee.ts)) : médiane de
  `getRecentPrioritizationFees` sur les comptes **écrits** (payeur inclus), dédupliqués, 128 au plus
  (limite RPC). Les zéros comptent ; nombre pair → moyenne des deux valeurs centrales arrondie au
  supérieur (proposition) ; liste vide ou RPC muet → `PRIORITY_FEE_MIN_MICROLAMPORTS` et un
  avertissement, jamais d'échec. Bornée par la config, lue **juste avant chaque envoi** et à chaque
  tentative, sans cache. Sur devnet les fees sont souvent à 0 : la médiane vaut 0, donc le MIN.
- **Compute units** ([compute-units.ts](packages/solana/src/tx/compute-units.ts)) : brouillon à
  `SetComputeUnitLimit(1 400 000)` + `SetComputeUnitPrice(MIN des bornes)` + les instructions métier,
  `simulateTransaction` (`sigVerify: false`, `replaceRecentBlockhash: true`, `confirmed`) → limite =
  `min(1 400 000, ceil(unitsConsumed × 1,2))` (`CU_MARGIN`, proposition). La simulation part **en
  parallèle** de la lecture de la priority fee (les unités consommées ne dépendent pas du prix) et se
  fait au plancher des bornes : au prix du moment, le plafond de 1,4 M d'unités deviendrait des frais
  que la vraie transaction ne paie jamais, et refuserait un wallet qui a de quoi. Aucune signature
  n'est nécessaire : **aucune clé n'est déchiffrée pour estimer**. Une simulation en erreur n'envoie
  rien et rend un `TxFailure` (logs tronqués : 5 lignes, 200 caractères) ; une simulation sans
  `unitsConsumed` lève, plutôt que demander le plafond et le payer.
- **Frais estimés** ([fees.ts](packages/solana/src/tx/fees.ts)) : `BASE_FEE_LAMPORTS` (5 000) ×
  nombre de signatures + `priorityFeeLamports(limite demandée, µL)` = `ceil(limite × µL / 1 000 000)`,
  disponible avant la confirmation pour le « ≈ » de l'écran. La formule vit dans `shared`
  (`wallets.ts`) : `transferFeeLamports(µL)` est le prix d'un transfert standard, et le budget de
  V1-11 `getWithdrawFeeBudgetLamports(max)` n'est plus que `transferFeeLamports(max)`.
  `getFeeForMessage` n'est pas utilisé (il faudrait vérifier à chaque version du RPC qu'il ne compte
  pas la priority fee deux fois) et la carte proposait un `LAMPORTS_PER_SIGNATURE` :
  `BASE_FEE_LAMPORTS` dit déjà la même chose, une seule constante.
- **Rent-exempt** ([rent.ts](packages/solana/src/tx/rent.ts)) :
  `getMinimumBalanceForRentExemption(0)` (890 880 lamports sur devnet), **aucune valeur en dur** hors
  tests, `createTtlCache` d'une heure par connexion (`CACHE_TTL_MS.rentMin`, `WeakMap`, proposition).
  web3.js répond **0** à une erreur JSON-RPC sur cet appel : refusé, un compte vide n'est jamais
  gratuit.
- **Transfert** ([transfer.ts](packages/solana/src/tx/transfer.ts)) : `prepareTransfer` lit soldes et
  minimum rent-exempt en parallèle, **sans le cache de 30 s de V1-07**, refuse d'abord ce qui ne coûte
  rien (montant ≤ 0, au-dessus du solde, poussière vers une adresse vide), puis simule le vrai
  transfert — en mode `max`, sur un montant provisoire (`rentMin`, ou 0 si le solde est en dessous),
  jamais le solde entier qui échouerait faute de frais — et applique `validateTransfer` :
  `INVALID_AMOUNT`, `INSUFFICIENT_FUNDS` (avec le manque exact), `REMAINING_BELOW_RENT` (un reste
  entre 0 et 890 880 est refusé, 0 est valide, `maxLamports` dit quoi envoyer), `DESTINATION_BELOW_RENT`.
  `sendTransfer` **refait le devis** (`prepareTransfer`, soldes et destination relus, frais
  ré-estimés) puis envoie avec un `build(fee)` qui recalcule le montant Max et rejoue les règles
  pour les frais de chaque tentative : un devis confirmé trop tard est refusé plutôt qu'envoyé de
  travers. `computeMaxAmount = solde − frais` laisse exactement 0.
- **Envoi et confirmation** ([send.ts](packages/solana/src/tx/send.ts)) : message **v0** systématique
  (uniforme avec V2-03), blockhash `confirmed`, preflight au premier envoi puis renvoi des **mêmes
  octets** toutes les 2 s tant que la hauteur de bloc ≤ `lastValidBlockHeight` — sauf quand la
  transaction est déjà dans un bloc (`processed`) ; `onSubmitted(signature)` avant la confirmation
  (V1-14 écrit la ligne PENDING). Jamais de re-signature tant que l'ancien blockhash est valide.
  Hauteur dépassée → `getSignatureStatuses` avec `searchTransactionHistory` : trouvée = succès,
  absente = nouvelle tentative (`TX_MAX_ATTEMPTS` = 2, priority fee relue, unités de la première
  simulation conservées, transaction re-signée, montant Max recalculé), puis `BLOCKHASH_EXPIRED`
  avec `landed: 'no'`. La confirmation est un sondage HTTP, pas `confirmTransaction` qui ouvre un
  websocket, borné par `TX_CONFIRM_TIMEOUT_MS` (2 min). **Après le premier envoi, plus rien ne
  lève** : la signature revient toujours, au besoin en `CONFIRMATION_UNKNOWN` / `landed: 'unknown'`.
- **Signature** : `vault.withSigner(enc, address, fn)` (V1-09) est la seule voie, appelée **après** la
  simulation et l'estimation, imbriquée quand plusieurs clés chiffrées signent ; un signataire
  éphémère (le mint de V2-03) est accepté tel quel. Un signataire manquant lève — c'est un bug
  d'appelant, pas un échec utilisateur — et le message ne nomme que des clés publiques.
- **Échecs** ([errors.ts](packages/solana/src/tx/errors.ts)) : huit codes (`TX_FAILURE_CODES` dans
  `shared`, pour que la liste et les textes `en.tx.errors` ne dérivent pas), `landed`
  (`no` / `yes` / `unknown` — `en.tx.nothingSent` ne s'ajoute que sur `no`), les montants que l'écran
  formate, et un `detail` court (120 caractères) pour les logs : un code programme, **jamais un
  secret** (§9.6). Un code `Custom` est lu **par programme** : `programsOf(draft)` donne le programme
  de chaque instruction du message compilé (la paire Compute Budget d'abord) et `PROGRAM_ERRORS` dit
  ce qu'un code y signifie — `Custom(1)` du System program est « fonds insuffisants », le même code
  d'un autre programme reste un rejet ; pump.fun ajoutera sa ligne (V2-03). Les deux formes sont
  lues : l'objet d'une simulation ou d'une transaction posée, et le message d'un envoi que le
  preflight a refusé (`SendTransactionError.transactionError`, web3.js ne garde que le texte).
  L'indisponibilité du RPC est classée **une seule fois, au transport** : le `fetch` de
  `getSolanaRpc` ([rpc.ts](packages/solana/src/rpc.ts)) lève `RpcUnavailableError` sur timeout,
  panne réseau, 429 et 5xx, et web3.js la laisse passer intacte pour toutes les méthodes utilisées
  — aucun libellé de bibliothèque à reconnaître.
- **V1-11** : `getWithdrawFeeBudgetLamports()` reste la borne haute affichée avant toute simulation,
  et un test la garde ≥ aux frais réels au plafond des bornes. `estimateTransferFee(ctx, from)` =
  `transferFeeLamports(priority fee du moment)`, **un seul appel RPC**, sans simuler : c'est le seuil
  « solde au-dessus des frais d'un retrait ».
- **Tests** : faux RPC scripté [tx/test-rpc.ts](packages/solana/src/tx/test-rpc.ts), à côté du code
  comme `keys/test-vectors.ts` — il enregistre chaque appel **et chaque déchiffrement**
  (`vaultSigner(calls)`), ce qui permet d'affirmer l'ordre (priority fee → simulation → blockhash →
  `withSigner` → envoi) et qu'une simulation en échec ne déchiffre rien ; il répond toujours de façon
  asynchrone, comme une `Connection`, et lève les vraies classes (`RpcUnavailableError`,
  `SendTransactionError`). Médiane, bornes, marge, plafond, mapping de chaque erreur, règles de
  §9.5, renvoi à l'octet près, deux tentatives avec le montant Max qui suit les frais, statut
  retrouvé dans l'historique, RPC en panne, et un test « aucune clé dans les logs ». Le test devnet
  (0,001 SOL entre deux keypairs, `meta.fee` = frais estimés, Compute Budget présent dans les
  bornes) est derrière `RUN_DEVNET_TESTS=1` (`pnpm test:devnet`), la variable déjà en place — la
  carte proposait `SOLANA_INTEGRATION_TESTS`, une deuxième aurait dit la même chose.

### Wallets : renommer et supprimer (V1-11)

[rename.ts](apps/bot/src/features/wallets/rename.ts) et
[delete.ts](apps/bot/src/features/wallets/delete.ts) ajoutent `wal:ren`, `wal:del`, `wal:delok` et
`wal:wdall` au domaine ; [nav.ts](apps/bot/src/features/wallets/nav.ts) porte les écrans communs
(liste, détail, repli « no longer exists », clic bloqué sur le détail) que tous les handlers de la
section partagent.

- **Rename** : écran de saisie (`renderInputScreen`, qui accepte maintenant des `flags`), Cancel →
  détail (proposition). L'écran est affiché avec `showScreen(…, { input: { kind: "wallet_rename",
walletId } })` : `showScreen` écrit `session.pendingInput` (D16, survit à un redémarrage) et
  **tout autre écran l'efface**, quel que soit le clic ou la commande qui y mène — un clic qui ne
  répond que par un toast (bouton périmé) garde la saisie ouverte. Le message de réponse est
  **supprimé** (best effort) et l'écran est réédité en place : `showScreen(…, { mode: "edit" })`
  édite `session.screenMessageId` hors d'un clic. Règles dans `walletNameIssue` /
  `normalizeWalletName` (`@launchbot/shared`, pas de schéma zod : l'appelant veut la raison) :
  trim, espaces multiples réduits, 1 à 32 **points de code**, retour ligne ou caractère de contrôle
  refusé ; doublon insensible à la casse dans le service, la contrainte `(userId, name)` en filet
  (`P2002` → doublon). Même nom : aucune écriture. Un refus rend le wallet tel quel, l'écran de
  saisie se réaffiche sans relecture, avec l'erreur sous les règles.
- **Delete** : `checkDeletable` relit le solde **sans cache** (contrôle de sécurité, hors throttle
  Refresh) ; un solde `stale` ou `unavailable` refuse (« Couldn't check the balance… »), un
  `Withdrawal` PENDING refuse (proposition), un solde au-dessus du budget de frais → écran de
  blocage avec « 📤 Withdraw all » (`wal:wdall:<id>`, le retrait de V1-14 avec Max choisi) ; sinon
  confirmation. « Yes, delete » refait le contrôle (un dépôt a pu arriver : alerte « This wallet
  received SOL. Withdraw it first. » + écran de blocage), puis `deleteMany({ id, userId })` : la
  ligne et sa clé disparaissent, `Withdrawal.walletId` passe à `null` (SetNull), le cache des soldes
  est invalidé, la liste s'ouvre avec « ✅ Wallet deleted. ». Double clic → « no longer exists ».
- **Seuil** (`@launchbot/shared`) : `getWithdrawFeeBudgetLamports(env.PRIORITY_FEE_MAX_MICROLAMPORTS)`
  = 5 000 + ⌈max × 1 000 / 10⁶⌉ lamports (constantes `BASE_FEE_LAMPORTS`,
  `TRANSFER_COMPUTE_UNIT_LIMIT`), injecté dans le service ; `isBalanceWithdrawable(lamports, budget)`
  = strictement au-dessus. À aligner sur V1-13. Un solde qui s'arrondit à `0.000` s'affiche
  `< 0.001 SOL`.
- Logs `wallet.renamed` / `wallet.deleted` avec `userId` et `walletId` seulement.

### Wallets : liste, détail, création (V1-10)

`registerWallets` ([apps/bot/src/features/wallets/wallets.ts](apps/bot/src/features/wallets/wallets.ts))
branche le domaine `wal` : `wal:list` (le bouton « 👛 Wallets » du menu), `wal:lref` (Refresh de la
liste), `wal:new` (Create), `wal:v:<id>` (détail), `wal:ref:<id>` (Refresh du détail), l'import
(V1-12), le rename et le delete (V1-11), et le retrait `wal:wd:<id>` / `wal:wx:<step>` (V1-14).
Les valeurs sont dans `WALLET_CB` ([screens.ts](apps/bot/src/features/wallets/screens.ts)) et
`WITHDRAW_CB`, les tickets suivants les reprennent.

- **Service** `createWalletService` dans `@launchbot/db`
  ([packages/db/src/services/wallets.ts](packages/db/src/services/wallets.ts)) et non dans
  `@launchbot/solana` comme le proposait la carte : il est fait de Prisma, et `db` ne dépend pas de
  `solana`. Le vault (`encrypt`, `encryptMnemonic`) et `generateMnemonicWallet` y sont **injectés**,
  comme le lecteur de lamports du service des soldes. `listWithBalances(userId, { skipCache? })`
  rend les soldes de V1-07 plus `count` / `limit` ; `getOwned(userId, walletId)` trouve le wallet dans
  ces soldes, donc jamais celui d'un autre utilisateur ; `getQuota` (count / limit / reached, sans
  lecture de soldes), `nextDefaultName` (`Wallet N`, N = nombre de wallets + 1, puis le premier nom
  libre) et `create`.
- **Create** (§9.3) : limite lue hors verrou, génération et chiffrement (PBKDF2) hors transaction,
  puis transaction avec `pg_advisory_xact_lock` par utilisateur (proposition) qui **revérifie la
  limite** et insère : deux clics à limite − 1 créent un seul wallet. Une collision de nom
  (`P2002` sur `userId, name`, un rename qui court en parallèle) fait réessayer avec le nom
  suivant, trois fois au plus. La clé est remise à zéro dans un `finally` ; `create` ne rend que
  `{ id, name, publicKey, createdAt }`, jamais la clé ni la phrase. Le cache des soldes de
  l'utilisateur est invalidé : accueil et liste voient le wallet tout de suite.
- **Écrans** (purs, `buildWalletListScreen` / `buildWalletDetailScreen`) : compteur `2/5` dans
  l'en-tête, `5/5 · limit reached` dès `count ≥ limit` (les wallets en trop restent affichés et
  utilisables, §8.1) ; sans wallet, « No wallet yet. Create or import one to get started. » ; prix
  SOL inconnu → aucun `$` ; soldes illisibles → `— SOL` et le flag
  « ⚠️ Balances unavailable right now. Tap Refresh to try again. ». `🕒 Updated` (heure de
  lecture RPC, `fetchedAt`) est sous le Total, comme sur la maquette, donc les flags et la notice
  d'action arrivent en dernier, juste au-dessus du clavier. Noms échappés HTML dans le texte, bruts
  dans les boutons. Explorer : `ui.explorerAddressUrl` (`?cluster=devnet`, D8).
- **Refresh** : `mayReadFreshBalances(ctx)`, le même compteur 10 s que l'accueil ; écran identique
  → toast « Already up to date ». Le prix n'est jamais forcé.
- **Clics bloqués** (§4.5) : `en.wallets.limitReached` et `en.wallets.notFound` (id supprimé ou
  d'un autre utilisateur) sont des paires `{ alert, flag }` : alerte, puis liste rééditée avec le
  flag.
- Tests : `wallets.test.ts` (bot : rendus, claviers, tailles de callback avec un uuid, handlers sur
  `botHarness({ wallets })`), `wallets.test.ts` (db : service sur une table en mémoire, verrou
  simulé par une file), `wallets.int.test.ts` (db, `RUN_DB_TESTS=1` : vrai vault, `/getall`
  retrouve clé et phrase, deux `create` concurrents). `@launchbot/solana` est une **dépendance de
  test** de `db` pour ce dernier.

### Clés des wallets (V1-09)

Les primitives de sécurité des wallets vivent dans `@launchbot/solana`
([packages/solana/src/keys/](packages/solana/src/keys/)), sans écran et sans lecture de
`process.env` : la clé maître est injectée, un vault par process.

- **`createKeyVault(env.WALLET_ENCRYPTION_KEY)`** : `encrypt(secretKey, address)` et
  `encryptMnemonic(mnemonic, address)` chiffrent en AES-256-GCM (IV aléatoire de 12 octets à chaque
  appel, tag de 16 octets) vers les colonnes `Wallet` / `Payment` de V1-02. L'adresse sert d'AAD
  (proposition), préfixée `mnemonic:` pour la seed phrase : un chiffré recopié sur une autre ligne,
  ou une mnemonic déchiffrée comme clé, échoue. `encrypt` refuse une clé qui n'appartient pas à
  l'adresse.
- **Deux sorties du vault seulement** (§9.6) : `withSigner(enc, address, fn)` construit le signataire
  le temps de `fn` puis remet la clé à zéro, même si `fn` lève ; `revealWalletSecrets(wallet, vault)`
  rend la clé en base58 (format « Import private key » de Phantom) et la phrase normalisée, pour
  `/getall` seulement — ESLint refuse son import hors de
  `apps/bot/src/features/admin/reveal.ts` (V1-43) et des tests (proposition). Elle lit la clé
  maître par un `WeakMap` interne, pas par une méthode du vault.
- **Erreurs** : `KeyDecryptionError` (« Wallet key decryption failed. », tag, IV, clé maître ou AAD
  faux, sans `cause`), `KeyIntegrityError` (clé publique dérivée ≠ adresse ; ligne mnemonic
  incomplète ou présente sur un `IMPORTED_KEY` ; phrase qui ne dérive pas l'adresse),
  `InvalidMnemonicError`, `InvalidMasterKeyError`. Aucune ne contient d'octet.
- **Génération** : `generateMnemonicWallet()` (12 mots anglais, `@scure/bip39`) et
  `generateKeypair()` (32 octets CSPRNG, sans mnemonic : dépôts V1-28, mint V2-03).
- **Import** (§9.4) : `parsePrivateKey` (base58 de 64 octets, espaces autour tolérés, tableau JSON
  refusé) et `parseSeedPhrase` (NFKD, minuscules, 12 ou 24 mots, checksum), raison d'échec interne
  (`invalid_base58`, `invalid_length`, `public_key_mismatch`, `invalid_word_count`,
  `invalid_mnemonic`). Dérivation SLIP-0010 ed25519 maison (`keys/slip10.ts`, ≈ 20 lignes) sur
  `m/44'/501'/0'/0'` (`SOLANA_DERIVATION_PATH`), validée par les vecteurs de la spec SLIP-0010 et
  recoupée avec `ed25519-hd-key` : `abandon` ×11 + `about` → `HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk`
  (l'adresse de Phantom), `abandon` ×23 + `art` → `3Cy3YNTFywCmxoxt8n7UH6hg6dLo5uACowX3CFceaSnx`.
  Pas de passphrase BIP39 (« 25e mot »).
- **Adresses** (§9.5) : `isValidSolanaAddress` (32 à 44 caractères base58, 32 octets, sans trim)
  et `solanaAddressSchema` (zod, trim puis validation) vivent dans `@launchbot/shared`
  (`solana-address.ts`, la même règle valide `TREASURY_WALLET`) et sont réexportés par
  `@launchbot/solana` à côté de `isOnCurve` (faux pour une PDA, ex. le Global de pump.fun →
  « Continue anyway » en V1-14), qui a besoin de la bibliothèque.
- **Heuristiques** du garde de V1-12 : `looksLikePrivateKey` (jeton base58 de 80 à 90 caractères qui
  décode 64 octets, ou tableau JSON de 64 octets) et `looksLikeSeedPhrase` (12 mots consécutifs dont
  11 dans la wordlist). Seuils en constantes du module (proposition).
- **Hygiène** : `SecretBytes` (un `Uint8Array` qui s'affiche `[REDACTED]` en JSON, texte et
  `util.inspect`, `dispose()` le remet à zéro) ; les résultats qui portent une phrase ou une clé
  en texte (`generateMnemonicWallet`, `parseSeedPhrase`, `revealWalletSecrets`) s'affichent de
  même. Le logger
  masque aussi `privateKeyBase58`. L'effacement reste best effort en JavaScript (copies internes
  des bibliothèques, chaînes) : un secret ne vit que le temps d'une opération, jamais en session.
  PBKDF2 (génération, import de seed) prend quelques dizaines de ms : hors transaction verrouillée.

### Accueil et menu principal (V1-08)

`registerHome` ([apps/bot/src/features/home/home.ts](apps/bot/src/features/home/home.ts)) branche
`/start` (toujours un nouveau message), `nav:home` — la cible unique de Back et de Menu, en édition —,
le Refresh et la reprise `home` du premier accès.

- `loadHomeData` lit les cinq sources en parallèle. Aucune ne peut empêcher l'affichage : prix
  inconnu → `SOL —` et **aucun** montant USD ; membres inconnus → `— members` ; soldes jamais lus →
  `2 wallets · balance unavailable`. `buildHomeScreen` et `computeNextStep` sont purs.
- **Refresh** (`home:refresh`) : `mayReadFreshBalances(ctx)` autorise une lecture des soldes sans
  cache au plus une fois par 10 s et par utilisateur (`RATE_LIMITS.refresh`, partagée par tous les
  boutons Refresh : accueil, détail de wallet, Dev buy). Trop tôt, le Refresh lit le cache, sans
  message. Le prix n'est jamais forcé. « Updated » est à la minute : un Refresh sans changement dans
  la même minute donne l'écran identique, que Telegram refuse d'éditer → toast « Already up to date ».
- Callback data du menu (`MENU` dans
  [screen.ts](apps/bot/src/features/home/screen.ts)) : `lc:open`, `sim:open`, `sub:open`,
  `wal:list`, `sup:open`, `home:refresh`, plus `nav:home`. Les tickets de section reprennent
  **exactement** ces valeurs.
- Sections pas encore livrées : `router.registerProvisional` enregistre un écran **provisoire**
  sur leur domaine, que le `router.register` du ticket de la section remplace sans rien retirer
  nulle part. Toutes les sections du menu sont livrées depuis V1-40 (Support) : l'écran « Coming
  soon » de V1-08 est supprimé, le mécanisme reste pour la V2.

Routeur de callbacks : `router.register(domain, { action: handler })`. Un domaine ou une action
inconnus reçoivent « This button has expired » du routeur lui-même, aucun handler n'a à le faire.

Un clic bloqué (§4.5) est une paire `{ alert, flag }` de `en.ts`, passée à `blockWithFlag` : l'alerte
et la ligne écrite à l'écran vont toujours ensemble. `tooManyActions(retryAfterMs)` donne la paire
d'une action trop fréquente.

Les tests du bot tournent sur `botHarness()` ([test-harness.ts](apps/bot/src/test-harness.ts)) : faux
Telegram, fausse base, faux services de données. Sans l'option `data`, `createBot` branche le vrai RPC
et CoinGecko. L'option `admin` remplace les services des commandes admin (`fakeAdmin`), et personne
n'est admin tant qu'un test ne met pas `ADMIN_ID` dans `ADMIN_TELEGRAM_IDS`.

### Services de données (V1-07)

Les lectures derrière l'accueil et les écrans suivants, sans aucun affichage. `createDataServices`
([apps/bot/src/services/data.ts](apps/bot/src/services/data.ts)) les assemble, une instance par
process : les caches (§4.3) vivent dedans, en mémoire.

| Service                                                    | Où                  | Cache                                        |
| ---------------------------------------------------------- | ------------------- | -------------------------------------------- |
| `getSolUsdPrice`, `getSolUsdQuote`                         | `@launchbot/solana` | 60 s, échecs compris ; repli 10 min          |
| `getUserBalances(userId, { skipCache? })`                  | `@launchbot/db`     | 30 s par utilisateur                         |
| `countActiveSubscribers`                                   | `@launchbot/db`     | 60 s                                         |
| `getBotChannelMemberCount`                                 | `apps/bot`          | 10 min ; en erreur, dernière valeur connue   |
| `getActiveSubscription`, `getPlanStatus`, `getWalletQuota` | `@launchbot/db`     | aucun : une activation se voit tout de suite |
| `getBalancesFresh(rpc, addresses)`                         | `@launchbot/solana` | aucun : contrôles internes, un appel groupé  |

- **Prix SOL/USD (D11)** : CoinGecko Simple Price, sans clé, un appel par minute au plus — y compris
  quand l'API est en panne. En échec, le dernier prix connu sert pendant 10 min (âge recalculé à
  chaque lecture), puis `null` : les écrans masquent alors **tous** les montants USD, et aucune
  facture n'est créée. `SOL_PRICE_API_URL` est optionnel ; une autre URL doit répondre au même format
  `{"solana":{"usd":103.36}}`. Un autre fournisseur s'ajoute derrière `SolPriceProvider`.
- **RPC** : `getSolanaRpc(env.SOLANA_RPC_URL)` est la seule connexion du process, en `confirmed`,
  celle que le garde-fou devnet a vérifiée. Chaque appel a un timeout de 5 s et les 429 ne sont pas
  rejoués en silence : le bot traite une update à la fois, un RPC qui traîne bloquerait tout le monde.
  Ne jamais loguer son URL (`rpcHost` donne l'hôte).
- **Soldes** : un seul `getMultipleAccountsInfo` par lecture (par paquets de 100), lamports en
  `bigint`, un compte inexistant vaut 0. Créer, importer ou supprimer un wallet fait ignorer le
  cache. `getUserBalances` **ne lève jamais** pour une panne du RPC, et rend toujours les wallets :
  `status` vaut `fresh`, `stale` (derniers soldes lus) ou `unavailable` (`lamports: null`). Une
  décision d'argent (retrait, paiement) lit `getBalancesFresh`, qui lève. `@launchbot/db` ne dépend
  pas de `@launchbot/solana` : le lecteur de lamports est injecté.
- **Valeurs partagées qui peuvent tomber** (prix, membres du canal) : `createLastKnownValue`
  (`@launchbot/shared`) met en cache l'issue de la tentative, échecs compris, et sert la dernière
  valeur connue pendant la panne. Les lectures Telegram qu'un écran attend (`getChatMember`,
  `getChatMemberCount`) ont un timeout de 5 s (`readTimeout()`).
- `createTtlCache` (`@launchbot/shared`) sert aux caches à clés : single-flight, un chargement
  rejeté n'est pas mis en cache, `peek` rend une valeur expirée.
- Rien ne relit l'environnement en douce : `getSolanaRpc(env.SOLANA_RPC_URL)` et
  `createCoinGeckoProvider(env.SOL_PRICE_API_URL)` reçoivent leur configuration.
- `usdOf(lamports, price)`, `isWalletReady` et `getWalletLimit` sont dans `@launchbot/shared`.

### Premier accès (V1-06)

Aucun menu avant d'avoir rejoint le canal du bot : c'est le seul écran du premier accès depuis le
retrait des Terms et de la Privacy Policy (25/09/2026, V1-41 ; il y avait avant un écran « I accept »).
`createAccess` ([apps/bot/src/features/access/access.ts](apps/bot/src/features/access/access.ts))
fournit tout ; les parcours s'y branchent depuis `createBot`, comme le fait l'accueil :

- `gate` : à **chaque** message ou clic, `channelCheckedAt === null` → écran canal. Seul le bouton
  `acc:join:*` passe toujours ; le « I accept » d'un ancien écran Terms (`acc:terms`) reçoit le texte
  des boutons expirés. Aucun appel à Telegram ici : `ctx.user` est déjà chargé.
- `ensureChannelMembership(ctx, { mode, resume, display? })` : `true` si l'utilisateur est dans le
  canal, sinon affiche l'écran canal et renvoie `false`. `/start` l'appelle en mode `cached` (10 min,
  sans appel à Telegram tant que la dernière vérification positive est récente) ; Launch Coin (V1-35)
  l'appellera en mode `fresh` avec `resume: "launch"`, ce qui ajoute la note « Join the channel to
  launch a coin. » à l'écran.
- `registerResume(key, handler)` : où « I've joined » ramène l'utilisateur. `home` est l'accueil ;
  une clé inconnue retombe sur `home`. Le bouton porte la clé (`acc:join:launch`), donc l'écran se
  redessine à l'identique après un clic non concluant.
- `createMembershipCheck` ([channel-membership.ts](apps/bot/src/services/channel-membership.ts)) : la
  logique seule, sans écran. `channelCheckedAt` est la date de la dernière vérification
  **positive** : non membre → `null`, erreur de Telegram → inchangé, et refus (fail closed).
  `ctx.user` suit ce que la vérification a écrit.

« I've joined » est limité à 5 clics par 30 s (`RATE_LIMITS.channelCheck`, proposition) : chaque clic
coûte un `getChatMember`.

Au démarrage, `checkChannelRights` vérifie que le bot est administrateur des trois canaux avec le
droit de publier. Un défaut donne un log `error` qui nomme la variable (`CHANNEL_SUCCESS_ID`…) et
n'arrête pas le bot : on corrige les droits dans Telegram, sans redémarrer. Si le bot n'administre pas
le canal du bot, `getChatMember` échoue et **personne ne passe l'écran canal**.

Rejouer le premier accès avec son propre compte : remettre `channelCheckedAt` à `NULL` sur sa ligne
`User` (`pnpm db:studio`).

## Abonnement

Règles pures dans `packages/shared/src/subscription/` (sans Prisma : bot, worker et builders
d'écrans les lisent), partie base dans `packages/db/src/services/` (`subscriptions.ts`,
`payments.ts`, `wallet-payments.ts`, `treasury.ts`, `reminders.ts`), écrans dans
`apps/bot/src/features/subscribe/`, jobs de fond dans `apps/worker/`.

Seed de dev pour les variantes de l'écran des offres : `pnpm db:seed` donne un Premium qui finit
dans 28 h ; `SEED_PLAN=CLASSIC` un Classic, `SEED_HOURS=200` une fin au-delà de 72 h
(« until 12 Oct »), `SEED_HOURS=-1` un abonnement expiré. Sous PowerShell :
`$env:SEED_PLAN="CLASSIC"; pnpm db:seed`. L'utilisateur est le premier id de `ADMIN_TELEGRAM_IDS`.

### Worker : détection des paiements, trésorerie, rappels (V1-32 à V1-34)

`apps/worker` est un process à part (`pnpm --filter @launchbot/worker dev`, lancé aussi par
`pnpm dev`) : `src/main.ts` → `runProcess([createWorkerService()])`. Au démarrage, dans l'ordre :
env, garde-fou devnet (le worker signe les transferts des dépôts et des comptes inactifs), base
(`assertDatabaseReachable`, partagé avec le bot), `getMe` sur `BOT_TOKEN`, avertissement si
`TREASURY_WALLET` n'existe pas encore sur le devnet (l'alimenter une fois au faucet), pg-boss,
files et crons, puis la boucle. Telegram par `new Api(token)` seulement : jamais de polling, qui
couperait celui du bot (409). Arrêt : la boucle finit son tick, le verrou est rendu, les jobs ont
30 s (`boss.stop`), puis Prisma ; un second Ctrl+C sort tout de suite (`runProcess`).

- **pg-boss 12.34.0** (version figée), schéma `pgboss` que Prisma ne voit pas. Files en politique
  `exclusive` : un seul job en attente ou actif par `singletonKey` (l'id de la facture), et un
  cron ne se chevauche jamais. Crons en UTC, sans retry (le passage suivant réessaie), leur file
  interrogée toutes les 30 s (2 s pour « Payment received » et les transferts).
- **Boucle de paiement** (`runEvery`, 15 s, jamais deux ticks à la fois, un tick lent enchaîne
  aussitôt) : `listInvoicesToCheck` → `checkInvoicesBatch` (un appel RPC par 100 adresses) →
  `expireDueInvoices`, puis pour chaque facture que le worker a lui-même activée
  (`activatedNow`) : `payments.notify-paid` et le transfert vers la trésorerie. Une seule
  instance tourne la boucle : verrou advisory de session sur une connexion `pg` à elle
  (proposition), une instance en attente réessaie toutes les 30 s.
- **« Payment received »** : nouveau message, écran de V1-30 (`buildPaymentReceivedScreen`), plan
  et fin relus au moment de l'envoi (`getPaidNotice`, prolongation comprise). Bot bloqué ou chat
  inconnu → rien à refaire ; 429 → `auto-retry` attend, puis pg-boss réessaie (5 fois,
  backoff), comme pour une erreur réseau ou 5xx.
- **Trésorerie** (`createTreasuryService`) : `deposits.sweep` (8 retries, 30 s doublés) vide un
  dépôt en mode `max` (solde − frais, 0 restant) vers `TREASURY_WALLET`. Chaque transfert est une
  ligne `Withdrawal` de type `DEPOSIT_SWEEP`, enregistrée comme un retrait (`sendRecorded` et
  `settleTransfer` de `withdrawals.ts`, communs aux deux) : ligne écrite avant la signature,
  signature avant la confirmation, une issue inconnue relue avant tout nouvel essai, jamais
  renvoyée. La confirmation et la mise à jour de la facture passent dans une transaction.
  PAID → SWEPT à l'activation par le worker et par le cron `deposits.sweep-paid` (chaque minute,
  rattrape « I've paid » et le paiement depuis un wallet). `deposits.watch` (toutes les 5 min)
  surveille 30 jours les adresses déjà vidées et celles des factures expirées ou annulées, jamais
  avant la fin de leurs 24 h + 2 min ; cas `OLD_ADDRESS`, `LATE_FULL_PAYMENT`, `PARTIAL_EXPIRED` →
  alerte admin après le transfert (montants exacts au lamport, liens explorer, expéditeur du
  dernier dépôt si le RPC le donne). Dernier essai raté → une alerte `SWEEP FAILED`, une seule
  (`Payment.sweepAlertedAt`, remis à zéro par un transfert réussi). `deposits.purge-keys` (03:15
  UTC) efface les clés à J+30 (`keyDeletedAt`), transfère d'abord ce qui reste, ne touche jamais
  une facture PAID non transférée (alerte).
- **Rappels** (`createReminderService`) : `subscriptions.remind` chaque minute, 24 h avant la fin
  (6 h pour un pass 2 jours, selon la durée du dernier pass), réservé avant l'envoi par une mise
  à jour conditionnelle (`reminderForExpiresAt` = la fin rappelée ; une prolongation déplace la
  fin et réarme le rappel). Bot bloqué → réservation gardée ; autre échec → réservation rendue,
  essai au passage suivant. Bouton `🔄 Renew` (`sub:open`, `SUB_OPEN` de shared, comme le menu)
  → l'écran des offres remplace le rappel. `subscriptions.expire` chaque minute : `expireDueSubscriptions`, aucun message.
- **Comptes inactifs et nettoyage à 90 jours** (V1-45) : `accounts.delete-inactive` et
  `data.expired-cleanup`, décrits dans « Conservation des données ».

### Payer depuis un wallet du bot (V1-31)

`createWalletPaymentService({ prisma, payments, balances, transfer, vault })`
([wallet-payments.ts](packages/db/src/services/wallet-payments.ts), dans `@launchbot/db` comme le
retrait de V1-14) : `listChoices`, `quote`, `pay`. Handlers `sub:pw:*` dans
[pay.ts](apps/bot/src/features/subscribe/pay.ts), écrans purs dans
[pay-screens.ts](apps/bot/src/features/subscribe/pay-screens.ts).

- **Choix** (`sub:pw:open:<id>`) : les wallets du plus ancien au plus récent, soldes du cache 30 s,
  `✅` ou `⚠️ Insufficient funds (0.1709 SOL missing)` ; une estimation de frais par écran (sur
  l'adresse de dépôt). Le manquant suit les règles de §9.5 (`transferShortfall` de
  `@launchbot/shared`, à côté de `computeMaxAmount`) : montant + frais − solde, et le minimum
  rent-exempt en plus quand le solde restant tomberait dessous (proposition) ; arrondi au
  0.0001 SOL supérieur. Paiement
  partiel : la ligne de V1-30, on n'envoie que le reste. Sans wallet : le texte de §10.1,
  `👛 Wallets` et `⬅️ Back`.
- **Clic sur un wallet** (`sub:pw:w:<paymentId>:<walletId>`, ≤ 60 octets) : soldes relus sans
  cache ; insuffisant → alerte `Test can't cover this payment.` et la liste (rendue avec le
  refus, sans nouvelle lecture) avec la note
  `⚠️ INSUFFICIENT FUNDS` (adresse du wallet en `<code>`) ; sinon la confirmation : source, reste à
  envoyer (en dollars seulement tant que rien n'est arrivé), adresse de dépôt, frais à 6 décimales
  au plus, réseau.
- **Confirm** (`sub:pw:ok:<jeton>`, jeton du dernier écran, dépensé avant l'envoi) : limite
  `RATE_LIMITS.payFromWallet` (5 / 10 min) avec alerte, puis la requête est acquittée et `pay` :
  verrou par facture, dépôt relu (`checkInvoice` : une facture couverte s'active, rien n'est
  envoyé ; expirée, annulée ou payée → l'écran de V1-30), reste comparé à celui de la
  confirmation (`amount_changed` → la confirmation avec `⚠️ Amount updated.`), une lecture du
  wallet (`WALLET_SIGNER_SELECT`), puis `sendTransfer` du reste vers l'adresse de dépôt lue en
  base : V1-13 relit le solde et les frais et refuse ce qui ne passe plus (solde insuffisant →
  la liste avec la note), la clé n'est déchiffrée qu'au moment de signer. L'écran
  `SENDING PAYMENT` sans bouton s'affiche une fois le solde lu (`onPrepared`). Le verrou ne
  couvre que les vérifications et l'envoi.
- **Après l'envoi**, hors verrou : cache des soldes invalidé, `checkInvoice` : activé → « Payment received » ;
  pas encore vu → la facture avec `⏳ Payment sent, waiting for confirmation…`. Échec : si les
  fonds sont arrivés quand même, c'est un paiement ; issue inconnue (`landed: "unknown"`) → la
  facture « Payment sent », jamais d'écran d'échec ni de Try again, et la signature est gardée en
  session (`pay.sent`) : le Confirm suivant la relit d'abord et n'envoie rien tant qu'elle peut
  encore atterrir (2 min, `mayStillLand`, la règle que le retrait applique à ses lignes) ; sinon `❌ PAYMENT FAILED` avec la raison de V1-13,
  `🔁 Try again` (confirmation recalculée) et `⬅️ Back` (`sub:inv:<id>`).
- Session `pay` : ids, reste confirmé (chaîne de lamports), jeton, signature en vol ; jamais un
  solde ni une clé. Logs : ids, montants, signature seulement.

### Écrans de facture (V1-30)

`createInvoiceFlow` ([invoice.ts](apps/bot/src/features/subscribe/invoice.ts)), écrans purs dans
[invoice-screens.ts](apps/bot/src/features/subscribe/invoice-screens.ts). Remplace l'écran
provisoire de V1-29. Aucune session : l'id de la facture voyage dans la callback data (`sub:paid`,
`sub:cancel`, `sub:new`, `sub:inv`, `sub:pw:open`) et la facture est relue à chaque clic.

- **Ouverture** (une offre, Continue, New invoice) : `createInvoice` ; `PRICE_UNAVAILABLE` et
  `RATE_LIMITED` → alerte et les offres avec la ligne, `PLAN_SWITCH_REFUSED` → l'alerte de V1-29.
- **Facture** : `⭐ PREMIUM · 2 DAYS`, `Send exactly 0.5709 SOL ($59.00) to:` (4 décimales
  arrondies vers le haut, le prix figé de la facture), adresse de dépôt en `<code>`,
  `⏳ Waiting for payment · expires in 30:00` au moment du rendu (pas d'édition chaque seconde).
  Après « I've paid » : `last check 14:32 UTC` puis `Expires in 27:40.` ; paiement partiel : la
  ligne `⚠️ Partial payment: … received, … still to send.` sous la ligne d'état.
- **I've paid** : `checkInvoice` au plus une fois par facture toutes les 5 s (mémo en mémoire,
  `RATE_LIMITS.paymentCheck`), un clic plus rapproché reçoit la même réponse sans RPC ; rien →
  toast et last check ; partiel → toast et ligne ; activé (par ce clic ou par le worker) →
  `✅ Payment received. Premium is active until 26 Sep 2026, 12:05 UTC.` ; échue →
  `⌛ Invoice expired.` avec le flag du partiel ou du paiement tardif ; annulée → les offres ;
  inconnue, d'un autre utilisateur ou orpheline → `Invoice not found.` et les offres ; RPC muet →
  la facture avec `⚠️ We couldn't check the payment.` (proposition).
- **Cancel** → les offres, ou « Payment received » si la facture a été payée entre-temps.
  **New invoice** → `chooseOffer` avec la même offre (règles de V1-27 réévaluées).
- `buildPaymentReceivedScreen(ui, { plan, expiresAt })` vit dans `@launchbot/shared`
  (`subscription/payment-received.ts`) pour que le worker (V1-32) envoie le même message ;
  `LAUNCH_COIN` (`lc:open`) est désormais une constante partagée, le menu l'utilise aussi.

### Écran des offres (V1-29)

`createSubscribe({ ui, data, providers, payments, walletPayments })` + `registerSubscribe(router, subscribe)`
([subscribe.ts](apps/bot/src/features/subscribe/subscribe.ts)), écrans purs dans
[screens.ts](apps/bot/src/features/subscribe/screens.ts). Remplace l'écran provisoire `sub` de V1-08.

- **Offres (§8.2)** : `📋 Current plan: None`, `Premium · 1d 4h left` (sous 72 h),
  `Classic · until 12 Oct`, `Classic ⚠️ expired` : `planLabel` (`@launchbot/shared`), le même
  libellé que l'accueil, sur le même `PlanStatus` (`data.getPlanStatus`) ; blocs `🔹 CLASSIC` et
  `💎 PREMIUM · Best value` en arbre, prix entiers (`$49`) ; « Premium adds: » avec `(AI model
coming soon)` tant que `isAiModelAvailable(providers)` est faux et « Up to 10 wallets » lu dans
  `getPlanFeatures`. Flags au-dessus du clavier : `Classic: available when your Premium ends`
  quand `decidePurchase` refuserait Classic, puis ceux des appelants (prix indisponible en V1-30,
  `en.subscribe.launchCoinNeedsPlan` en V1-35). Description proposée (D19).
- **Clic sur une offre** (`sub:buy:<code>`) : l'abonnement est relu en base puis `decidePurchase` :
  Classic pendant Premium → alerte « You can switch to Classic when Premium expires. » et l'écran
  des offres (une édition identique est ignorée) ; Classic → Premium → écran d'avertissement
  `⚠️ Your remaining Classic time will be lost.` avec `➡️ Continue` (`sub:up:<code>`, règles
  relues, pas de second avertissement) et `❌ Cancel` (`sub:open`) ; sinon (nouveau plan,
  prolongation) → la facture (V1-30).
- Aucune session : l'offre voyage dans la callback data (`C2D`, `C1M`, `P2D`, `P1M`, lus par
  `parseOfferCode` ; un code inconnu ramène aux offres).
- Fournit : `showOffersScreen(ctx, { flags?, status? })` (`status` : le plan que le même clic vient
  de lire, Launch Coin), `chooseOffer` (le « New invoice » de
  V1-30), `continueUpgrade`, `invoices` (V1-30).

### Factures (V1-28)

`createPaymentService({ prisma, subscriptions, getSolUsdPrice, readLamports, generateKeypair,
vault })` : `createInvoice`, `getInvoice`, `checkInvoice`, `checkInvoiceWithBalance`,
`checkInvoicesBatch`, `listInvoicesToCheck`, `cancelInvoice`, `expireDueInvoices`. Le service ne
déchiffre jamais la clé de dépôt et ne la lit pas (`omit`) : `InvoiceRow` et `InvoiceView` n'en
ont pas.

- **Création** : règles de V1-27 (`PLAN_SWITCH_REFUSED`), facture PENDING de la même offre rendue
  telle quelle (`reused`), sinon prix V1-07 (`PRICE_UNAVAILABLE` : aucune ligne), taux gardé à
  8 décimales comme la colonne, `computeExpectedLamports` en entiers (arrondi au lamport
  supérieur : $59 à 103.36 → 570 820 434), keypair neuve chiffrée par le coffre, 30 minutes.
  Limite D17 (`RATE_LIMITS.invoice`, 5 par 10 min) comptée en base, sous le verrou advisory par
  utilisateur (`lockUserScope(tx, "invoice", userId)`, le même helper que wallets et IA) qui
  sérialise aussi la réutilisation.
- **Montant affiché** : `formatSol(lamports, { decimals: 4, rounding: "ceil" })`, 4 décimales
  arrondies vers le haut (« 0.5709 SOL »), jamais sous le montant attendu (DEC-06, validé le
  24/09/2026).
- **Vérification** (§8.3) : `decideInvoice`, `effectiveStatus`, `acceptanceDeadline` et `isPaid`
  (purs, `packages/shared/src/subscription/invoice.ts`) sur le solde du dépôt ; paiement complet
  jusqu'à 24 h après l'expiration ou l'annulation → activation par V1-27 dans la même transaction
  que `receivedLamports` (`activatedNow` pour le seul processus qui a activé), au-delà
  `LATE_FULL_PAYMENT` ; partiel → `PARTIAL` puis `PARTIAL_EXPIRED` ; compte purgé →
  `ORPHAN_PAYMENT`, sans transaction. Expiration paresseuse d'une facture PENDING échue.
- **Lecture groupée** : `readLamports` (`getBalancesFresh`, commitment confirmed, sans cache) par
  paquets de `MAX_ACCOUNTS_PER_READ` (100, `chunk` de `@launchbot/shared`) ; un paquet en erreur
  n'emporte que ses factures. Pour V1-32 : `listInvoicesToCheck` borne aussi les factures
  annulées par `expiresAt`, ce qui garde l'index `(status, expiresAt)` utile.

### Domaine abonnement (V1-27)

- `packages/shared/src/subscription/` : catalogue (`listOffers`, `getOffer`, `parseOfferCode`),
  `decidePurchase(current, plan)` → `NEW` / `EXTEND` / `UPGRADE` / `REFUSED`,
  `computeActivation` (mode PAYMENT ou GRANT), `getPlanFeatures` (3 / 5 / 10 wallets, AI et
  support prioritaire en Premium, Launch Coin avec un plan), `PlanStatus` + `planLabel`.
- `createSubscriptionService({ prisma })` : `activateFromPayment(paymentId, now, tx?)`, **seul
  code qui passe une facture en PAID** — verrou de la facture puis de l'utilisateur, réclamation
  conditionnelle, lignes échues expirées, règle réévaluée à l'instant ; `ALREADY_ACTIVATED`
  n'écrit ni ne relit rien ; `grantSubscription` et `previewGrant` (V1-42) ;
  `expireDueSubscriptions` (V1-34). Lectures : `getPlanStatus` (une requête : la ligne qui finit
  en dernier), `hasActiveSubscription` et `hasActivePremium` (tous deux par `getPlanFeatures`).
- Une ligne par période continue d'une offre : une prolongation déplace `expiresAt` et met
  `duration` au dernier pass (préavis de V1-34). Classic → Premium : le Classic finit à l'instant
  (EXPIRED). Classic payé pendant un Premium : le Premium est prolongé (`EXTEND_PREMIUM`, validé le
  24/09/2026). Index unique partiel `Subscription_userId_key` : au plus une ligne ACTIVE par
  utilisateur. Le client Prisma accepte `userId` comme clé unique (`findUnique`, `update`,
  `upsert`, `delete`) mais ignore la condition : ne jamais s'en servir.

## Launch Coin

### Parcours Wallet → Bundle → Token → Récap (V1-35 à V1-37)

`registerLaunch(router, inputs, deps)` ([launch.ts](apps/bot/src/features/launch/launch.ts)),
écrans purs dans [screens.ts](apps/bot/src/features/launch/screens.ts), calculs en lamports dans
`@launchbot/shared` ([launch/funds.ts](packages/shared/src/launch/funds.ts) :
`launchShortfallLamports`, `bundleStatuses`, `customMaxLamports`, `parseLaunchBundleInput`). Rien
n'est créé en V1 : « 🚀 Create token » (`lc:create`) répond par une alerte (D6) ;
`TOKEN_CREATION_ENABLED = false` affiche la ligne « Token creation arrives in V2. » du récap.
V2-04 passera la constante à `true` et remplacera le handler de `lc:create` par la création.

**Décision du 25/09/2026** : le dev achète toujours **1 SOL** (`DEV_BUY_SOL`), puis le **bundle**
choisi à l'étape 2 (3 / 5 / 10 SOL, Custom de 3 à 20 SOL) achète au bloc suivant ; les deux
partent du même wallet, et les textes le disent. Le minimum d'un launch est **4 SOL pile**
(1 + 3), sans marge de frais ; le récap garde la ligne indicative « ⛽ Fees: ≈ 0.05 SOL ».

- **Entrée** (`lc:open` : bouton du menu et de « Payment received ») : canal revérifié **sans
  cache** (`ensureChannelMembership`, `resume: "launch"` : « I've joined » vérifié reprend le
  parcours sans second `getChatMember`), puis **abonnement actif** (`getPlanStatus`), sinon les
  offres avec « ⭐ Launch Coin needs an active subscription. ». Chaque clic `lc:` suivant revérifie
  l'abonnement (il peut finir en plein parcours), comme le Continue de l'étape Token.
- **Session** `launch = { walletId?, bundleLamports?, blockedLamports? }` (lamports en chaîne) :
  wallet et bundle remis à zéro à chaque entrée (§9), le brouillon du token reste dans
  `tokenStep.LAUNCH`. Saisie Custom : `pendingInput = { kind: "launch_amount" }`.
- **Étape 1** (`lc:w:<walletId>`) : tous les wallets, du plus ancien au plus récent, ✅ dès
  4 SOL (`WALLET_READY_MIN_LAMPORTS` = dev buy + plus petit bundle, la règle de l'accueil, D13),
  sinon le manque arrondi au millième supérieur. Clic sur un wallet : solde relu sans cache si la
  limite du Refresh le permet ; insuffisant → note avec l'adresse en `<code>`, rien n'est gardé ;
  wallet disparu ou d'un autre → « This wallet no longer exists. ». Changer de wallet efface le
  bundle.
- **Étape 2 Bundle** (`lc:b:3|5|10|c|cx|r`, Back `lc:s1`) : le dev buy de 1 SOL, puis une ligne
  par bundle, toujours (couvert, ou manque de 1 SOL + bundle), et Custom jusqu'à min(20 SOL,
  solde − 1 SOL) arrondi au millième inférieur. Un bundle non couvert n'est pas gardé : note
  « INSUFFICIENT FUNDS » + Refresh (lecture forcée, 1 par 10 s, ligne « Updated »), retirés dès
  que le solde couvre. Custom : parser de la simulation (3 à 20 SOL), puis le solde du wallet.
- **Étape 3** : l'écran Token de V1-16 en mode LAUNCH (brouillon propre au parcours), avec les
  lignes Wallet, Dev buy et Bundle au-dessus du bloc (passées à `showTokenStep` par le clic qui
  vient de lire le solde, relues par `summaryLines` pour les clics du step) ; Back → étape 2
  (`lc:s2`).
- **Étape 4** (Back `lc:s3`, Menu) : bloc TOKEN du récap de simulation, wallet (avec son manque si
  le solde a baissé depuis), dev buy, bundle et total avec leur part de la supply calculée sur la
  curve du moment (`renderBuyLines` de la simulation, `getCurveParams`, 1 décimale), frais
  « ≈ 0.05 SOL », lien vers le canal Succès, et « 🚧 Token creation arrives in V2. ». Wallet,
  bundle et nom + ticker sont revérifiés avant l'affichage ; ce qui manque renvoie à son étape.

## Support et administration

### Écran Support et code support (V1-40)

« 🆘 Support » du menu (`sup:open`) ouvre l'écran du §11.1 en édition : comment joindre le support
humain, le **code support** seul en `<code>` (un tap le copie) et la ligne de priorité Premium.
`registerSupport` ([support.ts](apps/bot/src/features/support/support.ts)), écran pur dans
[screens.ts](apps/bot/src/features/support/screens.ts), fonctions pures dans
[support-code.ts](packages/shared/src/support/support-code.ts). Il remplace le dernier écran
provisoire : `coming-soon.ts` et `en.comingSoon` sont supprimés (`router.registerProvisional` reste
pour les sections de la V2).

- **Code** : lettre de l'offre active puis ID Telegram, `P-123456789` (`buildSupportCode`). Offre lue
  à chaque affichage, sans cache, par `getPlanStatus` (la lecture de l'accueil, même prédicat
  ACTIVE + `expiresAt > now` que `getActiveSubscription`) : un Premium échu que le worker n'a pas
  encore expiré donne `F`. Priorité : `getPlanFeatures(plan).prioritySupport`.
- **💬 Contact support** : bouton `url` vers `SUPPORT_URL`. Pour un lien `t.me/<username>`, le code
  pré-remplit le premier message (`?text=`, `?start=` si le nom finit par `bot`, `encodeURIComponent`) ;
  une invitation, un autre chemin ou un autre site restent tels quels (`buildSupportUrl`).
  `SUPPORT_PREFILL_ENABLED = true` : paramètre documenté par Telegram, **à vérifier** sur iOS,
  Android, Desktop et Web (test manuel de V1-40) ; le code affiché suffit dans tous les cas.
- **Parsing des commandes admin** : `parseUserRef(raw)` → `{ telegramId: bigint, claimedPlanLetter }`
  (ID seul ou `P-`/`C-`/`F-` + ID, casse ignorée, 16 chiffres au plus, sans zéro initial ni signe ;
  `parseTelegramId` pour l'ID seul). Le schéma zod `userArg` (bot,
  [common.ts](apps/bot/src/features/admin/common.ts)) le lit une fois : un argument invalide donne le
  rappel de syntaxe ; `resolveUserRef(ref)` lit ensuite le compte, `null` → « User not found ». La
  lettre n'est que déclarée : les commandes relisent l'offre.

### Garde admin et erreurs communes (V1-38, §1 et §2)

Livrées avec le lot admin ; `/announce` (§3 à §5 de la carte) viendra avec les canaux.

- `createAdminGuard(env.ADMIN_TELEGRAM_IDS)` ([guard.ts](apps/bot/src/features/admin/guard.ts)) :
  `isAdmin(id)`, le `Composer` des commandes (`guard.commands.command(...)`) et un middleware placé
  **après** la gate et la saisie attendue, juste avant le routeur. Une commande du registre ou un
  clic `adm:*` d'un non-admin : **silence**, comme une commande inconnue (le clic reçoit une réponse
  vide d'`ensureAnswered`), log `admin.denied` avec l'ID et le nom de la commande, jamais ses
  arguments. Revérifié à chaque clic. Liste vide → aucun admin. La garde reconnaît une commande avec
  les matchers de grammY (`Context.has.command`, ceux de `commands.command()`) et un clic avec
  `decodeCallback`, comme le routeur : elle filtre exactement ce qui s'exécuterait.
- **Registre** `en.admin.commands` : titre, ligne du menu, usage, exemple. Au démarrage,
  `setAdminCommands` pose `/start` et ces commandes dans le menu de chaque admin
  (`BotCommandScopeChat`), jamais dans la liste par défaut ; un admin qui n'a jamais ouvert le bot →
  warn (proposition).
- Erreurs : `parseArgs(ctx, name, schema)` lit les mots après la commande (tuple zod : un mot en trop
  ou en moins est une erreur) et envoie sinon le rappel « ❌ Invalid command. / Usage: / Example: »
  (usage échappé, il contient `<` et `>`) ; `renderAdminUserNotFound` : « ❌ User not found. » puis
  « Searched: … ». Chaque réponse à une commande est un nouveau message (`showScreen` en `new`),
  qui quitte une saisie en cours.
- **Kit commun** (`createAdminKit`, [common.ts](apps/bot/src/features/admin/common.ts)) : `parseArgs`,
  `resolveUserRef(ref)`, `replyNotFound`, `reply`, `replyParts` (fiche en plusieurs messages), plus
  `adminHeader` (titre du registre), `offerLabel` (« Premium · 1 month ») et `tellUser` (message à
  l'utilisateur visé par /grant ou /purge, `false` si Telegram refuse). Les logs d'échec Telegram
  passent par `telegramErrorFields` ([telegram-errors.ts](apps/bot/src/navigation/telegram-errors.ts)) :
  code et description, jamais `payload`.

### /grant (V1-42)

`/grant <id ou code> <classic|premium> <2d|1m>` ([grant.ts](apps/bot/src/features/admin/grant.ts),
écrans et syntaxe dans [grant-screens.ts](apps/bot/src/features/admin/grant-screens.ts)).

- Confirmation : question du §11.4, « Current plan » de l'écran des offres, fin calculée par V1-27
  (`previewGrant`, qui lit désormais l'offre une fois et rend `{ status, computed }`) ; variantes
  EXTEND (flag ℹ️), UPGRADE (perte du Classic), REFUSED (Classic pendant un Premium : Cancel seul).
- Session `adminGrant` (`nonce`, `targetUserId`, `targetTelegramId`, `offerCode`, `kind`,
  `currentExpiresAt`, `createdAt`), remplacée à chaque `/grant` ; boutons `adm:grant:ok|no:<nonce>`
  (8 caractères base64url, `newNonce`).
- **Confirm** : nonce déjà utilisé en base → « This grant is no longer valid. » ; nonce absent, autre
  ou de plus de 10 min (`ADMIN_CONFIRM_TTL_MS`) → alerte + message « ⌛ … expired », clavier retiré.
  Puis `confirmGrant` en **une transaction sous le verrou du User** : ligne `SubscriptionGrant`
  (nonce unique, table de la migration `subscription_grant`) et activation ensemble, seulement si
  l'offre est encore celle de l'écran (même kind, même fin pour EXTEND) ; sinon `CHANGED` → alerte
  « The user's plan changed. » et écran à jour avec un nouveau nonce. Deux clics simultanés : le
  second attend le verrou puis trouve la ligne (`USED`).
- Résultat sans clavier, date issue de la ligne. L'utilisateur est prévenu (« ⭐ Premium is active
  until … », Launch Coin et Menu ; `GRANT_NOTIFY_USER`, proposition), sinon « ℹ️ The user could not
  be notified. ». Log `admin.grant` sans texte de message.

### /whois et /getall (V1-43)

`createUserData` ([user-data.ts](apps/bot/src/features/admin/user-data.ts)), rendus purs dans
[user-data-screens.ts](apps/bot/src/features/admin/user-data-screens.ts), lectures dans
`createSupportDataService` ([support-data.ts](packages/db/src/services/support-data.ts)) : `select`
explicites, aucune colonne de clé, sauf `walletSecrets`, réservé à Reveal keys.

- **/whois** : nom, ID, offre (date complète, temps restant sous 72 h, « ended … » si expirée), code
  support actuel, nombre de wallets (sans RPC), 5 derniers paiements (montant tel que la facture
  l'affichait, 4 décimales arrondies au-dessus ; reçu partiel ; « refund manually » pour une facture
  terminée avec des SOL reçus). Code saisi dont la lettre ne correspond plus → flag avec le code actuel.
- **/getall** : fiche sans secret (compte, abonnement et historique Payment/Grant, AI Generate du
  jour, 20 derniers achats, wallets avec adresse complète et solde de `getUserBalances`, 10 derniers
  retraits et transferts d'inactivité, compteurs), découpée par `splitHtmlMessage`
  ([split.ts](packages/shared/src/ui/split.ts) : coupe entre blocs puis entre lignes, jamais dans
  une balise, `Part 2/3`). `[🔑 Reveal keys][❌ Cancel]` sur la dernière partie s'il y a des wallets ;
  session `getallReveal = { nonce (16), targetUserId, targetTelegramId, createdAt }`. Compte
  inexistant : ses transferts `INACTIVITY_SWEEP` retrouvés par l'ID Telegram (V1-45).
- **Reveal keys** ([reveal.ts](apps/bot/src/features/admin/reveal.ts), **seul** fichier autorisé à
  importer `revealWalletSecrets`, règle ESLint resserrée) : demande lue et retirée de la session
  (usage unique), 5 min max ; clavier de la fiche retiré ; clé base58 et seed de chaque wallet en
  `<code>` (« none (imported with a private key) », « unavailable », ou « Keys unavailable
  (decryption failed) »), `protect_content` désactivé (`GETALL_PROTECT_CONTENT`), un bloc par wallet
  jamais coupé. Chaque partie est enregistrée **aussitôt** dans `SensitiveMessage` (migration
  `sensitive_message`) pour sa suppression à 60 s ; si l'enregistrement échoue, le message est
  supprimé tout de suite. Log `admin.getall.reveal` (admin, compte, nombre de wallets), seule trace.
- **Balayeur** ([sensitive-sweeper.ts](apps/bot/src/services/sensitive-sweeper.ts)) : service du
  process du bot, au démarrage puis toutes les 5 s (`runEvery`, déplacé du worker dans
  `@launchbot/shared/server`), 50 lignes échues max. Supprimé ou déjà absent → ligne supprimée ;
  impossible (plus de 48 h, 403, autre 400) → ligne supprimée, log error et réponse au message
  « ⚠️ Couldn't delete this message with wallet keys. Delete it yourself now. » ; réseau ou 5xx →
  `attempts + 1`, nouvel essai ; 429 → passage suivant.

### /purge (V1-44)

`createPurge` ([purge.ts](apps/bot/src/features/admin/purge.ts)), écrans dans
[purge-screens.ts](apps/bot/src/features/admin/purge-screens.ts), services
`createAccountDeletionService` ([account-deletion.ts](packages/db/src/services/account-deletion.ts))
et `createAccountSweeper` ([account-sweep.ts](packages/db/src/services/account-sweep.ts)), partagés
avec le worker.

**Décision du 25/09/2026** : des SOL sur un wallet ne bloquent plus la purge. Ils partent vers
`TREASURY_WALLET` avant la suppression, comme pour un compte inactif (V1-45), chaque transfert tracé
en `Withdrawal` de type `PURGE_SWEEP` avec `userTelegramId` (migration `purge_sweep`), pour un
remboursement à la main.

- Résumé : compte, wallets avec leur solde lu **sans cache**, factures encore payables, la ligne
  « ℹ️ 2.500 SOL will be moved to the treasury before the deletion. » (wallets au-dessus des frais
  d'un transfert, seuil de V1-11 ; la poussière reste et se perd avec la clé), puis les blocages :
  `PENDING_INVOICE` (PENDING, ou terminée dans ses 24 h, proposition) et `BALANCES_UNAVAILABLE`
  (RPC en erreur : impossible de dire ce qui part). Abonnement actif : non bloquant, « will be
  lost ». Bloqué → Cancel seul ; sinon `[🗑 Confirm purge][❌ Cancel]` (`adm:prg:ok:<telegramId>`,
  rien en session).
- **Confirm purge** : tout est relu ; blocage apparu → alerte + résumé à jour, rien n'est bougé ni
  supprimé. Sinon le clic est répondu tout de suite (les transferts prennent quelques secondes
  chacun, le bot traite les updates une à une pendant ce temps), l'écran dit « ⏳ Moving the SOL to
  the treasury… », puis `sweepAccount(user, { kind: "PURGE_SWEEP" })`. Un transfert en échec, resté
  en vol ou des SOL arrivés entre-temps → « ❌ The SOL could not all be moved to the treasury.
  Nothing was deleted. », les transferts déjà faits listés, toutes les clés gardées : un nouveau
  /purge ne bouge que ce qui reste. Sinon « Your data has been deleted. » à l'utilisateur (bot
  bloqué → on continue, ligne ℹ️), puis
  `deleteUserData` : une transaction, verrou du User (`lockUserRow`, le même que les activations et
  /grant), `Simulation`, `TokenDraft`, `AiGeneration` et `Subscription` supprimés, `Withdrawal` et
  `Payment` détachés (`userId` null, `userTelegramId` gardé), `Wallet` supprimés (clés chiffrées et
  seeds avec eux), sessions du chat (`sessionKeysOf`), puis le `User`. Compteurs et transferts
  vers la trésorerie (liens explorer) à l'écran, log `purge.done`, cache des soldes invalidé.
  `onlyIfLastActiveBefore` → `SKIPPED_ACTIVE` pour V1-45.
- `/getall <ID>` d'un compte supprimé liste ses transferts vers la trésorerie sous « Account
  deleted. Transfers to treasury: », chacun marqué « Inactivity sweep » ou « Purge sweep ».

## Conservation des données

### Comptes inactifs et nettoyage à 90 jours (V1-45)

Deux crons du worker ([jobs/retention.ts](apps/worker/src/jobs/retention.ts)), services dans
[inactive-accounts.ts](packages/db/src/services/inactive-accounts.ts) et
[data-cleanup.ts](packages/db/src/services/data-cleanup.ts). Les transferts vers la trésorerie
passent par [account-sweep.ts](packages/db/src/services/account-sweep.ts), que /purge (V1-44)
utilise aussi.

- **`accounts.delete-inactive`**, toutes les 15 min (`cronEvery(INACTIVITY_CHECK_INTERVAL_MS)`, qui
  refuse le démarrage si l'intervalle ne divise pas l'heure) : d'abord les transferts vers la
  trésorerie restés PENDING, `INACTIVITY_SWEEP` comme `PURGE_SWEEP` (un /purge arrêté sur un
  transfert en vol), relus sur la chaîne (`resolvePendingSweeps`, `settleTransfer`) ; puis les
  comptes sans activité depuis **24 h** (`INACTIVITY_DELETE_MS` dans `constants.ts`, 48 h dans la
  décision du 16/09/2026 ; `inactivityCutoff`, fixé au début du passage), admins exclus (en SQL et
  revérifié par `isInactiveCandidate`), par pages de 100 sur un curseur `(lastActiveAt, id)`, un
  try/catch par compte. Pour chaque compte : `lastActiveAt` relu ; une ligne PENDING partie d'un de
  ses wallets (même adresse) est relue d'abord (compte gardé si elle peut encore passer) ; soldes
  lus sans cache ; chaque wallet au-dessus des frais d'un transfert part **en entier** vers
  `TREASURY_WALLET` (`sendRecorded`, ligne `Withdrawal` `INACTIVITY_SWEEP` avec `userTelegramId`,
  `lastActiveAt` relu avant chaque transfert) ; la poussière reste et se perd avec la clé. Un échec
  (lecture, devis, transfert, issue inconnue) garde le compte pour le passage suivant : aucune clé
  n'est effacée tant qu'il reste des fonds transférables. Soldes relus si un transfert est parti
  (sinon la lecture du début sert), puis `deleteUserData(userId, { onlyIfLastActiveBefore })`.
  Aucun message à l'utilisateur ; s'il est revenu après le départ de ses SOL, alerte
  `⚠️ MANUAL REFUND` aux admins (une fois).
- **Facture encore payable** : une facture reste payable 30 min + 24 h après sa création (§8.3),
  plus longtemps que le délai d'inactivité. Le compte peut donc partir avant : un paiement arrivé
  ensuite n'active rien (`ORPHAN_PAYMENT`, facture détachée), `deposits.watch` transfère le dépôt à
  la trésorerie et les admins reçoivent l'alerte de remboursement manuel (« deleted account »,
  expéditeur du dépôt). Rien de spécifique dans le job : c'était impossible en pratique à 48 h.
- **`data.expired-cleanup`**, 03:30 UTC : simulations de plus de 90 jours, brouillons non modifiés
  depuis 90 jours et référencés par aucune simulation (le `tokenDraftId` est en cascade), lignes
  `AiGeneration` de plus de 90 jours (proposition), par lots de 1 000.
- **Lancement à la main** (recette R9) :
  `pnpm --filter @launchbot/worker job accounts.delete-inactive [--now 2026-12-24T03:30:00Z]` met le
  job dans la file de son cron ; le worker en marche le prend dans la minute, un passage déjà en
  attente ou en cours l'absorbe. `--now` fixe l'horloge de ce passage, refusé si
  `NODE_ENV=production`. Le worker doit avoir démarré une fois (il crée les files).

### Rétention des logs

Les logs pino partent sur stdout, sans secret (redaction, `scrub`, jamais de texte de message). Leur
conservation relève de l'hébergement : **6 mois** (collecteur réglé à 180 jours, ou logrotate avec
`maxage 180`), la durée proposée au §11.3 du contexte.

## Mini App

La Mini App (`apps/webapp`, V1-05) ne sert plus aucune page : elle répond « Page not found. » à
toute route. Ses pages Terms et Privacy ont été retirées le 25/09/2026 (V1-41, §11.2 du contexte),
avec l'écran « I accept » du premier accès, les boutons du menu, `TERMS_VERSION` et les colonnes
`termsVersion` / `termsAcceptedAt` (migration `20260925200000_drop_terms`). Le squelette reste pour
une page à venir : thème Telegram, client `apiFetch`, bouton `webAppBtn` de `@launchbot/shared`, et
l'API avec son `/api` protégé.

L'écran de simulation (tickets V1-24 à V1-26 d'origine : contrôleur et horloge simulée, Lightweight
Charts, stats, top holders, position, ventes et PNL card) a été construit, testé une fois sur
téléphone le 24/09/2026 et abandonné le jour même, sans être commité : la simulation se joue dans le
chat (§6 du contexte, tickets V1-24 à V1-26 réécrits, décision ci-dessous). Ce qui en reste dans le dépôt, parce
que le rendu dans le chat en a besoin : les formateurs `formatPctSupply`, `solToLamports` et
l'option `signed` de `formatSol` (`@launchbot/shared`), la borne `SIM_SEED_MAX` partagée avec
`drawSeed` du bot, et l'entrée `@launchbot/sim-engine/test-helpers` (`simConfig`).

## Simulation dans le chat

### Runner, message photo édité, ventes, contrôles, PNL card et Run again (V1-26)

`▶️ Start simulation` envoie un **message photo protégé** (`protect_content`, ni transfert ni
enregistrement) et l'édite toutes les 3 s jusqu'à la fin ; la PNL card remplace alors l'image du
même message. Tout vit en mémoire dans le process du bot (§6.4) : rien n'est persisté, un
redémarrage fige les messages en cours et leurs boutons répondent « This simulation is over ».

- **Runner** (`createSimRunner`, [apps/bot/src/services/sim-runner.ts](apps/bot/src/services/sim-runner.ts)) :
  une entrée par simulation active (`SimulationRun` du moteur, agrégateur de bougies de V1-20,
  horloge, vitesse, logo miniature), avancée par un minuteur toutes les `SIM_FRAME_MS` (3 s).
  L'horloge simulée est un **compteur entier de millisecondes** (temps réel écoulé × vitesse,
  borné à la durée) et chaque tick fait un seul `run.advanceTo(simMs / 1000)` : le
  moteur applique les trades tirés d'avance jusqu'à cet instant, quelle que soit la cadence, et
  `run.time()` est exact (`12.0`, jamais `11.9999`). Volume, achats et ventes se lisent sur les
  bougies de l'agrégateur ; `endReason` décide la fin, puis l'image est rendue (sim-render, V1-25)
  et éditée (`editMessageMedia`). À la fin, le dernier état est dessiné (la bougie de la vente de
  clôture), reste `SIM_END_HOLD_MS` (2 s), puis la carte remplace l'image en **animation**
  (`editAnimation`, un MP4 muet). `start` **réserve la place immédiatement** (une simulation
  active par utilisateur → `already_running`, `SIM_MAX_ACTIVE` (20) au total → `full`) et rend
  `{ kind: "ok", ready }`, `ready` étant la lecture du logo, sa miniature et le premier envoi :
  un second clic pendant l'upload est refusé sans course. Toute écriture d'un message passe par
  une **chaîne par entrée** : le premier envoi, un tick, une vente et la carte ne se chevauchent
  jamais, et deux éditions restent espacées de `SIM_MIN_EDIT_GAP_MS` (1 s) ; une vente, une pause
  ou un changement de vitesse demandent une édition immédiate, différée si la dernière a moins
  d'une seconde, jamais perdue. Pause qui expire après `SIM_PAUSE_TIMEOUT_MS` (10 min) en fin
  `timeout`. Telegram : message supprimé (`gone`) → simulation retirée sans bruit, toute autre
  erreur → log `error` avec le seul `simId` et simulation retirée. `stop()` du service annule les
  minuteurs avant l'arrêt du bot. Dépendances injectables (`scheduler`, `render`, `telegram`,
  `maxActive`) : les tests pilotent une horloge virtuelle (`fakeScheduler` du harnais) et un faux
  rendu de quelques octets.
- **Telegram** ([features/simulation/telegram.ts](apps/bot/src/features/simulation/telegram.ts)) :
  `sendPhoto` avec `InputFile`, légende HTML, clavier et `protect_content: true` ; `editMessageMedia`
  en `{ type: "photo" }` avec la légende dans le média, `{ type: "animation" }` pour la carte ;
  `isNotModified` de V1-04 vaut `edited`, `isUneditable` vaut `gone`.
- **Légende et boutons** ([caption.ts](apps/bot/src/features/simulation/caption.ts), purs) : l'en-tête
  `📊 SIMULATION · 🧪 Devnet`, la mention DEMO (`en.sim.demoBanner`),
  `🪙 Moon Otter · $OTTR`, `⏱ 1:32 / 3:00 · Speed x2` (ou `⏸ Paused`), `📈 Market cap: $5,176.27
(50.08 SOL)` (SOL seul sans prix), `Bonding curve: 34.2% ▰▰▰▱▱▱▱▱▱▱`, `Volume · Buys / Sells`
  (dev inclus, proposition), puis la position par `buildPositionView` (V1-25) et `Sold so far` après
  une vente. Clavier `[ Sell 25% ][ Sell 50% ][ Sell 100% ]` / `[ ⏸ Pause ][ x1 ][ ✅ x2 ][ x5 ]`
  (`▶️ Resume` en pause, la vitesse courante cochée), carte : `[ 🔁 Run again ][ 🏠 Menu ]`.
  Callback data `SIM_CB.go|sell|pause|resume|speed|again(simId, …)` de `screens.ts` (une seule
  table pour le domaine `sim`, ≤ 64 octets avec un cuid) ; Menu = `nav:home` : `showScreen`
  n'édite que le message texte qui porte le bouton, sous une photo il envoie l'accueil dans un
  nouveau message, sans appel raté.
- **Handlers** ([live.ts](apps/bot/src/features/simulation/live.ts), enregistrés dans le domaine
  `sim` de V1-22) : `go` lit la ligne (`SimulationStore.findOwnedWithDraft(userId, simId)`, la
  propriété fait partie de la requête comme pour les brouillons ; `hasNameAndTicker` sinon « stale »)
  puis `launch`, commun à `go` et `again` : `runner.start` réserve ou refuse (`already_running` /
  `full` → alerte + flag sur le récap pour `go`, alerte pour `again`), le clic est acquitté, puis
  `ready` lit le logo (`createTokenImageService`, `contentType` PNG / JPEG, WEBP ou échec →
  pastille) et envoie la première image ; `go` retire ensuite le clavier du récap (`dropKeyboard`
  de la navigation). `sell` → alerte `Sold 25%: 24.17M OTTR for 0.912 SOL.` (le ticker vient du
  runner, aucune lecture en base), `One sale at a time.` sous la seconde, `Nothing left to sell.`,
  « over » pour une simulation inconnue. `pause` / `resume` / `speed` silencieux. `again` (D21
  remplace D12) : `SimulationService.restart` crée une **nouvelle ligne** (même brouillon, dev buy
  et config, seed `drawSeed` ≠ ancienne, `RATE_LIMITS.simulation` comptée) puis repart **sur le
  même message** ; un message supprimé entre-temps reçoit un nouvel envoi.
- **Shared** : `SIM_DEFAULT_SPEED` (x2), `SIM_FRAME_MS`, `SIM_MIN_EDIT_GAP_MS`, `SIM_MAX_ACTIVE`,
  `SIM_PAUSE_TIMEOUT_MS`, emojis `pause`, `runAgain`, `marketCap`, `position`, textes
  `en.sim.live.*` et `en.sim.card.*`, `progressBar(done, total)` partagé avec l'en-tête de flux.
  `@launchbot/sim-engine` : `SimulationRun.advanceTo(tSec)`. `@launchbot/db` :
  `findOwnedWithDraft`. `createBot` rend `{ bot, simRunner }` et prend `images` comme les autres
  services (le harnais passe `fakeImages`). Aucune migration, aucune variable d'env.
- **Tests** (bot : 380) : `services/sim-runner.test.ts` (horloge virtuelle : première image et
  boutons, **même carte finale que `step(180)` en x1 et x5**, vente dans la seconde et second tap
  refusé, Sell 100 % → carte et boutons de fin, pause sans pas ni image et pause oubliée, vitesse,
  cap et doublon d'utilisateur refusé pendant l'upload, message disparu, Run again sur un message
  donné, `stop()`, erreur d'édition absorbée, premier envoi en échec remonté), `caption.test.ts`
  (maquette §6.1 exacte, Paused, sans USD, échappement et limite de 1 024), `live.test.ts`
  (harnais complet : photo protégée, logo lu une fois et récap désarmé, stale, flag « already
  running », runner plein sans lire de logo, pastille sur logo illisible, vente et double tap,
  Sell 100 % puis Menu dans un nouveau message et
  Run again avec une seed différente sur le même message, pause / vitesse / reprise, limite de
  fréquence du Run again). Manuel (téléphone, bot relancé) : voir la recette R5 de V1-46.

## Images de la simulation

### Graphique en PNG et PNL card animée (V1-25)

`packages/sim-render` produit les deux images du message de simulation (§6.1, §6.3) : un SVG
construit en TypeScript, testable comme du texte, rasterisé en PNG par `@resvg/resvg-js` (2.6.2,
figé) avec la police **Inter** embarquée dans `fonts/` (SIL OFL 1.1, licence à côté,
`loadSystemFonts: false`) : la même entrée donne les mêmes octets sur toutes les machines. Node
seulement : le bot rend, Telegram affiche. Aucun Telegram ici, V1-26 branche les images sur le
message. Mesure : ≈ 52 ms par image de 36 bougies sur le portable de dev, 40 à 100 kB de PNG.

- **Graphique** (`buildChartSvg(frame)`, [packages/sim-render/src/chart.ts](packages/sim-render/src/chart.ts)) :
  canevas 1280 × 720, thème sombre fixe (proposition : l'image ne connaît pas le thème
  Telegram), pas de bandeau DEMO (retiré le 24/09/2026 : la légende porte la mention), avatar (logo PNG / JPEG embarqué en `data:` et rogné en
  cercle, ou pastille colorée par le ticker avec sa première lettre), `Moon Otter · $OTTR`, chrono
  `1:32 / 3:00`, libellé `Market cap (USD)` ou `(SOL)` (`chartUnit`), bougies vertes / rouges
  sur un **axe du temps fixé sur toute la durée** (36 emplacements pour 180 s, graduation toutes
  les 30 s : le graphique se remplit de gauche à droite sans changer d'échelle, proposition), axe
  des valeurs en market cap (`axisScale` = supply × prix SOL ou × 1, 5 graduations, `$5,176` /
  `$52.10` / `52.1 SOL` par `formatAxisValue`), histogramme de volume en bas, même couleur à 40 %.
  `ChartFrame` = `{ token, clock, candles, config, logo }` : le runner passe les bougies de
  `createCandleAggregator` (V1-20) et la config, dont le graphique tire l'unité et l'échelle.
- **PNL card** (`buildPnlCardSvg(card, logo)`, [card.ts](packages/sim-render/src/card.ts), la
  maquette du 24/09/2026) : un **overlay transparent** de 1280 × 944 pour le clip
  [assets/pnl-card.mp4](packages/sim-render/assets/pnl-card.mp4) (5,8 s, 30 fps, muet, tiré de
  l'enregistrement fourni par Tristan) : voile sombre dégradé à gauche pour la lisibilité sur
  l'encre noir et blanc, pas de bandeau DEMO (la légende porte la mention), ticker `$OTTR` en
  72 px, pastille verte (rouge en perte)
  avec le glyphe Solana (`solanaGlyph`, le tracé officiel) et `+1.283` en 76 px, logo du token en
  haut à droite (ou pastille), lignes `PNL +42.7%` / `Invested ≡ 3.000` / `Position ≡ 4.283`,
  `SIMULATION · Not a real result` en bas. Le filigrane en bandes de la carte fixe est parti avec
  elle. [video.ts](packages/sim-render/src/video.ts) : `renderPnlCardVideo(card, logo)` rend
  l'overlay en PNG puis lance `ffmpeg` (**`ffmpeg-static` 5.2.0**, binaire téléchargé à
  l'installation, chargé en CommonJS comme le SDK pump) : fondu de l'overlay à 0,5 s, H.264
  `veryfast` CRF 23, `yuv420p`, `faststart`, sans son → ≈ 1,5 MB en ≈ 1,7 s, une fois par
  simulation, dans un dossier temporaire supprimé quoi qu'il arrive. `preview:card` rend deux
  images (gain, perte) et la vidéo dans `out/`.
- **Modèles purs** ([model.ts](packages/sim-render/src/model.ts), repris de l'ancienne Mini App) :
  `buildPositionView(position, config, ticker)` (`96.66M OTTR (9.67%)`, `≈ 3.412 SOL ($352.66)`,
  `+0.412 SOL (+13.7%)`, `1.234 SOL` vendus ou null, ton) pour la légende de V1-26 ;
  `buildPnlCardModel({ position, config, token, endTimeSec, initialDevTokens })` : Dev buy et
  Sold for **arrondis à 2 décimales d'abord**, PnL = leur différence (la carte s'additionne),
  `Sold for` = `solOut + valueIfSoldNow`, `Position` = `Closed` / `62% held` (part de la position
  de départ) / `<1% held`, USD par le prix figé ou omis, `-0.540 SOL · -$55.81` en perte ; pour
  la carte : `tickerText` `$OTTR`, `pnlSolBig` `+1.283`, `investedText` `3.000`,
  `positionSolText` `4.283`, en **millièmes de SOL** (Invested + PnL = Position à l'écran) ;
  `formatSignedSol`, `formatSignedPct` (signe après arrondi, jamais sur un zéro).
- **Rasterisation** ([png.ts](packages/sim-render/src/png.ts)) : `renderPng(svg)` par
  `renderAsync` de resvg (le tramage sur son propre thread ; l'encodage PNG `asPng`, ≈ 15 ms,
  reste synchrone), `renderChartPng(frame)` → `Uint8Array`, et `renderLogo(image)` : le logo Telegram (jusqu'à 5 MB) réduit **une fois par run** en PNG de
  96 px embarqué en `data:` (`Logo = { href }`), au lieu d'être ré-encodé et redécodé à chaque
  image. Un SVG malformé rejette, jamais une image vide. `@launchbot/sim-render/test-helpers` :
  `chartFrame`, `pnlCard`, `candle`.
- **Textes** : `en.sim.image.*` (`packages/shared`, D19 : PNL, Invested, Position, Not a real
  result, SIMULATION, `Market cap (unit)`) et `en.sim.card.*` pour la légende sous l'animation
  (style Axiom, demande du 24/09/2026 : `🪙 <b>$OTTR</b> | +42.7%`, `📈 Invested: 3.000 SOL ($310)`,
  `📉 Sell: 4.283 SOL ($443)`, `💰 Profit: +1.283 SOL ($133)`, dollars entiers par
  `formatUsd(v, { decimals: 0 })`, sans les parenthèses quand le prix SOL est inconnu) ;
  `en.sim.demoBanner` vaut `E.warning + DEMO_MENTION` ; aucune image ne porte plus la mention.
- **Tests** (24) : `model.test.ts` (exemple de la maquette, `62% held`, `<1% held`, USD omis,
  additivité, moteur réel : Sell 100 % à 10 s → `Closed`, timeout → `100% held`),
  `chart.test.ts` (bougies vertes / rouges et volume, graduations `0:00`…`3:00`, axe USD / SOL,
  échappement XML du nom, logo / pastille, 19 bougies d'un vrai run à 90 s dans le tracé),
  `card.test.ts` (overlay transparent de la taille du clip, lignes, pastille verte / rouge, trois
  glyphes Solana, logo / pastille), `png.test.ts` (signature et 1280 × 720, mêmes octets deux
  fois, logo réduit à 96 px puis embarqué, SVG cassé rejeté), `video.test.ts` (un vrai ffmpeg :
  MP4 de 0,2 à 5 MB en moins de 15 s). Manuel :
  `render:sample` puis regarder `out/` sur un téléphone.

## Moteur de simulation

`packages/sim-engine` est le moteur de « Simulate a Launch » (§7 du contexte) : TypeScript pur,
**zéro dépendance runtime**, ni API Node ni DOM, donc importable par Node (bot) comme par un
bundler. Une même seed rejoue exactement la même simulation, sur tous les moteurs JavaScript.
ESLint y interdit `Math.random`, `Date`, `performance`, `fetch`, l'opérateur `**` et les fonctions
`Math.log/exp/sin/cos/pow/tan…` (« implementation-approximated » en ECMAScript : V8 et
JavaScriptCore peuvent différer au dernier bit, puis la simulation diverge). Les tests, eux, peuvent
comparer à `Math.*`.

`SIM_ENGINE_VERSION` (proposition) est incrémentée à chaque changement d'algorithme ou de constante :
une simulation enregistrée ne se rejoue à l'identique qu'avec la version qui l'a produite. Version 2
(25/09/2026) : le bundle, second achat du dev ; un config sans bundle rejoue comme en version 1.

### API de la simulation : GET /api/simulations/:id et image du token (V1-23, retirée)

Livrée le 23/09/2026 (`12a6819`), **retirée par V1-24 le 24/09/2026** (décision D21, §6.5 du
contexte) : la simulation tourne dans le process du bot, plus aucune page ne lit l'API. Sont
partis avec elle : les routes `GET /api/simulations/:id` et `/image`, la limitation de fréquence
côté API (`RATE_LIMITS.api`, `apiImage`), l'activité de la Mini App (`touchUserActivity`), le
contrat `simulationResponseSchema` / `simIdParamSchema`, `SimulationStore.findForViewer` et les
codes d'erreur des images. Ce qui reste, parce que l'image de simulation (V1-25) en a besoin :
`createTelegramFileClient` (`getFile` + téléchargement avec `BOT_TOKEN`, type détecté par les
premiers octets, JPEG / PNG / WEBP, 5 Mo au plus, timeout 10 s, jamais de redirection vers l'URL
Telegram) et `createTokenImageService` (cache mémoire par `file_id`, 10 images, 1 h, une lecture
partagée entre appels concurrents), désormais tous deux dans `@launchbot/shared/server`.
L'`apps/api` est revenue au squelette de V1-05.

### Paramètres de curve lus dans le compte Global pump.fun (V1-21)

`createCurveParamsService` ([packages/solana/src/pump/curve-params.ts](packages/solana/src/pump/curve-params.ts))
fournit les `CurveParams` de toutes les simulations : lecture du compte `Global` du programme
pump.fun (`4wTV…xnjf`, PDA de seed `"global"` du programme `6EF8…F6P`, même adresse sur devnet et
mainnet) sur `SOLANA_RPC_URL`, décodage par `@pump-fun/pump-sdk`, conversion dans les unités du
moteur, cache 1 h, repli sur le tableau §7.1 (`FALLBACK_CURVE_PARAMS` du moteur, jamais recopié).
Branché dans `createDataServices` du bot (`getCurveParams()`), avec un préchargement non bloquant
au démarrage (proposition). Aucun écran : V1-22 copie la curve dans `Simulation.params`, une
relecture ultérieure ne change jamais une simulation existante.

- **Contrôles avant décodage**, chacun déclenche le repli avec sa raison dans un log `warn` :
  compte absent (`account_not_found`), owner (`wrong_owner`), discriminator Anchor lu dans l'IDL
  (`bad_discriminator`), données plus courtes que les champs utilisés, 162 octets calculés depuis
  l'IDL (`decode_error`), erreur ou timeout RPC de 5 s (`rpc_error`, `timeout`). Un compte plus
  long que l'IDL est accepté. Aucun offset écrit à la main : `decodePumpGlobal` passe par
  `PUMP_SDK.decodeGlobal` et l'IDL `pump.json` embarquée dans le SDK.
- **Conversion** (`pumpGlobalToCurveParams`) : lamports / 1e9, unités de base / 10^6
  (`TOKEN_DECIMALS` du moteur), `feeRate = (fee_basis_points + creator_fee_basis_points) / 10 000`
  (proposition : ce que paie le trader, 95 + 5 bps = 1 %), puis `assertCurveParams` du moteur,
  `feeRate < 10 %` (proposition) et le plus gros achat du dev à t = 0, 1 SOL de dev buy + 20 SOL
  de bundle (`MAX_OPENING_BUY_SOL`, 25/09/2026), qui ne complète pas la curve
  (proposition, ci-dessous). Échec → `invalid_values`.
- **Le `Global` du devnet n'est pas celui du mainnet** : 1 SOL de réserves virtuelles au lieu de
  30 (le reste est identique). Avec 1 SOL, un dev buy de 3 SOL complète la curve avant le premier
  trade : toute simulation serait finie à t = 0. Le contrôle le rejette et le tableau §7.1 sert :
  sur devnet, `source` vaut `fallback` aujourd'hui, `global` dès que le compte lu est cohérent
  (mainnet, DEC-05). Détail dans [packages/solana/README.md](packages/solana/README.md).
- **Cache et repli** : `createLastKnownValue` ; succès gardé 1 h (`CACHE_TTL_MS.pumpGlobal`),
  échec gardé 5 min (`pumpGlobalFailure`, proposition), N appels concurrents = une lecture. Après
  une lecture réussie, un échec sert la dernière valeur lue (`source: 'stale'`, `fetchedAt`
  d'origine) plutôt que le tableau. `getCurveParams()` **ne lève jamais**. Le `warn` passe par le
  scrubber du logger : jamais l'URL RPC (testé avec `?api-key=secret`).
- **SDK** : `@pump-fun/pump-sdk` 2.0.0, version figée, chargé en CommonJS via `createRequire`
  ([packages/solana/src/pump/sdk.ts](packages/solana/src/pump/sdk.ts)) : son build ESM importe
  `BN` en export nommé depuis `@coral-xyz/anchor`, que Node et `tsx` refusent (Vitest le masque).
  `@types/bn.js` en devDependency pour typer ses comptes décodés. Au chargement, `bigint-buffer`
  (dépendance de `@solana/spl-token`) affiche « Failed to load bindings, pure JS will be used »
  quand Visual Studio manque : sans effet.
- **Frais dynamiques par market cap** (programme pump-fees, compte `FeeConfig`) : non modélisés
  en V1, note et renvoi à V2-01 dans [packages/solana/README.md](packages/solana/README.md).
- **Tests** : fixture
  [packages/solana/test/fixtures/pump-global-devnet.json](packages/solana/test/fixtures/pump-global-devnet.json)
  capturée le 23/09/2026 (slot 503107921), compte synthétique aux valeurs §7.1 (offsets déduits de
  l'IDL, jamais écrits), PDA re-dérivée, `devBuySupplyShare` cohérent (3 SOL → 96.66M, 9.67 %),
  cache et timeout à horloge injectée, test devnet derrière `RUN_DEVNET_TESTS=1`.

### API SimRun et bougies (V1-20)

`createSimulation(config)` est le seul point d'entrée du bot (V1-22, puis le runner de simulation
V1-26). `assertSimConfig` vérifie chaque champ (seed uint32, dev buy et durée finis > 0, bundle
fini ≥ 0, curve et
preset par leurs validateurs, `solUsdPrice` `null` ou > 0) avec une `RangeError` qui nomme le champ,
puis le moteur travaille sur une copie gelée : l'objet reçu n'est jamais modifié, et un config passé
par `JSON.parse(JSON.stringify())` rejoue le même run.

- **Dev buy puis bundle à t = 0**, avant le premier trade simulé (décision du 25/09/2026 :
  `SimConfig.bundleSol`, le second achat du dev, même wallet ; le moteur n'a pas de blocs, le
  « bloc suivant » est « avant tout trader ») : `openingBuys()` renvoie le dev buy puis le bundle
  (`trader: "dev"`, `sol` = SOL payés frais inclus), jamais renvoyés par `step`. La position cumule
  les deux, comme un seul achat du total (frais linéaires). Sans bundle (`bundleSol` 0 : les
  Simulations d'avant et leur Run again), le dev buy seul, comme en version 1. Si le dev buy
  complète la curve, pas de bundle et fin immédiate `curve_complete` à `time() = 0`.
- **`step(dtSec)`** avance l'horloge simulée jusqu'à `min(time + dt, durationSec)` et renvoie les
  trades du flux (V1-19) dans l'ordre. Le résultat ne dépend pas du découpage : `step(180)` =
  180 × `step(1)` = 11 520 × `step(1/64)`. Les pas non dyadiques dérivent (0.016 × 11 250 =
  179.99999999998727) : à moins de 1e-9 s de la fin, l'horloge est ramenée à `durationSec`
  (proposition). Après la fin, `step` renvoie `[]` et l'horloge ne bouge plus.
- **`sellDev(fraction)`** : 0.25, 0.5 ou 1 (`DEV_SELL_FRACTIONS`) des tokens **encore détenus**
  (proposition, comme « Sell 25% » sur pump.fun), par la formule de la curve, impact et frais
  inclus. Renvoie `{ event, panic }` : l'événement du dev, puis, pour un Sell 100 % seulement,
  les ventes de panique des détenteurs (`TradeFlow.panic` : chacun revend `DEV_DUMP_PANIC_SHARE`
  = 90 % de ses tokens au même instant, les plus gros d'abord, la courbe retombe près du
  lancement ; proposition du 24/09/2026). L'enveloppe du garde-fou repart du nouveau prix, et
  tout vendre ferme la position (`position_closed`). Après la fin : `SimulationEndedError`.
- **`position()`** : `valueIfSoldNow` passe par `curve.quoteSell`, jamais prix × tokens (§6.2) ;
  `pnlSol = solOut + valueIfSoldNow − solIn`, `pnlPct` en points (proposition : dev buy 3.00, vendu
  4.28 → +42.7 %).
- **`topHolders(limit)`** : la bonding curve en holder (`totalSupply − circulation`, proposition
  conforme à pump.fun), le dev (`label: "dev"`) tant qu'il détient plus que la poussière, puis les
  traders simulés ; tri par tokens décroissants puis adresse ; parts en % dont la somme fait 100,
  calculées à la demande (quelques centaines de holders, un appel par image au plus).
- **`endReason()`** : `null`, puis la première condition atteinte, définitive : `timeout` (180 s),
  `position_closed` ou `curve_complete`. `time()` reste figé à l'instant de la fin (« Time 2:14 »).

Bougies : `createCandleAggregator({ initialPrice, durationSec })` agrège les trades sur
`CANDLE_INTERVAL_SEC` = 5 s simulées (seaux 0, 5, 10… ; un trade à t = 180 va dans le seau 175).
`initialPrice` est le prix **avant** dev buy, donc la première bougie inclut son saut si l'appelant
pousse `openingBuys()` en premier. `open` = `close` précédent, `high`/`low` incluent `open`,
`volumeSol`, `buys` et `sells` sont des sommes. Un intervalle sans trade jusqu'à `nowSec` donne une
bougie plate (proposition) : le graphique avance même sans trade. `push` renvoie les bougies créées
ou modifiées, en copies, pour un rendu incrémental (le rendu image V1-25 redessine tout à chaque
image : il lit `candles()` en entier).

Vecteurs testés (curve de repli, 3 SOL) : `sellDev(1)` à t = 0 rend 2.9403 SOL, `pnlSol` −0.0597,
`pnlPct` −1.99 ; top holders à t = 0 : bonding curve 90.334 %, dev 9.666 %. Test d'acceptation §15
via l'API publique : 1 000 seeds par preset, prix final au-dessus du prix après dev buy.

### Flux de trades, presets et garde-fou (V1-19)

`presetForAmount(sol)` renvoie les `PresetParams` du §7.3 : table exacte pour 3 / 5 / 10 SOL
(dressée pour des dev buys de ces montants ; le bot la lit avec le bundle depuis le 25/09/2026),
interpolation sur log(montant) entre deux presets pour Custom, preset le plus proche hors de
[3, 10]. `mu = ln(médiane)`, `sigma` 1, bornes de taille `MIN_TRADE_SOL` 0.01 et `MAX_TRADE_SOL` 5
(propositions, absentes du contexte). `assertPresetParams` valide un preset stocké.

`createTradeFlow({ seed, preset, curve, durationSec })` produit le marché simulé sur la curve
partagée avec V1-20 :

- **Six sous-flux** dérivés de la seed (`deriveSeed`) : calendrier, arrivées, sens, tailles,
  traders, adresses. Chaque candidat consomme toujours les mêmes tirages (1 arrivée, 1 sens,
  2 tailles, 2 traders) quelle que soit sa branche, même une vente ignorée : les flux restent
  alignés. Seul l'instant du prochain candidat est pré-tiré ; sens, taille et trader sont tirés au
  moment de l'appliquer, avec le prix courant. Une vente du dev entre deux candidats ne change donc
  pas `nextTradeTime()` mais est vue par le candidat suivant, et `advanceTo(180)` d'un coup donne
  exactement les mêmes événements que 10 800 appels par 1/60 s.
- **Calendrier** (`createSchedule`, tiré une fois, indépendant des trades) : λ(t) = λ0 · m(t) avec
  une ondulation lente (période 45 s, amplitude 0.35, plancher 0.2), des rafales de Poisson
  (intervalle moyen 40 s, amplitude U[0.5, 1.5], décroissance 6 s) et des phases de pBuy de
  10 à 30 s (montée +0.06 à 45 %, consolidation −0.04 à 35 %, repli −0.065 à 20 % : décalage
  moyen nul), pBuy borné à [0.35, 0.85]. Toutes ces valeurs sont des propositions dans
  `DEFAULT_FLOW_PARAMS`, « à ajuster à l'œil » (§7.3) ; elles ne sont pas dans `SimConfig`.
- **Trades** : délai exponentiel à λ évalué à l'instant du candidat précédent (lecture littérale du
  §7.2), sens Bernoulli, taille log-normale bornée en SOL. Un achat vient d'un nouveau trader à 60 %
  sinon d'un trader existant tiré uniformément (proposition) ; `TradeEvent.sol` = SOL payés frais
  inclus. Une vente vient d'un détenteur choisi en proportion de ses avoirs, jamais au-delà de ses
  avoirs (`tokensForGrossSolOut`), et est ignorée sans détenteur ; `sol` = SOL reçus frais déduits.
  `price` est le prix après le trade. Le dev n'est jamais tiré. Un achat qui complète la curve
  arrête le flux.
- **Registre** (`TraderRegistry`) : adresses factices `ABCD…EFGH` en base58, tirées depuis la seed,
  jamais de vraies clés, ordre de création déterministe ; il alimente les top holders.
- **Garde-fou haussier** : enveloppe `E(t) = Pref · (1 + 0.002 · (t − tref)) · 0.95` depuis le
  prix après dev buy. Prix sous l'enveloppe → pBuy relevé à 0.85 ; `resetEnvelope(t)` après une
  vente du dev. Invariant : k est constant, le prix ne dépend que des tokens en circulation, et sans
  vente du dev les traders ne revendent jamais plus qu'ils n'ont acheté, donc le prix ne repasse pas
  sous le prix après dev buy.

`pnpm --filter @launchbot/sim-engine sim:report [seeds]` (proposition) imprime par preset les trades
moyens, le ratio prix final / prix après dev buy (p1 / p50 / p99), la part de curves complètes et la
part de candidats sous l'enveloppe. Sur 1 000 seeds : 3 SOL → 162 trades, ×1.93 (p1 ×1.31) ; 5 SOL
→ 244, ×3.03 ; 10 SOL → 403, ×5.77, curve complète dans 9.8 % des runs.

### PRNG, math déterministe et bonding curve (V1-18)

- **PRNG** : `createRng(seed)` = sfc32 initialisé par quatre sorties de SplitMix32 puis 15 sorties
  jetées (proposition, domaine public, passe PractRand), uniquement `Math.imul`, `| 0`, `>>>`, `^`,
  `<<` : bit à bit identique partout. Seed uint32 obligatoire (`isValidSeed`, `RangeError` sinon,
  pas de troncature) ; `Simulation.seed` (int4) en est un sous-ensemble. `deriveSeed(seed, id)`
  donne une sous-seed par flux. Vecteurs de contrôle : seed 42 → 853279530, 1920286840, 3588795744.
- **`dmath`** : `ln`, `exp`, `sin`, `cos` n'utilisent que + − × ÷, `Math.sqrt`, `Math.floor` et
  `Math.abs` (exacts en IEEE 754). `ln` réduit x = m · 2^e avec m dans [√½, √2) puis série
  d'atanh ; `exp` réduit x = n · ln 2 + r puis Taylor ; `sin`/`cos` réduisent par π/2 en deux
  constantes (fdlibm) puis Taylor. Écart relatif ≤ 5e-15 face à `Math.*` sur les grilles de test ;
  une fixture des bits Float64 détecterait une dérive entre moteurs.
- **Lois** (§7.2) : `exponential`, `bernoulli`, `standardNormal` (Box-Muller, exactement deux
  uniformes, pas de cache), `normal`, `logNormal`, `logNormalBounded` (écrêtage, nombre de tirages
  fixe : proposition).
- **Bonding curve** (§7.1, exactement) : `BondingCurve` à produit constant sur réserves virtuelles,
  frais prélevés sur le SOL payé à l'achat et sur le SOL reçu à la vente (ne pas « corriger » vers
  le modèle on-chain : V2). Formes numériques stables `y·s'/(x + s')` et `x·t/(y + t)`. Un achat
  qui dépasse les réserves réelles est plafonné, le reste de SOL n'est pas dépensé (proposition),
  `capped: true` et curve complète (`realTokens ≤ DUST_TOKENS` = 1e-6, proposition) ; acheter
  ensuite → `CurveCompleteError`. `quoteBuy` / `quoteSell` ne modifient rien ; `buy` / `sell`
  appliquent. Une vente à moins de `DUST_TOKENS` de la circulation est ramenée à la circulation,
  au-delà → `RangeError`. `tokensForGrossSolOut` inverse la vente. `FALLBACK_CURVE_PARAMS` reprend
  le compte `Global` (30 SOL, 1 073 000 000, 793 100 000, 1 000 000 000, 1 %) ; `assertCurveParams`
  valide un compte décodé (V1-21). `marketCapSol`, `curveProgress`, `devBuySupplyShare` (part brute,
  l'écran choisit la précision : « ≈ 9.7% »).

Vecteurs testés : 3 SOL → 96 657 870.79 tokens (9.666 %), x = 32.97, market cap 33.769 SOL ; revente
immédiate → 2.9403 SOL et état initial retrouvé (tolérance 1e-9, jamais d'égalité stricte) ; 200 SOL
sur curve neuve → plafonné à 793 100 000 tokens pour 85.864 SOL payés, curve complète.

## Devnet

SOL de test : https://faucet.solana.com. Le bot refuse de démarrer hors devnet, et rien ne contourne
ce garde-fou, pas même les tests (le RPC est simulé). Aucune valeur « devnet » n'est codée en dur :
tout dérive de `SOLANA_CLUSTER` (centralisé en V1-03).

## Branches

`main` porte le socle stable : monorepo, base, bot qui répond en privé, premier accès (Terms et
canal) et écran d'accueil (V1-01 à V1-08, jusqu'au commit `0d7c2d8`). Depuis ce socle, **une
branche par feature**, nommée `feat/<feature>` et regroupant les tickets de la feature :

| Branche              | Tickets                            |
| -------------------- | ---------------------------------- |
| `feat/wallets`       | V1-09 à V1-14                      |
| `feat/token`         | V1-15 à V1-17                      |
| `feat/simulation`    | V1-18 à V1-26                      |
| `feat/subscribe`     | V1-27 à V1-34                      |
| `feat/launch-coin`   | V1-35 à V1-37                      |
| `feat/admin-support` | V1-38 (§1–2), V1-40, V1-42 à V1-45 |

Sur une branche : un commit par ticket, `pnpm lint`, `pnpm typecheck` et `pnpm test` verts avant
chaque commit.

`develop` est la branche d'intégration. Elle a été créée depuis `feat/wallets` (commit `fe775d7`,
V1-09 à V1-14) et porte donc déjà tout le travail des wallets sans fusion. Chaque branche de
feature suivante part de `develop` et y est fusionnée quand tous ses tickets sont en ✅ Terminé ;
`develop` est fusionnée dans `main` à chaque jalon stable.

```
main ──► develop ──► feat/token ──► (merge) develop ──► …
              └──► feat/simulation (partie de develop avant la fusion de feat/token : le moteur n'en dépend pas)
```

## Décisions techniques

| Date       | Décision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20/09/2026 | **Lib Solana (D10) : `@solana/web3.js` 1.x** (`^1.98.2`, 1.99.0 installée). C'est la dépendance directe de `@pump-fun/pump-sdk` 2.0.0 (avec `@coral-xyz/anchor`, `@solana/spl-token`, `bn.js`). Installée dans `packages/solana` uniquement, une seule copie dans le lockfile (`pnpm why -r @solana/web3.js`). Pas de `@solana/kit` en parallèle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 20/09/2026 | **TypeScript 6.0.x** (`~6.0`) et non 7.x : typescript-eslint 8 exige `typescript <6.1`. À relever quand typescript-eslint supportera TypeScript 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 20/09/2026 | **Packages internes consommés en source TS** (`exports` → `./src/index.ts`) : pas d'étape de build entre packages. Les process Node tournent avec `tsx` (`dev` : `tsx watch`, `start` : `tsx`). `tsc -b` sert au typecheck et n'émet que les déclarations (`emitDeclarationOnly`), nécessaires aux références de projets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 20/09/2026 | **Imports relatifs en `.js`** dans les packages Node (`moduleResolution: NodeNext`), sans extension dans la webapp (`Bundler`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 20/09/2026 | **Prisma 7.10.0**, version figée (le tag `latest` du CLI pointe sur une RC 8.0). Générateur `prisma-client` (client en TypeScript dans `src/generated/`), driver adapter `@prisma/adapter-pg`, URL dans `prisma.config.ts`. Avec l'adapter, P2002 ne donne que le nom de l'index : `isUniqueViolation` en déduit les champs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 20/09/2026 | **PostgreSQL Docker publié sur le port 5440**, pas 5432 : la machine de dev a des PostgreSQL natifs sur 5432 à 5435.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 20/09/2026 | **`@grammyjs/types` 5.0.0, version exacte**, dans `shared` : c'est celle que grammY 1.46 épingle, donc une seule copie des types Bot API. `shared` ne dépend pas de grammY.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 20/09/2026 | **Textes sous `packages/shared/src/i18n/`** (le contexte dit `shared/i18n/en.ts`) pour suivre les `exports` du package. `shared` ne lit jamais l'environnement : le cluster est passé en paramètre (`createUi(cluster)`), et la liste des clusters de `loadEnv` vient de `cluster.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 21/09/2026 | **grammY 1.46 avec `@grammyjs/storage-prisma`** (sessions et conversations dans la table `Session`). `@grammyjs/ratelimiter` n'est pas installé : la limite globale appelle `consumeRateLimit(userId, "global")`, le même compteur que les actions coûteuses et que l'API, donc une seule fenêtre glissante et un seul balayage des utilisateurs partis. `@grammyjs/auto-retry` attend sur les 429, borné à 2 essais et 10 s : les updates passent un par un, un réessai illimité bloquerait tout le monde.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 21/09/2026 | **`setLogDestination` est la prise de test du logger.** Un module crée son logger à l'import, donc sa destination doit pouvoir changer après coup : la bascule est au niveau du flux, après le nettoyage des secrets, et couvre tous les loggers et leurs enfants. C'est ce qui permet de prouver par un test qu'un secret n'est pas loggé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 21/09/2026 | **Chaque suite d'intégration a sa base** (`resetTestDatabase("bot")` → `launchbot_bot_test`) : Vitest lance les projets en parallèle, et deux suites qui réinitialisent la même base se la suppriment mutuellement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 21/09/2026 | **`runProcess` sort avec un délai de 100 ms.** Node 24 sous Windows plante sur une assertion libuv (code 127) si `process.exit()` suit de trop près une requête réseau, ce qui est exactement le cas d'un démarrage refusé par le garde-fou. `setImmediate` ne suffit pas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 21/09/2026 | **Fastify 5 avec le logger de `@launchbot/shared`** (`loggerInstance`), donc la même redaction et le même nettoyage que le bot. L'API s'expose comme `createApiService()` et rejoint le process du bot dans `apps/bot/src/main.ts` ; elle ne parle jamais à Solana, donc elle n'a pas de garde-fou devnet propre, et le bot démarre avant elle. `API_PORT` (3001) et `API_HOST` (`127.0.0.1`, `0.0.0.0` en conteneur) sont optionnelles, hors §12.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 21/09/2026 | **Un seul tunnel en local** : Vite relaie `/api` vers l'API, donc `WEBAPP_URL` = `API_URL`. Le CORS n'autorise que l'origine de `WEBAPP_URL` : une origine étrangère ne reçoit aucun `Access-Control-Allow-Origin`, et le preflight est mis en cache 2 h (`maxAge`), sinon l'en-tête personnalisé coûte un aller-retour de plus à chaque appel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 21/09/2026 | **Pas de `react-router-dom` dans la Mini App**, alors que la carte V1-05 le cite. Chaque page s'ouvre par une URL complète depuis un bouton `web_app` et aucune ne renvoie vers une autre : un aiguillage de dix lignes sur `location.pathname` suffit. Le routeur pesait 39 kB (13 kB gzip), soit 91 % de la croissance du bundle. À réintroduire si une page a un jour besoin de navigation interne.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 21/09/2026 | **Les textes de la Mini App sont dans `i18n/en-webapp.ts`**, exposés aussi comme `en.webapp`. `en` est un seul objet, qu'un bundler ne sait pas élaguer : l'importer embarquerait tous les textes du bot. ESLint interdit `en` et `E` dans `apps/webapp`. Le choix zod ou parseur manuel pour la Mini App est tranché le 23/09/2026 (V1-24, ligne ci-dessous).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 23/09/2026 | **zod dans le bundle de la Mini App** (V1-24) : `fetchSimulation` valide la réponse de l'API avec `simulationResponseSchema`, le schéma que l'API applique elle-même, comme la carte l'exige. Un parseur écrit à la main aurait dupliqué les règles de `simConfigSchema` et divergé un jour. Bundle : 221 kB → 330 kB (69 → 103 kB gzip), dont zod ≈ 74 kB (21 kB gzip) et le moteur `sim-engine`, puis 503 kB (159 kB gzip) avec `lightweight-charts` 5.2.1 en V1-25 (≈ 173 kB, 56 kB gzip, la dépendance que §12 impose) et 509 kB (161 kB gzip) avec la position et la PNL card de V1-26 ; les textes de la Mini App (`en-webapp.ts`) importent désormais `E` (la table des emojis, quelques centaines d'octets), toujours pas `en`. **Caduque le 24/09/2026** : l'écran de simulation est abandonné, zod et `lightweight-charts` sortent du bundle avec lui (ligne suivante).                                                                                                                                                                                       |
| 24/09/2026 | **La simulation se joue dans le chat, plus de Mini App pour la simulation ni pour le launch** (§6.5 du contexte). Après le premier test sur téléphone de l'écran V1-24 à V1-26, Tristan a tranché : un message photo du bot édité toutes les 3 s (`editMessageMedia`), boutons Sell et contrôles en clavier inline, PNL card qui remplace l'image du même message, `protect_content` contre le transfert et l'enregistrement. Rendu : SVG construit en TypeScript, rasterisé en PNG par `@resvg/resvg-js` avec une police embarquée (proposition). Perdu : le graphique fluide et le bloc Top holders. La Mini App ne garde que Terms et Privacy ; l'API n'a plus de route métier. Les cartes V1-24 à V1-26 sont réécrites (nettoyage, rendu image, simulation dans le chat) et le code de la Mini App de simulation n'est jamais commité : V1-24 ramène `apps/webapp` à V1-05 (bundle 509 kB → 221 kB, 69 kB gzip, sans `zod`, `lightweight-charts` ni `sim-engine`), retire l'API de simulation et déplace `createTokenImageService` dans `@launchbot/shared/server`. |
| 24/09/2026 | **Le runner de simulation vit dans le process du bot, en mémoire, un timer par simulation** (V1-26). Pas de table ni de worker : une simulation dure 3 minutes au plus, une pause 10 minutes, et un redémarrage la fige sans dommage (le message reste, ses boutons répondent « over »). Le temps simulé est un compteur entier de millisecondes que le runner pousse dans le moteur par `advanceTo(tSec)` (ajouté à `SimulationRun` par la passe `/simplify` : les trades sont tirés d'avance, le découpage en pas ne change rien, et `run.time()` devient exact). `createBot` rend désormais `{ bot, simRunner }` pour que le service arrête les minuteurs avant le bot.                                                                                                                                                                                                                                                                                                                                                                                              |
| 24/09/2026 | **Un Sell 100 % du dev fait paniquer les détenteurs** (`DEV_DUMP_PANIC_SHARE` 0.9, moteur). Tristan voulait que la bougie de clôture retombe vers 2–3 k$ de market cap ; la courbe à produit constant ne descend jamais sous son niveau de lancement (≈ 28 SOL, 3 200 $ à 116 $ le SOL), et la seule vente du dev laissait 4 500 à 10 000 $. Chaque détenteur revend donc 90 % de ses tokens à l'instant de la vente, les plus gros d'abord : la dernière image montre la chute, la carte suit 2 s après. Réglable en une constante, ou à retirer si le scénario ne plaît pas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 24/09/2026 | **PNL card animée sur un clip, composée par `ffmpeg-static`** (V1-25, demande de Tristan après son premier test). La carte suit sa maquette (ticker, pastille verte ou rouge avec le glyphe Solana, PNL / Invested / Position) et se pose sur un clip d'animation qu'il a fourni ; Telegram reçoit un MP4 muet en `editMessageMedia` `animation`, joué en boucle. Le clip (1,8 MB, prétraité une fois : sans son, 30 fps, 1280 × 944) vit dans `packages/sim-render/assets/`. `ffmpeg-static` (GPL, binaire par plateforme téléchargé à l'installation, ≈ 80 MB) lance ffmpeg en sous-processus une fois par simulation, ≈ 1,7 s ; l'image de déploiement devra le laisser s'installer (`pnpm install` sans `--ignore-scripts`). Avant la carte, le dernier graphique (la bougie de la vente de clôture) reste 2 s (`SIM_END_HOLD_MS`).                                                                                                                                                                                                                                 |
| 24/09/2026 | **Images de simulation : SVG écrit en TypeScript, rasterisé par `@resvg/resvg-js` 2.6.2 avec la police Inter embarquée** (V1-25, `packages/sim-render`). Le SVG se teste comme du texte (classes, libellés, géométrie), resvg est un binaire précompilé par plateforme sans dépendance système, et la police du dépôt rend les PNG identiques partout (`loadSystemFonts: false`). Écartés : `@napi-rs/canvas` (API impérative, tests sur des pixels) et `sharp` (rendu SVG via librsvg et fontconfig, police selon la machine). `fontBuffers` n'existe pas en 2.6.2 : les fichiers sont relus à chaque rendu, ≈ 52 ms par image de 36 bougies au total.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 23/09/2026 | **`@pump-fun/pump-sdk` 2.0.0 (version figée) chargé en CommonJS** via `createRequire` (V1-21) : son build ESM importe `BN` en export nommé de `@coral-xyz/anchor`, que Node et `tsx` refusent. `@types/bn.js` en devDependency. Le `Global` du devnet (1 SOL de réserves virtuelles, 30 sur mainnet) est rejeté par le service de curve : les simulations suivent le tableau §7.1 tant que le compte lu n'est pas cohérent avec le produit (un dev buy de 20 SOL ne doit pas compléter la curve à t = 0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 24/09/2026 | **Index unique partiel déclaré dans le schéma avec la preview Prisma `partialIndexes`** (V1-27) : `@@unique([userId], where: raw("status = 'ACTIVE'"))`, au plus un abonnement actif par utilisateur. Écrit à la main dans une migration, l'index aurait été vu comme une dérive et supprimé au prochain `migrate dev` ; déclaré, `migrate diff` reste vide. Revers : le client généré accepte `userId` dans un `findUnique` sans la condition, à ne jamais utiliser.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 24/09/2026 | **Montants de facture en entiers, sans decimal.js** (V1-28) : le taux SOL/USD est d'abord arrondi à 8 décimales, celles de la colonne, puis `lamports = ceil(cents × 10^15 / taux × 10^8)` en `bigint`. Le montant attendu se recalcule donc à l'identique depuis la ligne. L'écran l'arrondit vers le haut à 4 décimales (`formatSol(x, { decimals: 4, rounding: "ceil" })`) : qui envoie le montant affiché n'est jamais en paiement partiel (DEC-06, validé le 24/09/2026).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 24/09/2026 | **Un paiement depuis un wallet du bot à la fois par facture, par un verrou advisory de transaction** (V1-31) : `pg_try_advisory_xact_lock(hashtext('pay:' \|\| paymentId))` pris dans une transaction interactive qui reste ouverte pendant l'envoi (délai : toutes les tentatives de V1-13 plus une minute), plutôt qu'un verrou de session sur une connexion dédiée, que le pool de Prisma ne garantit pas. Déjà pris → rien n'est envoyé. Une transaction qui expirerait pendant l'envoi perd son verrou, jamais le résultat de l'envoi. Avant tout envoi, le dépôt est relu : une facture déjà couverte s'active sans nouvel envoi.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 25/09/2026 | **pg-boss 12.34.0 pour les jobs du worker, une boucle à part pour les paiements** (V1-32). Le cron de pg-boss descend à la minute : la détection toutes les 15 s est une boucle `runEvery` dans le process, tenue par une seule instance grâce à un verrou advisory de session sur une connexion `pg` dédiée (le pool de Prisma et celui de pg-boss prêtent une connexion par requête, un verrou de session n'y tiendrait pas). Les files sont `exclusive` : l'id de la facture en `singletonKey` dédoublonne les envois, un cron ne se chevauche pas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 25/09/2026 | **Les transferts d'un dépôt vers la trésorerie sont des lignes `Withdrawal` de type `DEPOSIT_SWEEP`** (V1-33, migration `payment_deposit_key_lifecycle`), plutôt que des colonnes de plus sur `Payment`. La ligne est écrite avant la signature et reçoit la signature avant la confirmation : un résultat inconnu est relu avant tout nouvel essai, par le même code que le retrait (`sendRecorded`, `settleTransfer`), et chaque transfert reste en comptabilité avec ses frais. `Payment.sweepSignature` garde le dernier transfert confirmé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 24/09/2026 | **Limite de création de factures comptée en base** (V1-28), pas dans le compteur mémoire du bot : les factures créées par l'utilisateur depuis 10 minutes, sous un verrou advisory par utilisateur qui sérialise aussi la réutilisation d'une facture ouverte. La limite tient aux redémarrages et le service reste utilisable hors du bot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 25/09/2026 | **Dev buy fixe de 1 SOL puis bundle choisi, depuis le même wallet** (décision de Tristan après les tests de V1-35 à V1-37) : le bundle vaut 3 / 5 / 10 SOL ou Custom de 3 à 20 SOL et achète au bloc suivant ; le minimum d'un launch est 4 SOL pile, sans marge de frais (même seuil pour l'accueil, D13) ; la simulation suit le même modèle (`SimConfig.bundleSol`, colonne `Simulation.bundleSol` par la migration `simulation_bundle`, 0 pour les lignes d'avant, qui rejouent à l'identique). Le preset d'activité suit le bundle (la table 3 / 5 / 10 reste la même).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 25/09/2026 | **Lot admin et support avant les canaux** (V1-38 §1–2, V1-40, V1-42 à V1-45, choix de Tristan) : la garde admin et les erreurs communes de V1-38 sont livrées avec les commandes qui en dépendent, `/announce` attend la partie canaux. La garde est un middleware juste avant le routeur de callbacks, après la gate : une commande du registre ou un clic `adm:*` d'un non-admin reçoit le silence d'une commande inconnue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 25/09/2026 | **Le Confirm de /grant ne sert qu'une fois, garanti en base** (V1-42, migration `subscription_grant`) : la ligne `SubscriptionGrant` (nonce unique) et l'activation s'écrivent dans la même transaction, sous le verrou `FOR UPDATE` du User qui sérialise déjà grants et paiements (`lockUserRow`, sorti de `subscriptions.ts` dans `user.ts`, pris aussi par `deleteUserData`). La vérification « l'offre est-elle encore celle de l'écran » se fait sous ce verrou, pas avant : aucune fenêtre entre le contrôle et l'écriture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 25/09/2026 | **Les messages de clés de /getall sont supprimés par un balayeur du bot, sur une table** (V1-43, migration `sensitive_message`) : `SensitiveMessage` (chat, message, échéance) écrit juste après chaque envoi, relu au démarrage puis toutes les 5 s, donc une suppression survit à un redémarrage. `runEvery` passe du worker à `@launchbot/shared/server` pour servir aux deux. `protect_content` reste désactivé : sur certains clients il bloque aussi la copie du texte.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 25/09/2026 | **Un seul service de suppression de compte, dans `@launchbot/db`** (V1-44) : `/purge` l'appelle après ses blocages, le worker (V1-45) après avoir vidé les wallets vers la trésorerie, avec `onlyIfLastActiveBefore`. Paiements et retraits restent, détachés ; les sessions grammY du chat partent avec le compte (`sessionKeysOf`, préfixe `conversation-` désormais défini dans `@launchbot/db`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 25/09/2026 | **Les transferts d'un compte inactif sont des retraits `INACTIVITY_SWEEP`** (V1-45), enregistrés par `sendRecorded` comme ceux de la trésorerie : ligne avant la signature, signature avant la confirmation, issue inconnue relue sur la chaîne avant tout nouvel essai, `userTelegramId` gardé pour un remboursement. Files en politique `exclusive` (déjà celle du worker) plutôt que `stately` : un passage à la fois, lancement à la main compris.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 25/09/2026 | **/purge transfère les SOL à la trésorerie au lieu de bloquer** (Tristan, V1-44) : les wallets au-dessus des frais d'un transfert partent vers `TREASURY_WALLET` avant la suppression, comme pour un compte inactif ; un seul mécanisme, `createAccountSweeper` (`account-sweep.ts`), sert aux deux, avec une relecture de l'activité pour l'inactivité seulement. Les transferts sont des `Withdrawal` de type `PURGE_SWEEP` (migration `purge_sweep`) avec l'ID Telegram. Une facture encore payable et des soldes illisibles bloquent toujours ; un transfert raté arrête la purge sans rien supprimer.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 25/09/2026 | **Un compte est supprimé après 24 h sans activité, et non plus 48 h** (Tristan, `INACTIVITY_DELETE_MS`) : ses SOL partent vers la trésorerie, puis le compte est supprimé, sans avertissement ; les admins restent exemptés. Le contrôle tourne toutes les 15 min, donc un compte part entre 24 h et 24 h 15 après sa dernière activité. Une facture restant payable 24 h 30 après sa création, un paiement tardif peut désormais arriver après la suppression : il n'active rien, le dépôt part à la trésorerie avec l'alerte de remboursement manuel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 25/09/2026 | **Plus de Terms of Service ni de Privacy Policy** (Tristan, V1-41 devenu le retrait) : plus d'écran « I accept » au premier accès (l'écran canal est le seul), plus de boutons dans le menu, plus de pages `/terms` et `/privacy`, plus de `TERMS_VERSION` ni de `legal.ts` ; colonnes `termsVersion` et `termsAcceptedAt` supprimées (migration `drop_terms`). La Mini App et l'API restent en place, sans page. Conséquence acceptée : aucun accord de l'utilisateur n'est plus enregistré (transferts vers la trésorerie, publication dans le canal Succès, durées de conservation).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
