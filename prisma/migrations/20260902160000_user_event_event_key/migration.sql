-- Add the server-owned idempotency key without requiring historical backfill.
ALTER TABLE "UserEvent" ADD COLUMN "eventKey" TEXT;

-- PostgreSQL permits multiple NULL values, preserving legacy events that have no
-- reliable deterministic key while enforcing one event per user and key.
CREATE UNIQUE INDEX "UserEvent_userId_eventKey_key"
    ON "UserEvent"("userId", "eventKey");
