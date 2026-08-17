import { currentCatalog } from "./catalog.server";

const METAFIELD_NAMESPACE = "goodfolk";
const METAFIELD_KEY = "price_from";

// ---- Sync metafield goodfolk.price_from cho toàn bộ products ----

const PRODUCTS_QUERY = `#graphql
query Products($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      legacyResourceId
      variantsCount { count }
      variants(first: 1) {
        nodes { price }
      }
    }
  }
}`;

const METAFIELD_SET_MUTATION = `#graphql
mutation MetafieldsSet($metafields: [MetafieldInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}`;

const METAFIELD_DELETE_MUTATION = `#graphql
mutation MetafieldsDelete($ownerId: ID!, $namespace: String!, $key: String!) {
  metafieldsDelete(metafields: [{ ownerId: $ownerId, namespace: $namespace, key: $key }]) {
    deletedMetafields { id }
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
  const setMetafield = async () => {
    const response = await admin.graphql(METAFIELD_SET_MUTATION, {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            // Text type: giá trị metafield là major units (vd "36.95"), còn
            // filter |money chia cho 100 → phải đọc dạng text rồi times: 100
            // trong theme (xem dawn/snippets/product-grid-item.liquid).
            type: "single_line_text_field",
            value: String(value),
          },
        ],
      },
    });
    const { data } = await response.json();
    return data?.metafieldsSet?.userErrors || [];
  };

  const userErrors = await setMetafield();
  if (userErrors.length) {
    // Type cũ (number_decimal) không cho đổi trực tiếp → xoá rồi ghi lại.
    await admin.graphql(METAFIELD_DELETE_MUTATION, {
      variables: {
        ownerId: productId,
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
      },
    });
    const retryErrors = await setMetafield();
    if (retryErrors.length) {
      throw new Error(retryErrors.map((error) => error.message).join("; "));
    }
  }
}

// Đồng bộ "From $X" cho mọi product: product 1 variant (chế độ discount) luôn
// được ghi = giá min toàn catalog (picker cho chọn mọi garment/color/size).
export async function syncPriceFromMetafields(admin) {
  const catalog = await currentCatalog();
  if (!catalog) throw new Error("Chưa có catalog — publish option.json trước.");

  const products = await fetchAllProducts(admin);

  let globalMin = null;
  for (const garment of catalog.garments || []) {
    for (const color of garment.colors || []) {
      for (const size of garment.sizes || []) {
        if (!color.sizes?.includes(size.value)) continue;
        const cents = Math.round(Number(size.price) * 100);
        if (Number.isFinite(cents) && cents > 0 && (globalMin === null || cents < globalMin)) {
          globalMin = cents;
        }
      }
    }
  }
  if (globalMin === null) throw new Error("Catalog không có garment hợp lệ.");

  const plan = [];
  const skipped = [];
  for (const product of products) {
    // Chỉ sync product 1 variant (chế độ discount); product có variant thật dùng
    // giá native, theme không hiển thị "From" cho chúng.
    if ((product.variantsCount?.count ?? 1) > 1) {
      skipped.push({ id: product.id, reason: "product có nhiều variant (giá native)" });
      continue;
    }
    const priceCents = Math.round(Number(product.variants?.nodes?.[0]?.price) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      skipped.push({ id: product.id, reason: "product không có giá hợp lệ" });
      continue;
    }
    // "From" = min toàn catalog, nhưng không cao hơn giá product.
    const fromCents = Math.min(globalMin, priceCents);
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