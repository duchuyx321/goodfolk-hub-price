import { useActionData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { latestCatalog, publishCatalog } from "../services/catalog.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { catalog: await latestCatalog() };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const form = await request.formData();
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

      {result?.ok && (
        <s-banner tone="success">
          Đã publish {result.entryCount} SKU, version {result.version}.
        </s-banner>
      )}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

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
