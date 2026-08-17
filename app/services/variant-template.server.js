import prisma from "../db.server";
import { normalizeTemplate, buildCombos } from "./variant-template.logic";

export { normalizeTemplate, DEFAULT_SKU_PATTERN } from "./variant-template.logic";

// ---- CRUD ----

export const listTemplates = () =>
  prisma.variantTemplate.findMany({ orderBy: { createdAt: "desc" } });

export const getTemplate = (id) =>
  prisma.variantTemplate.findUnique({ where: { id } });

export async function createTemplate(input) {
  const template = normalizeTemplate(input);
  return prisma.variantTemplate.create({
    data: {
      name: template.name,
      skuPattern: template.skuPattern,
      options: template.options,
    },
  });
}

export async function deleteTemplate(id) {
  await prisma.variantTemplate.delete({ where: { id } });
}

// ---- Shopify Admin API ----

const PRODUCTS_QUERY = `#graphql
query Products($first: Int!, $query: String) {
  products(first: $first, query: $query, sortKey: TITLE) {
    nodes {
      id
      title
      legacyResourceId
      hasVariants
      options { name }
      variants(first: 1) {
        nodes {
          id
          price
          inventoryItem { sku }
        }
      }
    }
  }
}`;

const PRODUCT_QUERY = `#graphql
query Product($id: ID!) {
  product(id: $id) {
    id
    title
    legacyResourceId
    hasVariants
    options { name }
    variants(first: 1) {
      nodes {
        id
        price
        inventoryItem { sku }
      }
    }
  }
}`;

const CREATE_OPTIONS_MUTATION = `#graphql
mutation CreateOptions($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
  productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
    product { id }
    userErrors { field message }
  }
}`;

const PRODUCT_VARIANTS_QUERY = `#graphql
query ProductVariants($productId: ID!, $first: Int!, $after: String) {
  product(id: $productId) {
    variants(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        selectedOptions { name value }
      }
    }
  }
}`;

const UPDATE_VARIANTS_MUTATION = `#graphql
mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    product { id }
    userErrors { field message }
  }
}`;

const toProductView = (product) => ({
  id: product.id,
  title: product.title,
  legacyResourceId: product.legacyResourceId,
  hasVariants: product.hasVariants,
  options: (product.options || []).map((option) => option.name),
  baseSku: product.variants?.nodes?.[0]?.inventoryItem?.sku || null,
  basePrice: product.variants?.nodes?.[0]?.price || null,
});

const isEligible = (product) => !product.hasVariants && product.options.length === 0;

async function fetchProduct(admin, id) {
  const response = await admin.graphql(PRODUCT_QUERY, { variables: { id } });
  const { data } = await response.json();
  return data?.product ? toProductView(data.product) : null;
}

export async function listEligibleProducts(admin, { query = "", first = 50 } = {}) {
  const variables = { first };
  if (query.trim()) variables.query = `title:*${query.trim()}*`;

  const response = await admin.graphql(PRODUCTS_QUERY, { variables });
  const { data } = await response.json();
  const products = (data?.products?.nodes || []).map(toProductView);
  return {
    products: products.filter(isEligible),
    total: products.length,
  };
}

export async function shopCurrency(admin) {
  const response = await admin.graphql(
    `#graphql
    query { shop { currencyCode } }`,
  );
  const { data } = await response.json();
  return data?.shop?.currencyCode || "";
}

// ---- Applying a template ----

async function createOptions(admin, productId, template) {
  const response = await admin.graphql(CREATE_OPTIONS_MUTATION, {
    variables: {
      productId,
      options: template.options.map((option, index) => ({
        name: option.name,
        position: index + 1,
        values: option.values.map((value) => ({ name: value.value })),
      })),
      variantStrategy: "CREATE",
    },
  });
  const { data, errors } = await response.json();
  const userErrors = data?.productOptionsCreate?.userErrors || [];
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join("; "));
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
}

async function fetchProductVariants(admin, productId) {
  const variants = new Map();
  let after = null;
  for (;;) {
    const response = await admin.graphql(PRODUCT_VARIANTS_QUERY, {
      variables: { productId, first: 250, after },
    });
    const { data } = await response.json();
    const page = data?.product?.variants;
    if (!page) break;

    for (const node of page.nodes || []) {
      const key = JSON.stringify(
        (node.selectedOptions || []).map((o) => [o.name.toLowerCase(), o.value]).sort(),
      );
      variants.set(key, node.id);
    }

    if (!page.pageInfo?.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return variants;
}

async function updateVariants(admin, productId, variants) {
  if (!variants.length) return;
  const response = await admin.graphql(UPDATE_VARIANTS_MUTATION, {
    variables: { productId, variants },
  });
  const { data, errors } = await response.json();
  const userErrors = data?.productVariantsBulkUpdate?.userErrors || [];
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join("; "));
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
}

export async function applyTemplate(admin, templateId, productIds) {
  const template = await getTemplate(templateId);
  if (!template) throw new Error("Không tìm thấy template.");

  const result = { applied: [], skipped: [], failed: [] };

  for (const productId of productIds) {
    try {
      const product = await fetchProduct(admin, productId);
      if (!product) {
        result.failed.push({ productId, title: productId, error: "Không tìm thấy sản phẩm." });
        continue;
      }

      if (!isEligible(product)) {
        result.skipped.push({
          productId,
          title: product.title,
          reason: "Sản phẩm đã có variant/option.",
        });
        continue;
      }

      await createOptions(admin, product.id, template);

      const variantsById = await fetchProductVariants(admin, product.id);
      const updates = buildCombos(template, product)
        .map((combo) => {
          const variantId = variantsById.get(combo.key);
          if (!variantId) return null;
          return {
            id: variantId,
            price: combo.price,
            inventoryItem: { sku: combo.sku },
          };
        })
        .filter(Boolean);

      await updateVariants(admin, product.id, updates);

      result.applied.push({
        productId,
        title: product.title,
        variantCount: updates.length,
      });
    } catch (error) {
      result.failed.push({ productId, title: productId, error: error.message });
    }
  }

  return result;
}
