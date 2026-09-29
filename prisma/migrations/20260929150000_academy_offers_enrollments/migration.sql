-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "AcademyCourse" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onSite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "perks" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "schedule" TEXT,
ADD COLUMN     "seats" INTEGER;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "enrollmentId" UUID,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CourseEnrollment" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "courseId" UUID,
    "courseTitle" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "phone" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrollment_number_key" ON "CourseEnrollment"("number");

-- CreateIndex
CREATE INDEX "CourseEnrollment_userId_createdAt_idx" ON "CourseEnrollment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CourseEnrollment_status_createdAt_idx" ON "CourseEnrollment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_enrollmentId_key" ON "Payment"("enrollmentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CourseEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "AcademyCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

