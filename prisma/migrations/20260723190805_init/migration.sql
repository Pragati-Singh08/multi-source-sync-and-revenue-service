-- CreateTable
CREATE TABLE "SyncRecord" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "normalized" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "cursor" TEXT,
    "lastFullSyncAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "results" JSONB NOT NULL,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusMapping" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "canonicalStatus" TEXT NOT NULL,

    CONSTRAINT "StatusMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "canonicalStatus" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRecord_entityType_idx" ON "SyncRecord"("entityType");

-- CreateIndex
CREATE INDEX "SyncRecord_sourceUpdatedAt_idx" ON "SyncRecord"("sourceUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRecord_sourceSystem_externalId_key" ON "SyncRecord"("sourceSystem", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_sourceSystem_key" ON "SyncCursor"("sourceSystem");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_sourceSystem_eventId_key" ON "WebhookEvent"("sourceSystem", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusMapping_sourceSystem_rawStatus_key" ON "StatusMapping"("sourceSystem", "rawStatus");

-- CreateIndex
CREATE INDEX "Transaction_occurredAt_idx" ON "Transaction"("occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_canonicalStatus_idx" ON "Transaction"("canonicalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_sourceSystem_externalId_key" ON "Transaction"("sourceSystem", "externalId");
