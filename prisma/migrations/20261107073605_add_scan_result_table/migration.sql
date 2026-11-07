-- CreateTable
CREATE TABLE "ScanResult" (
    "id" SERIAL NOT NULL,
    "installationId" INTEGER NOT NULL,
    "repoName" TEXT NOT NULL,
    "filesScanned" INTEGER NOT NULL DEFAULT 0,
    "filesUsingStripe" INTEGER NOT NULL DEFAULT 0,
    "calls" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanResult_installationId_idx" ON "ScanResult"("installationId");

-- CreateIndex
CREATE INDEX "ScanResult_repoName_idx" ON "ScanResult"("repoName");

-- CreateIndex
CREATE INDEX "ScanResult_scannedAt_idx" ON "ScanResult"("scannedAt");

-- AddForeignKey
ALTER TABLE "ScanResult" ADD CONSTRAINT "ScanResult_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
