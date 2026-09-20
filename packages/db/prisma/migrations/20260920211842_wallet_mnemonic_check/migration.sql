-- Prisma cannot express CHECK constraints: written by hand.
-- The encrypted seed phrase of a wallet is stored with its IV and auth tag, or not at all
-- (null for a wallet imported with a private key).
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_mnemonic_all_or_none" CHECK (
  ("encMnemonic" IS NULL AND "mnemonicIv" IS NULL AND "mnemonicAuthTag" IS NULL)
  OR ("encMnemonic" IS NOT NULL AND "mnemonicIv" IS NOT NULL AND "mnemonicAuthTag" IS NOT NULL)
);
