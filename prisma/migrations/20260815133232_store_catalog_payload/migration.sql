/*
  Warnings:

  - Added the required column `payload` to the `CatalogVersion` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CatalogVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CatalogVersion" ("createdAt", "entryCount", "id", "source", "version", "payload") SELECT "createdAt", "entryCount", "id", "source", "version", '{}' FROM "CatalogVersion";
DROP TABLE "CatalogVersion";
ALTER TABLE "new_CatalogVersion" RENAME TO "CatalogVersion";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
