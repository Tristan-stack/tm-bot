-- /getall (V1-43): the messages holding wallet keys, deleted 60 s after their send.

-- CreateTable
CREATE TABLE "SensitiveMessage" (
    "id" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "deleteAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SensitiveMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SensitiveMessage_deleteAt_idx" ON "SensitiveMessage"("deleteAt");

-- CreateIndex
CREATE UNIQUE INDEX "SensitiveMessage_chatId_messageId_key" ON "SensitiveMessage"("chatId", "messageId");
