-- Additive, reviewed change for the existing db-push-managed schema.
-- NOT automatically applied. Back up and test on a non-production database first.
-- Do not run prisma migrate deploy without baselining the existing schema.
BEGIN;
CREATE TABLE "agent_operations" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_operations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_operations_source_botId_messageId_operationKey_key"
    ON "agent_operations"("source", "botId", "messageId", "operationKey");
COMMIT;
