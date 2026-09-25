-- At most one ACTIVE subscription per user (V1-27). Partial index, declared in the schema with
-- the `partialIndexes` preview feature: the activation expires the rows that ended before it
-- inserts, so this index only catches a bug.
-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId") WHERE (status = 'ACTIVE');
