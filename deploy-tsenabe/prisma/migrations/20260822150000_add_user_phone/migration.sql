-- Add the required phone number used during account creation.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");