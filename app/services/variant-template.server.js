import prisma from "../db.server";
import { normalizeTemplate, buildCombos } from "./variant-template.logic";
import { currentCatalog } from "./catalog.server";

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
      basePrice: template.basePrice,
      garment: template.garment,
    },
  });
}

// Tạo/cập nhật một Variant Template cho từng garment trong catalog.
// Mỗi template = 1 bộ option dùng chung (Color × Size) kèm giá theo catalog:
//   giá variant = basePrice + Σ priceDelta = đúng giá size trong catalog.
export async function generateTemplatesFromCatalog(catalog) {
  const garments = catalog?.garments || [];
  if (!garments.length) throw new Error("Catalog không có garment nào.");

  const existing = await listTemplates();
  const byName = new Map(existing.map((template) => [template.name, template]));
  const result = { created: [], updated: [], skipped: [] };

  for (const garment of garments) {
    const basePrice = Math.round(Number(garment.basePrice) * 100) / 100;
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      result.skipped.push({ garment: garment.value, reason: "thiếu basePrice hợp lệ" });
      continue;
    }

    const input = {
      name: `${garment.label} (${garment.value})`,
      skuPattern: "{sku}-{option1}-{option2}",
      basePrice,
      garment: garment.value,
      options: [
        {
          name: "Color",
          values: (garment.colors || []).map((color) => ({
            value: color.label,
            skuKey: color.skuKey,
            priceDelta: 0,
          })),
        },
        {
          name: "Size",
          values: (garment.sizes || []).map((size) => ({
            value: size.value,
            skuKey: size.skuKey,
            priceDelta: Math.round((Number(size.price) - basePrice) * 100) / 100,
          })),
        },
      ],
    };

    try {
      const template = normalizeTemplate(input);
      const current = byName.get(template.name);
      if (current) {
        await prisma.variantTemplate.update({
          where: { id: current.id },      data: {
        name: template.name,
        skuPattern: template.skuPattern,
        options: template.options,
        basePrice: template.basePrice,
        garment: template.garment,
      },
    });
    result.updated.push({ garment: garment.value, templateId: current.id });
      } else {
        const created = await prisma.variantTemplate.create({
          data: {
            name: template.name,
            skuPattern: template.skuPattern,
            options: template.options,
            basePrice: template.basePrice,
            garment: template.garment,
          },
        });
        result.created.push({ garment: garment.value, templateId: created.id });
      }
    } catch (error) {
      result.skipped.push({ garment: garment.value, reason: error.message });
    }
  }

  return result;
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

const CREATE_VARIANTS_MUTATION = `#graphql
mutation CreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

const toProductView = (product) => ({
  id: product.id,
  title: product.title,
  legacyResourceId: product.legacyResourceId,
  // Option "Title" mặc định của Shopify không tính — sản phẩm chỉ có Title
  // nghĩa là chưa có variant/option thật.
  options: (product.options || [])
    .map((option) => option.name)
    .filter((name) => name !== "Title"),
  baseSku: product.variants?.nodes?.[0]?.inventoryItem?.sku || null,
  basePrice: product.variants?.nodes?.[0]?.price || null,
});

const isEligible = (product) =>
  (product.options || []).filter((option) => option.name !== "Title").length === 0;

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

async function createOptions(admin, productId, template, variantStrategy = "CREATE") {
  const response = await admin.graphql(CREATE_OPTIONS_MUTATION, {
    variables: {
      productId,
      options: template.options.map((option, index) => ({
        name: option.name,
        position: index + 1,
        values: option.values.map((value) => ({ name: value.value })),
      })),
      variantStrategy,
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

async function createVariants(admin, productId, variants) {
  if (!variants.length) return;
  const response = await admin.graphql(CREATE_VARIANTS_MUTATION, {
    variables: { productId, variants },
  });
  const { data, errors } = await response.json();
  const userErrors = data?.productVariantsBulkCreate?.userErrors || [];
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join("; "));
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
}

// ---- Multi-garment: gom nhiều garment vào 1 sản phẩm (Style × Color × Size) ----

const PRODUCT_OPTIONS_QUERY = `#graphql
query ProductOptions($productId: ID!) {
  product(id: $productId) {
    options { id name }
  }
}`;

const DELETE_OPTIONS_MUTATION = `#graphql
mutation DeleteOptions($productId: ID!, $options: [ID!]!) {
  productOptionsDelete(productId: $productId, options: $options, strategy: POSITION) {
    deletedOptionsIds
    userErrors { field message }
  }
}`;

const DELETE_VARIANTS_MUTATION = `#graphql
mutation DeleteVariants($productId: ID!, $variantsIds: [ID!]!) {
  productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
    product { id }
    userErrors { field message }
  }
}`;

async function productOptions(admin, productId) {
  const response = await admin.graphql(PRODUCT_OPTIONS_QUERY, { variables: { productId } });
  const { data } = await response.json();
  return data?.product?.options || [];
}

async function deleteOptions(admin, productId, optionIds) {
  if (!optionIds.length) return;
  const response = await admin.graphql(DELETE_OPTIONS_MUTATION, {
    variables: { productId, options: optionIds },
  });
  const { data, errors } = await response.json();
  const userErrors = data?.productOptionsDelete?.userErrors || [];
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join("; "));
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
}

async function deleteVariants(admin, productId, variantIds) {
  if (!variantIds.length) return;
  const response = await admin.graphql(DELETE_VARIANTS_MUTATION, {
    variables: { productId, variantsIds: variantIds },
  });
  const { data, errors } = await response.json();
  const userErrors = data?.productVariantsBulkDelete?.userErrors || [];
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join("; "));
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
}

// Gom các garment (qua template) vào một sản phẩm: tạo 3 option
// Style × Color × Size, tạo variant, xoá variant không hợp lệ, set giá + SKU
// đúng theo catalog. Giới hạn cartesian (|Style|×|Color|×|Size|) ≤ 2048.
export async function applyGarments(admin, templateIds, productId) {
  const templates = [];
  for (const id of templateIds) {
    const template = await getTemplate(id);
    if (template) templates.push(template);
  }
  if (!templates.length) throw new Error("Không tìm thấy template nào.");
  const garmentCodes = templates
    .map((t) => t.garment)
    .filter(Boolean);
  if (garmentCodes.length !== templates.length) {
    throw new Error("Mọi template cần có mã garment (sinh lại từ catalog).");
  }

  const catalog = await currentCatalog();
  const garments = (catalog?.garments || []).filter((g) =>
    garmentCodes.includes(g.value),
  );
  if (garments.length !== garmentCodes.length) {
    throw new Error("Một số garment không có trong catalog.");
  }

  // Kế hoạch variant: mọi tổ hợp (style, color, size) hợp lệ theo catalog.
  const colorLabels = new Set();
  const sizeValues = new Set();
  const valid = []; // { style, colorLabel, size, price, sku, colorSku, sizeSku }
  for (const g of garments) {
    for (const color of g.colors || []) {
      colorLabels.add(color.label);
      for (const size of g.sizes || []) {
        if (!color.sizes?.includes(size.value)) continue;
        valid.push({
          style: g.value,
          color: color.label,
          size: size.value,
          price: size.price,
          sku: `${g.value}-${color.skuKey}-${size.skuKey}`,
        });
      }
    }
    for (const size of g.sizes || []) sizeValues.add(size.value);
  }

  const cartesian = garments.length * colorLabels.size * sizeValues.size;
  if (cartesian > 2048) {
    throw new Error(
      `Bộ garment này tạo ${valid.length} variant hợp lệ nhưng Shopify cần ${cartesian} slot (|Style|×|Màu|×|Size|) — vượt giới hạn 2048. Chọn ít garment hơn.`,
    );
  }

  // Reset option cũ (nếu có).
  const options = await productOptions(admin, productId);
  const staleOptionIds = (options || [])
    .filter((o) => o.name !== "Title")
    .map((o) => o.id);
  if (staleOptionIds.length) await deleteOptions(admin, productId, staleOptionIds);

  // Tạo options (không auto-generate variant — tránh lỗi khi cartesian lớn).
  await createOptions(admin, productId, [
    {
      name: "Style",
      values: garments.map((g) => ({ name: g.value })),
    },
    {
      name: "Color",
      values: [...colorLabels].map((label) => ({ name: label })),
    },
    {
      name: "Size",
      values: [...sizeValues].map((value) => ({ name: value })),
    },
  ], null);

  // Tạo variant hợp lệ theo từng lô (chỉ tổ hợp tồn tại trong catalog).
  const CHUNK = 100;
  let createdCount = 0;
  for (let index = 0; index < valid.length; index += CHUNK) {
    const chunk = valid.slice(index, index + CHUNK).map((combo) => ({
      optionValues: [
        { optionName: "Style", name: combo.style },
        { optionName: "Color", name: combo.color },
        { optionName: "Size", name: combo.size },
      ],
      price: String(combo.price),
      inventoryItem: { sku: combo.sku },
    }));
    await createVariants(admin, productId, chunk);
    createdCount += chunk.length;
  }

  // Variant gốc (không option): giá = basePrice garment đầu tiên.
  const variantsById = await fetchProductVariants(admin, productId);
  const optionlessVariantId = variantsById.get("[]");
  if (optionlessVariantId && garments[0]?.basePrice != null) {
    await updateVariants(admin, productId, [
      { id: optionlessVariantId, price: String(garments[0].basePrice) },
    ]);
  }

  return {
    garments: garments.map((g) => g.value),
    variantCount: createdCount,
  };
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
      // Giá gốc lấy từ template (basePrice garment) để variant khớp đúng giá catalog.
      const basePrice = template.basePrice ?? product.basePrice;
      // SKU gốc lấy từ template (mã garment) để variant SKU = "G5000B-COLOR-SIZE".
      const baseSku = template.garment || product.baseSku;
      const updates = buildCombos(template, { ...product, baseSku, basePrice })
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

      // Variant gốc (không có option) cũng được đặt đúng giá gốc + SKU garment.
      const optionlessVariantId = variantsById.get("[]");
      if (optionlessVariantId) {
        const update = { id: optionlessVariantId };
        if (basePrice != null) update.price = String(basePrice);
        if (template.garment) update.inventoryItem = { sku: template.garment };
        updates.push(update);
      }

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
