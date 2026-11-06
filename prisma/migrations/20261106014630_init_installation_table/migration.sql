-- CreateTable
CREATE TABLE "Installation" (
    "id" SERIAL NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "repos" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Installation_githubInstallationId_key" ON "Installation"("githubInstallationId");

-- CreateIndex
CREATE INDEX "Installation_accountName_idx" ON "Installation"("accountName");

-- CreateIndex
CREATE INDEX "Installation_status_idx" ON "Installation"("status");
