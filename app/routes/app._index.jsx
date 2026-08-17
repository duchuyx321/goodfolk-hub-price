import { useActionData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { latestCatalog, publishCatalog } from "../services/catalog.server";

const FUNCTION_HANDLE = "hub-price-discount";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let discount = null;
  try {
    const response = await admin.graphql(
      `#graphql
      query {
        automaticDiscountNodes(first: 20) {
          nodes {
            ... on DiscountAutomaticApp {
              title
              status
              appDiscountType {
                functionHandle
              }
            }
          }
        }
      }`,
    );
    const json = await response.json();
    discount =
      json.data?.automaticDiscountNodes?.nodes?.find(
        (node) => node?.appDiscountType?.functionHandle === FUNCTION_HANDLE,
      ) || null;
  } catch {
    // read_discounts may not be granted yet — fall back to showing the create button.
  }

  return { catalog: await latestCatalog(), discount };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create_discount") {
    try {
      const response = await admin.graphql(
        `#graphql
        mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
          discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
            userErrors {
              field
              message
            }
            automaticAppDiscount {
              discountId
              title
              status
            }
          }
        }`,
        {
          variables: {
            automaticAppDiscount: {
              title: "Hub Price",
              functionHandle: FUNCTION_HANDLE,
              discountClasses: ["PRODUCT"],
              startsAt: new Date().toISOString(),
              appliesOnOneTimePurchase: true,
            },
          },
        },
      );
      const json = await response.json();
      const userErrors = json.data?.discountAutomaticAppCreate?.userErrors;
      if (userErrors?.length) {
        return {
          ok: false,
          discountError: userErrors.map((error) => error.message).join("; "),
        };
      }
      const created = json.data?.discountAutomaticAppCreate?.automaticAppDiscount;
      return {
        ok: true,
        discount: {
          title: created?.title || "Hub Price",
          status: created?.status || "ACTIVE",
        },
      };
    } catch (error) {
      return { ok: false, discountError: error.message };
    }
  }

  const file = form.get("catalog");

  if (!file || typeof file.text !== "function") {
    return { ok: false, error: "Chọn file option.json trước khi upload." };
  }

  try {
    const result = await publishCatalog(JSON.parse(await file.text()), "manual-upload");
    return { ok: true, entryCount: result.entryCount, version: result.version };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function CatalogPage({ loaderData }) {
  const result = useActionData();
  const catalog = loaderData.catalog;
  const discount = result?.discount || loaderData.discount;

  return (
    <s-page heading="Hub Price Catalog">
      <s-section heading="Nạp catalog thủ công">
        <s-paragraph>
          Upload option.json. Dữ liệu được validate và publish thành một version mới.
        </s-paragraph>
        <Form method="post" encType="multipart/form-data">
          <s-stack gap="base">
            <input name="catalog" type="file" accept=".json,application/json" required />
            <s-button type="submit" variant="primary">Validate và publish</s-button>
          </s-stack>
        </Form>
      </s-section>

      {result?.ok && !result.discount && (
        <s-banner tone="success">
          Đã publish {result.entryCount} SKU, version {result.version}.
        </s-banner>
      )}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

      <s-section heading="Discount Hub Price">
        <s-paragraph>
          Discount tự động áp giá catalog (theo SKU trên mỗi dòng giỏ hàng). Cần tạo đúng một lần để
          Shopify Functions chạy.
        </s-paragraph>
        {discount ? (
          <s-banner tone={discount.status === "ACTIVE" ? "success" : "warning"}>
            Discount "{discount.title}" — {discount.status}
          </s-banner>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="create_discount" />
            <s-button type="submit" variant="primary">Tạo discount Hub Price</s-button>
          </Form>
        )}
        {result?.discountError && <s-banner tone="critical">{result.discountError}</s-banner>}
      </s-section>

      <s-section heading="Catalog hiện tại">
        {catalog ? (
          <s-stack gap="small">
            <s-text>Version: {catalog.version}</s-text>
            <s-text>SKU: {catalog.entryCount}</s-text>
            <s-text>Nguồn: {catalog.source}</s-text>
            <s-text>Cập nhật: {new Date(catalog.createdAt).toLocaleString()}</s-text>
          </s-stack>
        ) : (
          <s-paragraph>Chưa có catalog.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
