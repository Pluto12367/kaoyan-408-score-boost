CREATE TYPE "TrialStatus" AS ENUM ('INVITED', 'ACTIVE', 'COMPLETED', 'FOLLOW_UP');

ALTER TABLE "User"
ADD COLUMN "trialStatus" "TrialStatus" NOT NULL DEFAULT 'INVITED';

UPDATE "User"
SET "trialStatus" = CASE
  WHEN "role" IN ('TEACHER', 'ADMIN') THEN 'ACTIVE'::"TrialStatus"
  WHEN "onboardingCompletedAt" IS NOT NULL THEN 'ACTIVE'::"TrialStatus"
  ELSE 'INVITED'::"TrialStatus"
END;
