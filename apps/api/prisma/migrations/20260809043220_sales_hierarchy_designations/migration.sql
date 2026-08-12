-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "designationId" TEXT,
ADD COLUMN     "employeeCode" VARCHAR(24),
ADD COLUMN     "isHrManaged" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "designation" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "level" INTEGER NOT NULL,
    "defaultScope" "DataScope" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "designation_code_key" ON "designation"("code");

-- CreateIndex
CREATE INDEX "designation_isActive_level_idx" ON "designation"("isActive", "level");

-- CreateIndex
CREATE INDEX "app_user_designationId_idx" ON "app_user"("designationId");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Employee codes identify a person in the HR system, so two users must never
-- share one. A partial index because it is optional: partners, customers and
-- users created before the HR feed exists all legitimately have none, and a
-- plain UNIQUE would allow only one such row.
CREATE UNIQUE INDEX "app_user_employee_code_key"
    ON "app_user" ("employeeCode")
    WHERE "employeeCode" IS NOT NULL AND "deletedAt" IS NULL;
