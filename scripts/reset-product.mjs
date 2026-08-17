import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const session = await prisma.session.findFirst({ orderBy: { id: "desc" } });
if (!session) throw new Error("No session");

const gql = async (query, variables) => {
  const response = await fetch(
    `https://${session.shop}/admin/api/2026-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  return response.json();
};

const productQuery = process.argv[2] || "F Bomb Kinda Mom Trucker Hat";
const list = await gql(
  `#graphql
  query Products($query: String!) {
    products(first: 10, query: $query) { nodes { id title } }
  }`,
  { query: `title:*${productQuery}*` },
);
const product = list.data?.products?.nodes?.[0];
if (!product) throw new Error(`Không tìm thấy sản phẩm "${productQuery}"`);
console.log("Product:", product.title);

// Xoá toàn bộ option (kèm variant của chúng) — strategy POSITION
const optRes = await gql(
  `#graphql
  query ProductOptions($productId: ID!) { product(id: $productId) { options { id name } } }`,
  { productId: product.id },
);
const staleIds = (optRes.data?.product?.options || [])
  .filter((o) => o.name !== "Title")
  .map((o) => o.id);
console.log("Options to delete:", staleIds.length);

if (staleIds.length) {
  const del = await gql(
    `#graphql
    mutation DeleteOptions($productId: ID!, $options: [ID!]!) {
      productOptionsDelete(productId: $productId, options: $options, strategy: POSITION) {
        deletedOptionsIds
        userErrors { field message }
      }
    }`,
    { productId: product.id, options: staleIds },
  );
  const errs = del.data?.productOptionsDelete?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join("; "));
  if (del.errors?.length) throw new Error(del.errors.map((e) => e.message).join("; "));
  console.log("Deleted options:", del.data.productOptionsDelete.deletedOptionsIds.length);
}

// Set giá variant còn lại = giá MAX của catalog
const variants = await gql(
  `#graphql
  query Variants($productId: ID!) {
    product(id: $productId) { variants(first: 10) { nodes { id price } } }
  }`,
  { productId: product.id },
);
const nodes = variants.data?.product?.variants?.nodes || [];
console.log("Remaining variants:", nodes.length);
if (!nodes.length) throw new Error("Sản phẩm không còn variant nào.");

const upd = await gql(
  `#graphql
  mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product { id }
      userErrors { field message }
    }
  }`,
  {
    productId: product.id,
    variants: nodes.map((v) => ({ id: v.id, price: "47.95" })),
  },
);
const updErrs = upd.data?.productVariantsBulkUpdate?.userErrors || [];
if (updErrs.length) throw new Error(updErrs.map((e) => e.message).join("; "));
console.log("Set price 47.95 (max catalog) cho", nodes.length, "variant");
await prisma.$disconnect();
