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
aucune écriture en base), `ensureAnswered`, `touchUser` (activité, qui pilote la purge à 48 h),
sessions, **`sensitiveMessageGuard`** (V1-12), limite globale de fréquence, `access.gate` (premier
accès), conversations, puis `/start` et le routeur de callbacks. Les commandes admin (V1-38)
s'enregistrent après la gate. Le garde anti-secret est **avant** la limite de fréquence et la gate :
une clé collée doit quitter le chat même si l'utilisateur est limité ou n'a pas accepté les Terms —
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
  `/getall` seulement — ESLint refuse son import hors de `apps/bot/src/features/admin/` et des tests
  (proposition). Elle lit la clé maître par un `WeakMap` interne, pas par une méthode du vault.
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

## Branches

`main` porte le socle stable : monorepo, base, bot qui répond en privé, premier accès (Terms et
canal) et écran d'accueil (V1-01 à V1-08, jusqu'au commit `0d7c2d8`). Depuis ce socle, **une
branche par feature**, nommée `feat/<feature>` et regroupant les tickets de la feature :

| Branche              | Tickets       |
| -------------------- | ------------- |
| `feat/wallets`       | V1-09 à V1-14 |
| `feat/token`         | V1-15 à V1-17 |
| `feat/simulation`    | V1-18 à V1-26 |
| `feat/subscribe`     | V1-27 à V1-34 |
| `feat/launch-coin`   | V1-35 à V1-37 |
| `feat/admin-support` | V1-38 à V1-45 |

Sur une branche : un commit par ticket, `pnpm lint`, `pnpm typecheck` et `pnpm test` verts avant
chaque commit. La branche est fusionnée dans `main` quand tous ses tickets sont en ✅ Terminé.

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
