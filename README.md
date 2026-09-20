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
`package.json` ; ESLint ajoute les règles de `shared`, `sim-engine` et `webapp` :

| Package         | Peut importer                                            |
| --------------- | -------------------------------------------------------- |
| `shared`        | aucun package interne                                    |
| `sim-engine`    | rien : ni package interne, ni API Node                   |
| `db`, `solana`  | `shared`                                                 |
| `api`, `worker` | `shared`, `db`, `solana`                                 |
| `bot`           | `shared`, `db`, `solana`, `sim-engine`, `api`            |
| `webapp`        | `shared` (entrée universelle) et `sim-engine` uniquement |

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
§13). Le client généré (`packages/db/src/generated/`) n'est pas commité : `pnpm install` lance
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

`pnpm test:db` supprime puis recrée la base `launchbot_test` et y applique les migrations avec
`prisma migrate deploy`. L'URL vient de `TEST_DATABASE_URL`, sinon de `DATABASE_URL` avec le suffixe
`_test`. Une base dont le nom ne finit pas par `_test` est refusée.

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

`WEBAPP_URL` doit être en `https://` dès le démarrage : lancer le tunnel avant le bot, ou mettre
une URL https provisoire tant que la Mini App n'existe pas.

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
3. `/setcommands` → `start - Open Launch Bot` uniquement. Les commandes admin ne sont pas listées.

### Canaux

Créer les trois canaux (canal du bot, Succès, Annonces), puis ajouter le bot comme
**administrateur** de chacun : c'est nécessaire pour y publier et pour vérifier l'adhésion
(`getChatMember`). Noter pour chaque canal son ID (`-100…`) et son lien public dans `CHANNEL_*_ID`
et `CHANNEL_*_URL`. Le compte support va dans `SUPPORT_URL` (`https://t.me/…`).

### Mini App en local (HTTPS obligatoire)

Telegram n'ouvre une Mini App qu'en HTTPS. En local, exposer Vite (port 5173) par un tunnel :

```sh
cloudflared tunnel --url http://localhost:5173
# ou
ngrok http 5173
```

Copier l'URL https obtenue dans `WEBAPP_URL`. Les hôtes `.trycloudflare.com`, `.ngrok-free.app` et
`.ngrok.app` sont déjà autorisés dans `server.allowedHosts` de
[apps/webapp/vite.config.ts](apps/webapp/vite.config.ts). L'URL d'un quick tunnel change à chaque
lancement : mettre `WEBAPP_URL` à jour et relancer le bot.

## Devnet

SOL de test : https://faucet.solana.com. Le bot refusera de démarrer hors devnet (garde-fou du
ticket V1-04). Aucune valeur « devnet » n'est codée en dur : tout dérive de `SOLANA_CLUSTER`
(centralisé en V1-03).

## Décisions techniques

| Date       | Décision                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20/09/2026 | **Lib Solana (D10) : `@solana/web3.js` 1.x** (`^1.98.2`, 1.99.0 installée). C'est la dépendance directe de `@pump-fun/pump-sdk` 2.0.0 (avec `@coral-xyz/anchor`, `@solana/spl-token`, `bn.js`). Installée dans `packages/solana` uniquement, une seule copie dans le lockfile (`pnpm why -r @solana/web3.js`). Pas de `@solana/kit` en parallèle. |
| 20/09/2026 | **TypeScript 6.0.x** (`~6.0`) et non 7.x : typescript-eslint 8 exige `typescript <6.1`. À relever quand typescript-eslint supportera TypeScript 7.                                                                                                                                                                                                |
| 20/09/2026 | **Packages internes consommés en source TS** (`exports` → `./src/index.ts`) : pas d'étape de build entre packages. Les process Node tournent avec `tsx` (`dev` : `tsx watch`, `start` : `tsx`). `tsc -b` sert au typecheck et n'émet que les déclarations (`emitDeclarationOnly`), nécessaires aux références de projets.                         |
| 20/09/2026 | **Imports relatifs en `.js`** dans les packages Node (`moduleResolution: NodeNext`), sans extension dans la webapp (`Bundler`).                                                                                                                                                                                                                   |
| 20/09/2026 | **Prisma 7.10.0**, version figée (le tag `latest` du CLI pointe sur une RC 8.0). Générateur `prisma-client` (client en TypeScript dans `src/generated/`), driver adapter `@prisma/adapter-pg`, URL dans `prisma.config.ts`. Avec l'adapter, P2002 ne donne que le nom de l'index : `isUniqueViolation` en déduit les champs.                      |
| 20/09/2026 | **PostgreSQL Docker publié sur le port 5440**, pas 5432 : la machine de dev a des PostgreSQL natifs sur 5432 à 5435.                                                                                                                                                                                                                              |
| 20/09/2026 | **`@grammyjs/types` 5.0.0, version exacte**, dans `shared` : c'est celle que grammY 1.46 épingle, donc une seule copie des types Bot API. `shared` ne dépend pas de grammY.                                                                                                                                                                       |
| 20/09/2026 | **Textes sous `packages/shared/src/i18n/`** (le contexte dit `shared/i18n/en.ts`) pour suivre les `exports` du package. `shared` ne lit jamais l'environnement : le cluster est passé en paramètre (`createUi(cluster)`), et la liste des clusters de `loadEnv` vient de `cluster.ts`.                                                            |
