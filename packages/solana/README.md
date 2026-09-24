# @launchbot/solana

Wallets, soldes, retraits, chiffrement des clés, et pump.fun : lecture du compte `Global` en V1
(V1-21), création réelle en V2 (V2-03). La documentation de chaque ticket est dans le
[README racine](../../README.md) ; ce fichier tient les notes propres à pump.fun.

## Frais pump.fun et simulation (V1-21, note pour V2-01)

**Ce que la V1 modélise.** Un seul `feeRate` pour toute la simulation, appliqué à l'achat et à la
vente (§7.1, moteur V1-18), lu dans le compte `Global` :
`(fee_basis_points + creator_fee_basis_points) / 10 000`, soit 95 + 5 bps = 1 % sur le devnet.
Proposition : le 1 % du §7.1 est ce que paie le trader, protocole et créateur compris.

**Ce que fait pump.fun.** D'après le SDK `@pump-fun/pump-sdk` 2.0.0 (`fees.ts`, `state.ts`, IDL
`pump_fees.json`), à relire dans la doc des frais du dépôt `pump-fun/pump-public-docs` au moment
de la V2 :

- Un programme pump-fees (`pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`) tient un compte
  `FeeConfig` (PDA `["fee_config", programme pump]`) avec des **paliers par market cap** :
  `fee_tiers` (seuil en lamports → `protocol_fee_bps`, `creator_fee_bps`, `lp_fee_bps`), des
  paliers pour les quotes stables (`stable_fee_tiers`) et un barème plat pour les autres quotes.
- Quand `FeeConfig` existe, un trade paie le palier du market cap courant de la curve (SDK :
  `computeFeesBps` → `selectCurveFeeSchedule` → `calculateFeeTier`). Les `fee_basis_points` et
  `creator_fee_basis_points` du `Global` ne servent qu'en l'absence de `FeeConfig`.
- Une curve peut porter son propre taux créateur (`BondingCurve.creator_fee_bps`, actif si
  `Global.creator_fee_configurable`), qui remplace alors le taux créateur du palier.

**Pourquoi pas en V1.** Le moteur (§7.2) simule un lancement à frais constants. Lire `FeeConfig`,
choisir le palier à chaque trade selon le market cap et gérer le taux propre à une curve changent
le moteur et la relecture des simulations stockées (`SIM_ENGINE_VERSION`). **V2-01** relit
`FeeConfig`, mesure les frais réels sur devnet et décide si le moteur passe aux paliers et si
`feeRate` reste protocole + créateur.

## Le `Global` du devnet n'est pas celui du mainnet

Lu le 23/09/2026 (fixture [test/fixtures/pump-global-devnet.json](test/fixtures/pump-global-devnet.json)) :
réserves virtuelles SOL de **1 SOL** au lieu des 30 SOL du §7.1, tout le reste identique
(1 073 000 000 tokens virtuels, 793 100 000 réels, supply 1 000 000 000, 95 + 5 bps). Avec 1 SOL,
un dev buy de 3 SOL complète la curve avant le premier trade. Le service rejette un `Global` que le
dev buy maximal du produit (20 SOL) complète à t = 0 (`invalid_values`) et sert le tableau §7.1 :
sur devnet, `source` vaut `fallback` ; `global` dès que le compte lu est cohérent (mainnet,
DEC-05).
