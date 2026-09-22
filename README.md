# Launch Bot

Bot Telegram pour créer et simuler des launchs de memecoins Solana via pump.fun, avec une Mini App
pour la simulation en direct. Projet perso, **devnet uniquement**.

- Spécification produit : [context_bot.md](context_bot.md)
- Tickets, décisions (D1–D20) et suivi : [board Trello « Launch Bot »](https://trello.com/b/Rx4KkRAj/launch-bot)

## Structure

```
apps/
  bot/         grammY : menus, parcours, commandes admin
  api/         Fastify : API de la Mini App, validation initData (rejoint le process du bot)
  worker/      jobs pg-boss : paiements, transferts, rappels, nettoyage
  webapp/      Vite + React + Lightweight Charts (Mini App)
packages/
  sim-engine/  moteur de simulation, TypeScript pur, sans réseau
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
| `db`, `solana` | `shared`                                                              |
| `api`          | `shared`, `db` — jamais `solana` : elle démarre sans garde-fou devnet |
| `worker`       | `shared`, `db`, `solana`                                              |
| `bot`          | `shared`, `db`, `solana`, `sim-engine`, `api`                         |
| `webapp`       | `shared` (entrée universelle, sans `en` ni `E`) et `sim-engine`       |

`@launchbot/shared` a deux entrées : `.` (navigateur + Node) et `./server` (Node uniquement :
`loadEnv`, `parseEnv`, `createLogger`, `scrubSecrets`). La Mini App n'importe jamais `./server`,
`db` ni `solana`.

L'entrée universelle fournit les briques de tous les écrans : textes `en` et emojis `E`
(`src/i18n/`), gabarit `renderScreen` / `renderInputScreen`, boutons et `navRow` (`src/ui/`), codec
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
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Base locale : `DATABASE_URL=postgresql://launchbot:launchbot@localhost:5440/launchbot`. Le conteneur
publie le port **5440** et non 5432, pour ne pas entrer en conflit avec un PostgreSQL installé sur la
machine. Pour en changer : `POSTGRES_PORT` dans `.env`, et adapter `DATABASE_URL`. La base
`launchbot_test` est créée au premier démarrage du volume ; pour repartir de zéro :
`docker compose down -v`.

## Scripts

| Script                   | Rôle                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `pnpm dev`               | bot, worker et webapp en mode watch (`tsx watch`, `vite`)        |
| `pnpm build`             | `tsc -b` sur tout le graphe, puis `vite build` pour la webapp    |
| `pnpm typecheck`         | `tsc -b` sur les 8 projets (références de projets)               |
| `pnpm lint`              | ESLint (typescript-eslint avec types, `no-console`)              |
| `pnpm format`            | Prettier (`pnpm format:check` pour vérifier)                     |
| `pnpm test`              | Vitest, un projet par app/package (`pnpm test:watch` en continu) |
| `pnpm test:db`           | avec `RUN_DB_TESTS=1` : tests d'intégration sur `launchbot_test` |
| `pnpm test:devnet`       | avec `RUN_DEVNET_TESTS=1` : tests qui appellent le RPC devnet    |
| `pnpm db:up` / `db:down` | démarre / arrête PostgreSQL                                      |

Un seul package : `pnpm --filter @launchbot/shared test`.

Les tests d'intégration sont ignorés par défaut. Convention :

```ts
describe.skipIf(!process.env.RUN_DB_TESTS)("PaymentService (db)", () => { … });
```

## Base de données

Schéma Prisma : [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma) (8 modèles V1 du
§13, plus la table `Session` que grammY utilise). Le client généré (`packages/db/src/generated/`) n'est pas commité : `pnpm install` lance
`prisma generate`, qui ne demande ni base ni `.env`.

| Script             | Rôle                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `pnpm db:generate` | régénère le client après une modification du schéma                      |
| `pnpm db:migrate`  | `prisma migrate dev` : crée et applique une migration (dev)              |
| `pnpm db:deploy`   | `prisma migrate deploy` : applique les migrations commitées              |
| `pnpm db:reset`    | vide la base de dev et rejoue tout (confirmation dans un terminal)       |
| `pnpm db:seed`     | seed de dev idempotent : un utilisateur Premium et un brouillon de token |
| `pnpm db:studio`   | Prisma Studio                                                            |

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
- aucun `prisma.user.delete` hors du service de purge (V1-44) : la cascade efface les clés des
  wallets.

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

`WEBAPP_URL` doit être en `https://` dès le démarrage : lancer le tunnel avant le bot. Avec une URL
https qui ne répond pas, le bot démarre, mais les boutons Terms et Privacy n'ouvrent rien.

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
commandes admin ne sont pas listées.

Le bot ne répond qu'en **conversation privée** : `/start` se tape dans le chat ouvert depuis
`https://t.me/<username_du_bot>`. Tapé dans un canal ou un groupe, il ne se passe rien, par
conception (§4.1), et rien n'apparaît dans les logs au niveau `info`.

### Canaux

Créer les trois canaux (canal du bot, Succès, Annonces), puis ajouter le bot comme
**administrateur** de chacun : c'est nécessaire pour y publier et pour vérifier l'adhésion
(`getChatMember`). Pour un canal public, `CHANNEL_*_ID` accepte directement `@nom_du_canal` ; pour
un canal privé, c'est l'ID numérique `-100…`. `CHANNEL_*_URL` est le lien `https://t.me/…`, et le
compte support va dans `SUPPORT_URL`.

### Mini App et API en local (HTTPS obligatoire)

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

Copier l'URL https obtenue dans `WEBAPP_URL` **et** dans `API_URL`, puis relancer le bot et Vite. Les
hôtes `.trycloudflare.com`, `.ngrok-free.app` et `.ngrok.app` sont déjà autorisés dans
`server.allowedHosts` de [apps/webapp/vite.config.ts](apps/webapp/vite.config.ts) : pour un autre
fournisseur de tunnel, y ajouter son hôte, sinon Vite refuse la requête. L'URL d'un quick tunnel
change à chaque lancement. Variante : deux tunnels (Mini App et API), avec `API_URL` sur le second ;
le CORS de l'API n'autorise que l'origine de `WEBAPP_URL`.

Tester une page : les boutons de l'écran Terms (voir « Premier accès ») ouvrent `/terms` et
`/privacy`. Pour une autre page, s'envoyer un bouton `web_app`, depuis le chat privé avec le bot,
jamais depuis un canal.

```sh
curl "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
  -H "content-type: application/json" \
  -d '{"chat_id": <ton_id>, "text": "Terms", "reply_markup": {"inline_keyboard":
       [[{"text": "Open", "web_app": {"url": "https://<tunnel>/terms"}}]]}}'
```

Les pages : `/terms` et `/privacy` (« Version N · Updated … », N = `TERMS_VERSION`), `/sim/:id`
(provisoire jusqu'à V1-24), et « Page not found. » ailleurs. Hors de Telegram, dans un navigateur,
elles s'affichent aussi ; seuls les appels à l'API sont refusés, faute d'`initData`.

`TERMS_VERSION` et `API_URL` sont les **deux seules** variables du `.env` injectées dans le bundle
(`define` de Vite) : changer de version impose de rebuilder la Mini App, et le build échoue si la
version n'a pas de date dans `LEGAL_UPDATED_AT`. En production, l'hébergement statique doit renvoyer
`index.html` pour toute route (`public/_redirects` le fait sur Cloudflare Pages et Netlify ; sur
nginx, `try_files $uri /index.html`), et ne doit envoyer ni `X-Frame-Options: DENY` ni
`frame-ancestors` restrictif : Telegram Web affiche la Mini App dans une iframe.

### API

`GET /health` est public et répond `{"status":"ok"}`, sans rien dire de l'environnement.

**Tout ce qui est sous `/api` est protégé par défaut.** Les routes de la Mini App se déclarent dans
l'option `routes` de `buildApiServer`, sans `preHandler` : le périmètre `/api` applique
`app.requireTelegramUser` à chacune, donc une route ne peut pas devenir publique par oubli. Ce
preHandler valide l'en-tête `X-Telegram-Init-Data` comme le décrit la doc Telegram (HMAC avec la clé
`WebAppData`, champs triés, comparaison en temps constant, `auth_date` d'une heure au plus). Tout
échec donne le même `401 {"error":"unauthorized"}` ; la raison n'est que dans les logs `debug`,
jamais l'en-tête. `request.telegramUser` n'est jamais `undefined` : le lire sur une route non
protégée lève une erreur, au lieu de donner un utilisateur vide que Prisma transformerait en requête
sans filtre de propriétaire.

Erreurs : un seul chemin de sortie, avec un mot fixe par statut et jamais le message de l'erreur. Un
4xx voulu passe tel quel — une route lève une erreur portant `statusCode` 403, 404 ou 429 — et tout
le reste répond `500 {"error":"internal_error"}`. Une URL mal formée suit le même chemin.

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
6. `setMyCommands`, puis long polling (`bot.start` supprime lui-même le webhook).

Chaîne de middlewares, dans cet ordre : `privateOnly` (en groupe ou en canal le bot ne fait rien,
aucune écriture en base), `ensureAnswered`, limite globale de fréquence, `touchUser` (activité, qui
pilote la purge à 48 h), sessions, `access.gate` (premier accès), conversations, puis `/start` et le routeur de callbacks. Les commandes admin (V1-38) s'enregistrent après la gate.
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
- Sections pas encore livrées : `registerComingSoon` enregistre un écran **provisoire** sur leur
  domaine (`router.registerProvisional`). Le `router.register` du ticket d'une section le remplace,
  sans rien retirer nulle part. `showComingSoon(ctx, ui, section)`
  ([coming-soon.ts](apps/bot/src/features/home/coming-soon.ts)) sert aussi pour un bouton laissé à
  un ticket ultérieur.

Routeur de callbacks : `router.register(domain, { action: handler })`. Un domaine ou une action
inconnus reçoivent « This button has expired » du routeur lui-même, aucun handler n'a à le faire.

Un clic bloqué (§4.5) est une paire `{ alert, flag }` de `en.ts`, passée à `blockWithFlag` : l'alerte
et la ligne écrite à l'écran vont toujours ensemble. `tooManyActions(retryAfterMs)` donne la paire
d'une action trop fréquente.

Les tests du bot tournent sur `botHarness()` ([test-harness.ts](apps/bot/src/test-harness.ts)) : faux
Telegram, fausse base, faux services de données. Sans l'option `data`, `createBot` branche le vrai RPC
et CoinGecko.

### Services de données (V1-07)

Les lectures derrière l'accueil et les écrans suivants, sans aucun affichage. `createDataServices`
([apps/bot/src/services/data.ts](apps/bot/src/services/data.ts)) les assemble, une instance par
process : les caches (§4.3) vivent dedans, en mémoire.

| Service                                                             | Où                  | Cache                                        |
| ------------------------------------------------------------------- | ------------------- | -------------------------------------------- |
| `getSolUsdPrice`, `getSolUsdQuote`                                  | `@launchbot/solana` | 60 s, échecs compris ; repli 10 min          |
| `getUserBalances(userId, { skipCache? })`                           | `@launchbot/db`     | 30 s par utilisateur                         |
| `countActiveSubscribers`                                            | `@launchbot/db`     | 60 s                                         |
| `getBotChannelMemberCount`                                          | `apps/bot`          | 10 min ; en erreur, dernière valeur connue   |
| `getActiveSubscription`, `getSubscriptionSummary`, `getWalletQuota` | `@launchbot/db`     | aucun : une activation se voit tout de suite |
| `getBalancesFresh(rpc, addresses)`                                  | `@launchbot/solana` | aucun : contrôles internes, un appel groupé  |

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
- Rien ne relit l'environnement en douce : `buildWebAppUrl(path, env.WEBAPP_URL)` et
  `getSolanaRpc(env.SOLANA_RPC_URL)` reçoivent leur configuration.
- `usdOf(lamports, price)`, `isWalletReady` et `getWalletLimit` sont dans `@launchbot/shared`.

### Premier accès (V1-06)

Aucun menu avant d'avoir accepté la version courante des Terms (écran 1) puis rejoint le canal du bot
(écran 2). `createAccess` ([apps/bot/src/features/access/access.ts](apps/bot/src/features/access/access.ts))
fournit tout ; les parcours s'y branchent depuis `createBot`, comme le fait l'accueil :

- `gate` : à **chaque** message ou clic, `termsVersion !== TERMS_VERSION` → écran 1, puis
  `channelCheckedAt === null` → écran 2. Seuls les boutons `acc:*` passent toujours. Aucun appel à
  Telegram ici : `ctx.user` est déjà chargé.
- `ensureChannelMembership(ctx, { mode, resume, display? })` : `true` si l'utilisateur est dans le
  canal, sinon affiche l'écran 2 et renvoie `false`. `/start` l'appelle en mode `cached` (10 min,
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
le canal du bot, `getChatMember` échoue et **personne ne passe l'écran 2**.

Rejouer le premier accès avec son propre compte : remettre `termsVersion` et `channelCheckedAt` à
`NULL` sur sa ligne `User` (`pnpm db:studio`), ou passer `TERMS_VERSION=2` après avoir ajouté la date
de la version 2 dans [packages/shared/src/legal.ts](packages/shared/src/legal.ts).

## Devnet

SOL de test : https://faucet.solana.com. Le bot refuse de démarrer hors devnet, et rien ne contourne
ce garde-fou, pas même les tests (le RPC est simulé). Aucune valeur « devnet » n'est codée en dur :
tout dérive de `SOLANA_CLUSTER` (centralisé en V1-03).

## Décisions techniques

| Date       | Décision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20/09/2026 | **Lib Solana (D10) : `@solana/web3.js` 1.x** (`^1.98.2`, 1.99.0 installée). C'est la dépendance directe de `@pump-fun/pump-sdk` 2.0.0 (avec `@coral-xyz/anchor`, `@solana/spl-token`, `bn.js`). Installée dans `packages/solana` uniquement, une seule copie dans le lockfile (`pnpm why -r @solana/web3.js`). Pas de `@solana/kit` en parallèle.                                                                                                                                                           |
| 20/09/2026 | **TypeScript 6.0.x** (`~6.0`) et non 7.x : typescript-eslint 8 exige `typescript <6.1`. À relever quand typescript-eslint supportera TypeScript 7.                                                                                                                                                                                                                                                                                                                                                          |
| 20/09/2026 | **Packages internes consommés en source TS** (`exports` → `./src/index.ts`) : pas d'étape de build entre packages. Les process Node tournent avec `tsx` (`dev` : `tsx watch`, `start` : `tsx`). `tsc -b` sert au typecheck et n'émet que les déclarations (`emitDeclarationOnly`), nécessaires aux références de projets.                                                                                                                                                                                   |
| 20/09/2026 | **Imports relatifs en `.js`** dans les packages Node (`moduleResolution: NodeNext`), sans extension dans la webapp (`Bundler`).                                                                                                                                                                                                                                                                                                                                                                             |
| 20/09/2026 | **Prisma 7.10.0**, version figée (le tag `latest` du CLI pointe sur une RC 8.0). Générateur `prisma-client` (client en TypeScript dans `src/generated/`), driver adapter `@prisma/adapter-pg`, URL dans `prisma.config.ts`. Avec l'adapter, P2002 ne donne que le nom de l'index : `isUniqueViolation` en déduit les champs.                                                                                                                                                                                |
| 20/09/2026 | **PostgreSQL Docker publié sur le port 5440**, pas 5432 : la machine de dev a des PostgreSQL natifs sur 5432 à 5435.                                                                                                                                                                                                                                                                                                                                                                                        |
| 20/09/2026 | **`@grammyjs/types` 5.0.0, version exacte**, dans `shared` : c'est celle que grammY 1.46 épingle, donc une seule copie des types Bot API. `shared` ne dépend pas de grammY.                                                                                                                                                                                                                                                                                                                                 |
| 20/09/2026 | **Textes sous `packages/shared/src/i18n/`** (le contexte dit `shared/i18n/en.ts`) pour suivre les `exports` du package. `shared` ne lit jamais l'environnement : le cluster est passé en paramètre (`createUi(cluster)`), et la liste des clusters de `loadEnv` vient de `cluster.ts`.                                                                                                                                                                                                                      |
| 21/09/2026 | **grammY 1.46 avec `@grammyjs/storage-prisma`** (sessions et conversations dans la table `Session`). `@grammyjs/ratelimiter` n'est pas installé : la limite globale appelle `consumeRateLimit(userId, "global")`, le même compteur que les actions coûteuses et que l'API, donc une seule fenêtre glissante et un seul balayage des utilisateurs partis. `@grammyjs/auto-retry` attend sur les 429, borné à 2 essais et 10 s : les updates passent un par un, un réessai illimité bloquerait tout le monde. |
| 21/09/2026 | **`setLogDestination` est la prise de test du logger.** Un module crée son logger à l'import, donc sa destination doit pouvoir changer après coup : la bascule est au niveau du flux, après le nettoyage des secrets, et couvre tous les loggers et leurs enfants. C'est ce qui permet de prouver par un test qu'un secret n'est pas loggé.                                                                                                                                                                 |
| 21/09/2026 | **Chaque suite d'intégration a sa base** (`resetTestDatabase("bot")` → `launchbot_bot_test`) : Vitest lance les projets en parallèle, et deux suites qui réinitialisent la même base se la suppriment mutuellement.                                                                                                                                                                                                                                                                                         |

| 21/09/2026 | **`runProcess` sort avec un délai de 100 ms.** Node 24 sous Windows plante sur une assertion libuv (code 127) si `process.exit()` suit de trop près une requête réseau, ce qui est exactement le cas d'un démarrage refusé par le garde-fou. `setImmediate` ne suffit pas. |
| 21/09/2026 | **Fastify 5 avec le logger de `@launchbot/shared`** (`loggerInstance`), donc la même redaction et le même nettoyage que le bot. L'API s'expose comme `createApiService()` et rejoint le process du bot dans `apps/bot/src/main.ts` ; elle ne parle jamais à Solana, donc elle n'a pas de garde-fou devnet propre, et le bot démarre avant elle. `API_PORT` (3001) et `API_HOST` (`127.0.0.1`, `0.0.0.0` en conteneur) sont optionnelles, hors §12. |
| 21/09/2026 | **Un seul tunnel en local** : Vite relaie `/api` vers l'API, donc `WEBAPP_URL` = `API_URL`. Le CORS n'autorise que l'origine de `WEBAPP_URL` : une origine étrangère ne reçoit aucun `Access-Control-Allow-Origin`, et le preflight est mis en cache 2 h (`maxAge`), sinon l'en-tête personnalisé coûte un aller-retour de plus à chaque appel. |

| 21/09/2026 | **Pas de `react-router-dom` dans la Mini App**, alors que la carte V1-05 le cite. Chaque page s'ouvre par une URL complète depuis un bouton `web_app` et aucune ne renvoie vers une autre : un aiguillage de dix lignes sur `location.pathname` suffit. Le routeur pesait 39 kB (13 kB gzip), soit 91 % de la croissance du bundle. À réintroduire si une page a un jour besoin de navigation interne. |
| 21/09/2026 | **Les textes de la Mini App sont dans `i18n/en-webapp.ts`**, exposés aussi comme `en.webapp`. `en` est un seul objet, qu'un bundler ne sait pas élaguer : l'importer embarquerait tous les textes du bot. ESLint interdit `en` et `E` dans `apps/webapp`. À décider avant V1-24 : importer un schéma zod depuis `@launchbot/shared` dans la Mini App coûterait 74 kB (21 kB gzip) ; `apiFetch` accepte tout objet doté d'un `parse`, donc un parseur écrit à la main suffit. |
