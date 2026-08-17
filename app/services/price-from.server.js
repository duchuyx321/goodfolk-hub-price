import { currentCatalog } from "./catalog.server";

const METAFIELD_NAMESPACE = "goodfolk";
const METAFIELD_KEY = "price_from";

// ---- Reverse lookup: product price (giá max) → giá min hiển thị "From $X" ----

// Mỗi garment trong catalog: min = giá size thấp nhất, max = giá size cao nhất.
// Gom theo max; from của một mức giá = min thấp nhất trong nhóm trùng max
// (thiên về conversion, tự cập nhật khi catalog đổi — không có dữ liệu cũ trên product).
export function buildPriceFromMap(catalog) {
  const garments = catalog?.garments || [];
  const byMax = new Map();

  for (const garment of garments) {
    const prices = [];
    for (const color of garment.colors || []) {
      for (const size of garment.sizes || []) {
        if (!color.sizes?.includes(size.value)) continue;
        const cents = Math.round(Number(size.price) * 100);
        if (Number.isFinite(cents) && cents > 0) prices.push(cents);
      }
    }
    if (!prices.length) continue;

    const maxCents = Math.max(...prices);
    const minCents = Math.min(...prices);
    const group = byMax.get(maxCents) || [];
    group.push(minCents);
    byMax.set(maxCents, group);
  }

  // max → from (min thấp nhất trong nhóm trùng max).
  const lookup = new Map();
  for (const [maxCents, mins] of byMax) {
    lookup.set(maxCents, Math.min(...mins));
  }
  return lookup;
}

// Product giá = max của nhóm garment nó bán → tìm mức max gần nhất ≤ giá product
// (giá không khớp chính xác vẫn có thể hiển thị From an toàn).
export function fromPriceForPrice(lookup, productPriceCents) {
  if (!Number.isFinite(productPriceCents) || productPriceCents <= 0) return null;
  if (lookup.has(productPriceCents)) return lookup.get(productPriceCents);

  let best = null;
  for (const maxCents of lookup.keys()) {
    if (maxCents <= productPriceCents && (best === null || maxCents > best)) {
      best = maxCents;
    }
  }
  return best === null ? null : lookup.get(best);
}

// ---- Sync metafield goodfolk.price_from cho toàn bộ products ----

const PRODUCTS_QUERY = `#graphql
query Products($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      legacyResourceId
      variantsCount { count }
      priceRange { minVariantPrice { amount } }
    }
  }
}`;

const PRODUCT_UPDATE_MUTATION = `#graphql
mutation ProductUpdate($productId: ID!, $metafields: [MetafieldInput!]!) {
  productUpdate(productId: $productId, metafields: $metafields) {
    product { id }
    userErrors { field message }
  }
}`;

async function fetchAllProducts(admin) {
  const products = [];
  let after = null;
  for (;;) {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: 250, after },
    });
    const { data, errors } = await response.json();
    if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
    const page = data?.products;
    if (!page) break;
    products.push(...(page.nodes || []));
    if (!page.pageInfo?.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return products;
}

async function writeMetafield(admin, productId, value) {
  const response = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
    variables: {
      productId,
      metafields: [
        {
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEY,
          type: "number_decimal",
          value: String(value),
        },
      ],
    },
  });
  const { data } = await response.json();
  const userErrors = data?.productUpdate?.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors.map((error) => error.message).join("; "));
  }
}

// Đồng bộ "From $X" cho mọi product: từ giá product (giá max) lookup ra giá min
// theo catalog rồi ghi metafield goodfolk.price_from. Giá không khớp mức nào → bỏ qua
// (theme fallback về product.price_min).
export async function syncPriceFromMetafields(admin) {
  const catalog = await currentCatalog();
  if (!catalog) throw new Error("Chưa có catalog — publish option.json trước.");

  const lookup = buildPriceFromMap(catalog);
  if (!lookup.size) throw new Error("Catalog không có garment hợp lệ.");

  const products = await fetchAllProducts(admin);

  const plan = [];
  const skipped = [];
  for (const product of products) {
    // Chỉ sync product 1 variant (chế độ discount); product có variant thật dùng
    // giá native, theme không hiển thị "From" cho chúng.
    if ((product.variantsCount?.count ?? 1) > 1) {
      skipped.push({ id: product.id, reason: "product có nhiều variant (giá native)" });
      continue;
    }
    const priceCents = Math.round(Number(product.priceRange?.minVariantPrice?.amount) * 100);
    const fromCents = fromPriceForPrice(lookup, priceCents);
    if (fromCents === null) {
      skipped.push({ id: product.id, reason: `giá ${(priceCents / 100).toFixed(2)} không khớp mức nào` });
      continue;
    }
    plan.push({ id: product.id, from: fromCents / 100 });
  }

  const failed = [];
  const CHUNK = 20;
  for (let index = 0; index < plan.length; index += CHUNK) {
    const chunk = plan.slice(index, index + CHUNK);
    await Promise.all(
      chunk.map(async ({ id, from }) => {
        try {
          await writeMetafield(admin, id, from);
        } catch (error) {
          failed.push({ id, reason: error.message });
        }
      }),
    );
  }

  return {
    scanned: products.length,
    synced: plan.length - failed.length,
    skipped: skipped.map((entry) => entry.reason),
    failed,
  };
}