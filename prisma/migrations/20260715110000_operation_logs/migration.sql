CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationLog_createdAt_idx" ON "OperationLog"("createdAt");
CREATE INDEX "OperationLog_userId_createdAt_idx" ON "OperationLog"("userId", "createdAt");
CREATE INDEX "OperationLog_method_path_createdAt_idx" ON "OperationLog"("method", "path", "createdAt");
CREATE INDEX "OperationLog_statusCode_createdAt_idx" ON "OperationLog"("statusCode", "createdAt");

ALTER TABLE "OperationLog"
ADD CONSTRAINT "OperationLog_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
