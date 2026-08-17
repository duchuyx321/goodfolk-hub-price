import { useState } from "react";
import { useActionData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listTemplates,
  listEligibleProducts,
  applyTemplate,
  shopCurrency,
} from "../services/variant-template.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const templateId = url.searchParams.get("templateId") || "";

  const [templates, { products, total }, currency] = await Promise.all([
    listTemplates(),
    listEligibleProducts(admin, { query: q }),
    shopCurrency(admin),
  ]);

  return { templates, products, total, q, templateId, currency };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const templateId = String(form.get("templateId") || "");
  const productIds = form.getAll("productIds").map(String).filter(Boolean);

  if (!templateId) return { ok: false, error: "Hãy chọn một template." };
  if (!productIds.length) return { ok: false, error: "Hãy chọn ít nhất một sản phẩm." };

  try {
    const result = await applyTemplate(admin, templateId, productIds);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

function ApplyResult({ result }) {
  if (!result) return null;
  const { applied, skipped, failed } = result;

  return (
    <s-stack gap="small">
      {applied.length > 0 && (
        <s-banner tone="success">
          Đã áp dụng cho {applied.length} sản phẩm:{" "}
          {applied.map((p) => `${p.title} (${p.variantCount} variant)`).join("; ")}
        </s-banner>
      )}
      {skipped.length > 0 && (
        <s-banner tone="info">
          Bỏ qua {skipped.length} sản phẩm đã có variant: {skipped.map((p) => p.title).join(", ")}
        </s-banner>
      )}
      {failed.length > 0 && (
        <s-banner tone="critical">
          Thất bại {failed.length} sản phẩm:{" "}
          {failed.map((p) => `${p.title} — ${p.error}`).join("; ")}
        </s-banner>
      )}
    </s-stack>
  );
}

export default function ApplyTemplatePage({ loaderData }) {
  const actionResult = useActionData();
  const { templates, products, total, q, templateId, currency } = loaderData;

  const [selectedTemplateId, setSelectedTemplateId] = useState(
    templateId || (templates.length ? templates[0].id : ""),
  );

  return (
    <s-page heading="Áp dụng variant template">
      <s-section heading="1. Chọn template">
        {templates.length === 0 ? (
          <s-paragraph>
            Chưa có template nào.{" "}
            <s-link href="/app/templates">Tạo template trước</s-link> rồi quay lại trang này.
          </s-paragraph>
        ) : (
          <s-select
            label="Template"
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.currentTarget.value)}
          >
            {templates.map((template) => (
              <s-option key={template.id} value={template.id}>
                {template.name}
              </s-option>
            ))}
          </s-select>
        )}
      </s-section>

      <s-section heading="2. Chọn sản phẩm chưa có variant">
        <s-paragraph>
          Danh sách chỉ hiển thị các sản phẩm chưa có variant/option. Sản phẩm đã có variant sẽ tự động
          được bỏ qua.
        </s-paragraph>

        <Form method="get">
          <s-stack direction="horizontal" gap="small">
            <s-text-field label="Tìm sản phẩm" name="q" defaultValue={q} placeholder="Nhập tên sản phẩm" />
            <s-button type="submit" variant="primary">
              Tìm
            </s-button>
          </s-stack>
        </Form>

        <Form method="post">
          {!selectedTemplateId ? null : <input type="hidden" name="templateId" value={selectedTemplateId} />}
          {products.length === 0 ? (
            <s-paragraph>
              {q ? "Không tìm thấy sản phẩm chưa có variant nào." : "Chưa có sản phẩm chưa có variant nào."}
            </s-paragraph>
          ) : (
            <s-stack gap="small">
              {products.map((product) => (
                <s-checkbox
                  key={product.id}
                  name="productIds"
                  value={product.id}
                  label={product.title}
                  details={`${product.basePrice ? `${Number(product.basePrice).toLocaleString()} ${currency}` : "Chưa có giá"} · SKU: ${product.baseSku || "—"}`}
                />
              ))}
              <s-text>
                Hiển thị {products.length} trong tổng {total} sản phẩm tìm được (giới hạn 50).
              </s-text>
              <s-button type="submit" variant="primary">
                Áp dụng template cho sản phẩm đã chọn
              </s-button>
            </s-stack>
          )}
        </Form>
      </s-section>

      {actionResult?.ok && <ApplyResult result={actionResult.result} />}
      {actionResult?.error && <s-banner tone="critical">{actionResult.error}</s-banner>}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
