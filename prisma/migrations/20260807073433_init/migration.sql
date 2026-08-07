-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" TEXT,
    "ipHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "source_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'LDXP_MERCHANT',
    "baseUrl" TEXT NOT NULL,
    "encryptedUsername" TEXT,
    "encryptedPassword" TEXT,
    "encryptedCookie" TEXT,
    "encryptedMerchantToken" TEXT,
    "sessionStatus" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "browserProfilePath" TEXT,
    "lastAuthAt" DATETIME,
    "lastVerifiedAt" DATETIME,
    "lastError" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "session_import_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceAccountId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_import_codes_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "source_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "source_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "goodsType" TEXT,
    "sourceTitle" TEXT,
    "sourceDescription" TEXT,
    "sourceImageUrl" TEXT,
    "sourcePrice" DECIMAL,
    "stockCount" INTEGER,
    "sourceStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "availability" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "syncStatus" TEXT NOT NULL DEFAULT 'STALE',
    "sourceUrl" TEXT,
    "rawPayload" TEXT,
    "lastCheckedAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "freshUntil" DATETIME,
    "staleUntil" DATETIME,
    "nextCheckAt" DATETIME,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveOutOfStock" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "source_products_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "source_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceProductId" TEXT,
    "slug" TEXT NOT NULL,
    "publicationStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "coverUrl" TEXT,
    "gallery" TEXT NOT NULL DEFAULT '[]',
    "displayPrice" DECIMAL,
    "priceMode" TEXT NOT NULL DEFAULT 'SOURCE',
    "priceAdjustment" DECIMAL,
    "categoryId" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "buttonText" TEXT NOT NULL DEFAULT '前往商品页',
    "targetUrlOverride" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "manualLock" BOOLEAN NOT NULL DEFAULT false,
    "autoHideWhenOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "lastViewedAt" DATETIME,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "products_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "source_products" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceAccountId" TEXT,
    "sourceProductId" TEXT,
    "trigger" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "itemsChanged" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_runs_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "source_accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sync_runs_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "source_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceProductId" TEXT NOT NULL,
    "oldSourceStatus" TEXT,
    "newSourceStatus" TEXT,
    "oldAvailability" TEXT,
    "newAvailability" TEXT,
    "oldPrice" DECIMAL,
    "newPrice" DECIMAL,
    "oldStockCount" INTEGER,
    "newStockCount" INTEGER,
    "trigger" TEXT,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    CONSTRAINT "status_history_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "source_products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "click_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "referrer" TEXT,
    "utmSource" TEXT,
    "country" TEXT,
    "userAgentHash" TEXT,
    "ipHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "click_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "source_accounts_sessionStatus_idx" ON "source_accounts"("sessionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "session_import_codes_codeHash_key" ON "session_import_codes"("codeHash");

-- CreateIndex
CREATE INDEX "session_import_codes_expiresAt_idx" ON "session_import_codes"("expiresAt");

-- CreateIndex
CREATE INDEX "source_products_nextCheckAt_idx" ON "source_products"("nextCheckAt");

-- CreateIndex
CREATE INDEX "source_products_sourceStatus_availability_idx" ON "source_products"("sourceStatus", "availability");

-- CreateIndex
CREATE INDEX "source_products_syncStatus_idx" ON "source_products"("syncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "source_products_sourceAccountId_externalId_key" ON "source_products"("sourceAccountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_sortOrder_idx" ON "categories"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_publicationStatus_sortOrder_idx" ON "products"("publicationStatus", "sortOrder");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_sourceProductId_idx" ON "products"("sourceProductId");

-- CreateIndex
CREATE INDEX "products_featured_idx" ON "products"("featured");

-- CreateIndex
CREATE INDEX "sync_runs_createdAt_idx" ON "sync_runs"("createdAt");

-- CreateIndex
CREATE INDEX "sync_runs_status_idx" ON "sync_runs"("status");

-- CreateIndex
CREATE INDEX "sync_runs_sourceAccountId_createdAt_idx" ON "sync_runs"("sourceAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "status_history_sourceProductId_observedAt_idx" ON "status_history"("sourceProductId", "observedAt");

-- CreateIndex
CREATE INDEX "click_events_productId_createdAt_idx" ON "click_events"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "click_events_eventType_createdAt_idx" ON "click_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "click_events_createdAt_idx" ON "click_events"("createdAt");
