-- Behavior events (UX/ops analytics): records key learning-loop actions.
-- Backward compatible: additive table only.
CREATE TABLE "UserEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserEvent_userId_type_createdAt_idx" ON "UserEvent"("userId", "type", "createdAt");

ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
