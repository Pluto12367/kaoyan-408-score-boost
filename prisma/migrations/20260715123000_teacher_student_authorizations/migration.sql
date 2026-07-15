CREATE TABLE "TeacherStudentAuthorization" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherStudentAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherStudentAuthorization_teacherId_studentId_key"
ON "TeacherStudentAuthorization"("teacherId", "studentId");

CREATE INDEX "TeacherStudentAuthorization_studentId_idx"
ON "TeacherStudentAuthorization"("studentId");

ALTER TABLE "TeacherStudentAuthorization"
ADD CONSTRAINT "TeacherStudentAuthorization_teacherId_fkey"
FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherStudentAuthorization"
ADD CONSTRAINT "TeacherStudentAuthorization_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
