CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

ALTER TABLE "User"
ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "InvitationCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codePrefix" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "maxUses" INTEGER NOT NULL,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvitationCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvitationRedemption" (
  "id" TEXT NOT NULL,
  "invitationCodeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvitationRedemption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "result" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvitationCode_codeHash_key" ON "InvitationCode"("codeHash");
CREATE INDEX "InvitationCode_expiresAt_disabledAt_idx" ON "InvitationCode"("expiresAt", "disabledAt");
CREATE UNIQUE INDEX "InvitationRedemption_invitationCodeId_userId_key" ON "InvitationRedemption"("invitationCodeId", "userId");
CREATE INDEX "InvitationRedemption_userId_idx" ON "InvitationRedemption"("userId");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

ALTER TABLE "InvitationCode"
ADD CONSTRAINT "InvitationCode_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvitationRedemption"
ADD CONSTRAINT "InvitationRedemption_invitationCodeId_fkey"
FOREIGN KEY ("invitationCodeId") REFERENCES "InvitationCode"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvitationRedemption"
ADD CONSTRAINT "InvitationRedemption_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
