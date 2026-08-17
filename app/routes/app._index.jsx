import { useActionData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { latestCatalog, publishCatalog, currentCatalog } from "../services/catalog.server";
import { generateTemplatesFromCatalog } from "../services/variant-template.server";
import { syncPriceFromMetafields } from "../services/price-from.server";

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

  if (intent === "generate_templates") {
    try {
      const catalog = await currentCatalog();
      const result = await generateTemplatesFromCatalog(catalog);
      return {
        ok: true,
        templates: {
          created: result.created.length,
          updated: result.updated.length,
          skipped: result.skipped.length,
        },
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  if (intent === "sync_price_from") {
    try {
      const result = await syncPriceFromMetafields(admin);
      return {
        ok: true,
        priceFrom: {
          scanned: result.scanned,
          synced: result.synced,
          skippedCount: result.skipped.length,
          failedCount: result.failed.length,
        },
      };
    } catch (error) {
      return { ok: false, priceFromError: error.message };
    }
  }

  const file = form.get("catalog");

  if (!file || typeof file.text !== "function") {
    return { ok: false, error: "Chọn file option.json trước khi upload." };
  }

  try {
    const result = await publishCatalog(JSON.parse(await file.text()), "manual-upload");
    let priceFrom = null;
    try {
      priceFrom = await syncPriceFromMetafields(admin);
    } catch (syncError) {
      return {
        ok: true,
        entryCount: result.entryCount,
        version: result.version,
        priceFromError: `Catalog đã publish nhưng sync lỗi: ${syncError.message}`,
      };
    }
    return {
      ok: true,
      entryCount: result.entryCount,
      version: result.version,
      priceFrom: {
        scanned: priceFrom.scanned,
        synced: priceFrom.synced,
        skippedCount: priceFrom.skipped.length,
        failedCount: priceFrom.failed.length,
      },
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function CatalogPage({ loaderData }) {
  const result = useActionData();
  const catalog = loaderData.catalog;
  const discount = result?.discount || loaderData.discount;
  const priceFrom = result?.ok && result.priceFrom ? result.priceFrom : null;

  return (
    <s-page heading="Hub Price Catalog">
      {result?.error && (
        <s-banner tone="critical" dismissible>
          {result.error}
        </s-banner>
      )}

      <s-section heading="Tổng quan" padding="none">
        <s-grid gridtemplatecolumns="repeat(auto-fit, minmax(220px, 1fr))" gap="200">
          <s-box padding="400" border="1" bordercolor="subdued" borderradius="300">
            <s-stack direction="block" gap="100">
              <s-icon type="catalog-product" />
              <s-text type="strong">Catalog</s-text>
              {catalog ? (
                <>
                  <s-text>Version {catalog.version}</s-text>
                  <s-text color="subdued">
                    {catalog.entryCount} SKU · {new Date(catalog.createdAt).toLocaleDateString()}
                  </s-text>
                </>
              ) : (
                <s-badge tone="warning">Chưa có catalog</s-badge>
              )}
            </s-stack>
          </s-box>

          <s-box padding="400" border="1" bordercolor="subdued" borderradius="300">
            <s-stack direction="block" gap="100">
              <s-icon type="discount" />
              <s-text type="strong">Discount Hub Price</s-text>
              {discount ? (
                <s-badge tone={discount.status === "ACTIVE" ? "success" : "warning"}>
                  {discount.status}
                </s-badge>
              ) : (
                <s-badge tone="caution">Chưa tạo</s-badge>
              )}
              <s-text color="subdued">Áp giá catalog trên mỗi dòng giỏ hàng</s-text>
            </s-stack>
          </s-box>

          <s-box padding="400" border="1" bordercolor="subdued" borderradius="300">
            <s-stack direction="block" gap="100">
              <s-icon type="price-list" />
              <s-text type="strong">Giá hiển thị (From $X)</s-text>
              {priceFrom ? (
                <s-text>Đã sync {priceFrom.synced} product</s-text>
              ) : (
                <s-badge tone="caution">Chưa sync</s-badge>
              )}
              <s-text color="subdued">Metafield goodfolk.price_from</s-text>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="1 · Nạp catalog">
        <s-paragraph>
          Upload option.json — dữ liệu được validate và publish thành một version mới. Sau khi
          publish, app tự đồng bộ giá hiển thị (From $X).
        </s-paragraph>
        <Form method="post" encType="multipart/form-data">
          <s-stack direction="inline" gap="200" alignitems="end">
            <input name="catalog" type="file" accept=".json,application/json" required />
            <s-button type="submit" variant="primary" icon="upload">
              Validate và publish
            </s-button>
          </s-stack>
        </Form>
        {result?.ok && result.entryCount && (
          <s-banner tone="success">
            Đã publish {result.entryCount} SKU, version {result.version}.
          </s-banner>
        )}
        {result?.priceFromError && <s-banner tone="critical">{result.priceFromError}</s-banner>}
      </s-section>

      <s-section heading="2 · Giá hiển thị (From $X)">
        <s-paragraph>
          Đồng bộ metafield <code>goodfolk.price_from</code> cho mọi product (1 variant): app
          reverse-lookup từ catalog theo giá product (= giá max) ra giá min để theme hiển thị
          &quot;From $X&quot; — không cần gán mã garment vào từng product. Nhóm trùng max: lấy
          min thấp nhất.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="sync_price_from" />
          <s-button type="submit" variant="primary" icon="refresh">
            Đồng bộ giá hiển thị
          </s-button>
        </Form>
        {priceFrom && (
          <s-banner tone="success">
            Đã quét {priceFrom.scanned} product, sync {priceFrom.synced} metafield
            {priceFrom.skippedCount > 0
              ? `, bỏ qua ${priceFrom.skippedCount} (không khớp mức giá hoặc có variant thật)`
              : ""}
            {priceFrom.failedCount > 0 ? `, lỗi ${priceFrom.failedCount}` : ""}.
          </s-banner>
        )}
      </s-section>

      <s-section heading="3 · Discount Hub Price">
        <s-paragraph>
          Discount tự động áp giá catalog (theo SKU trên mỗi dòng giỏ hàng). Cần tạo đúng một lần
          để Shopify Functions chạy.
        </s-paragraph>
        {discount ? (
          <s-banner tone={discount.status === "ACTIVE" ? "success" : "warning"}>
            Discount &quot;{discount.title}&quot; — {discount.status}
          </s-banner>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="create_discount" />
            <s-button type="submit" variant="primary" icon="discount">
              Tạo discount Hub Price
            </s-button>
          </Form>
        )}
        {result?.discountError && <s-banner tone="critical">{result.discountError}</s-banner>}
      </s-section>

      <s-section heading="4 · Variant Templates (bộ option dùng chung)">
        <s-paragraph>
          Tạo một Variant Template cho từng garment trong catalog (Color × Size kèm giá theo
          catalog). Sau đó vào trang Variant Templates để áp template cho từng sản phẩm chưa có
          variant — Shopify tự tạo variant thật với giá đúng, giỏ hàng/checkout chuẩn trên mọi gói.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="generate_templates" />
          <s-button type="submit" variant="primary" icon="variant-list">
            Tạo / cập nhật templates từ catalog
          </s-button>
        </Form>
        {result?.ok && result.templates && (
          <s-banner tone="success">
            Tạo mới {result.templates.created}, cập nhật {result.templates.updated}
            {result.templates.skipped > 0 ? `, bỏ qua ${result.templates.skipped}` : ""}.
          </s-banner>
        )}
      </s-section>

      <s-section heading="Catalog hiện tại">
        {catalog ? (
          <s-stack direction="block" gap="100">
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
