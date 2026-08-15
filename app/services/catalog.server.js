import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { head, put } from "@vercel/blob";

const catalogFile = process.env.CATALOG_FILE_PATH || join(process.cwd(), "data/catalog.json");
const blobPath = process.env.CATALOG_BLOB_PATH || "goodfolk/catalog.json";

async function readStoredCatalog() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await head(blobPath);
      const response = await fetch(blob.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Catalog blob returned HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      if (error?.name === "BlobNotFoundError") return null;
      throw error;
    }
  }

  try {
    return JSON.parse(await readFile(catalogFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeStoredCatalog(catalog) {
  const payload = JSON.stringify(catalog);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await put(blobPath, payload, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
    });
    return;
  }

  await mkdir(dirname(catalogFile), { recursive: true });
  const temporaryFile = `${catalogFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, payload, "utf8");
  await rename(temporaryFile, catalogFile);
}

const money = (value) => {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`Invalid price: ${value}`);
  }
  return Math.round(price * 100) / 100;
};

const skuFor = (pattern, garment, color, size) =>
  pattern
    .replaceAll("{garment}", garment.value)
    .replaceAll("{color}", color.skuKey)
    .replaceAll("{size}", size.skuKey);

export function normalizeCatalog(input) {
  if (!input || !Array.isArray(input.garments)) {
    throw new Error("Catalog must contain a garments array");
  }

  const pattern = input.skuPattern || input.pattern || "{garment}-{color}-{size}";
  const entries = [];
  const seen = new Set();

  for (const garment of input.garments) {
    if (!garment?.value || !Array.isArray(garment.colors) || !Array.isArray(garment.sizes)) {
      throw new Error("Each garment needs value, colors, and sizes");
    }

    for (const color of garment.colors) {
      for (const size of garment.sizes) {
        if (!color.sizes?.includes(size.value)) continue;
        const sku = skuFor(pattern, garment, color, size);
        if (seen.has(sku)) throw new Error(`Duplicate SKU: ${sku}`);
        seen.add(sku);
        entries.push({
          sku,
          style: garment.value,
          color: color.value,
          size: size.value,
          price: money(size.price),
          currency: input.currency || "USD",
        });
      }
    }
  }

  if (!entries.length) throw new Error("Catalog contains no valid entries");
  return { version: String(input.version || new Date().toISOString()), entries };
}

export async function publishCatalog(input, source) {
  const catalog = normalizeCatalog(input);
  const current = await readStoredCatalog();
  if (current?.version === catalog.version) {
    return { version: current.version, entryCount: current.entries.length, created: false };
  }

  const stored = {
    ...input,
    version: catalog.version,
    source,
    publishedAt: new Date().toISOString(),
    entries: catalog.entries,
  };
  await writeStoredCatalog(stored);
  return { version: stored.version, entryCount: stored.entries.length, created: true };
}

export async function findPrice(sku) {
  if (!sku || typeof sku !== "string" || sku.length > 160) return null;
  const catalog = await readStoredCatalog();
  return catalog?.entries?.find((entry) => entry.sku === sku) || null;
}

export async function latestCatalog() {
  const catalog = await readStoredCatalog();
  if (!catalog) return null;
  return {
    version: catalog.version,
    source: catalog.source,
    entryCount: catalog.entries.length,
    createdAt: catalog.publishedAt,
  };
}

export async function currentCatalog() {
  return readStoredCatalog();
}

export function authorized(request) {
  const expected = process.env.HUB_API_TOKEN;
  if (!expected) return false;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
