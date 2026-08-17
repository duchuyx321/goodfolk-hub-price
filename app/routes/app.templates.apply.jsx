import { useState } from "react";
import { useActionData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listTemplates,
  listEligibleProducts,
  applyGarments,
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
  const templateIds = form.getAll("templateIds").map(String).filter(Boolean);
  const productIds = form.getAll("productIds").map(String).filter(Boolean);

  if (!templateIds.length) return { ok: false, error: "Hãy chọn ít nhất một template." };
  if (!productIds.length) return { ok: false, error: "Hãy chọn ít nhất một sản phẩm." };

  const applied = [];
  const failed = [];
  for (const productId of productIds) {
    try {
      const result = await applyGarments(admin, templateIds, productId);
      applied.push({
        productId,
        title: productId,
        garments: result.garments,
        variantCount: result.variantCount,
      });
    } catch (error) {
      failed.push({ productId, title: productId, error: error.message });
    }
  }
  return { ok: true, result: { applied, skipped: [], failed } };
};

function ApplyResult({ result }) {
  if (!result) return null;
  const { applied, skipped, failed } = result;

  return (
    <s-stack gap="small">
      {applied.length > 0 && (
        <s-banner tone="success">
          Đã áp dụng cho {applied.length} sản phẩm:{" "}
          {applied.map((p) => `${p.title} (${p.garments.join(" + ")} — ${p.variantCount} variant)`).join("; ")}
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

  const [selectedTemplateIds, setSelectedTemplateIds] = useState(
    templateId ? [templateId] : [],
  );

  const toggleTemplate = (id) =>
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <s-page heading="Áp dụng variant template">
      <s-section heading="1. Chọn garment (Style) cho sản phẩm">
        <s-paragraph>
          Chọn một hoặc nhiều template (garment). Mỗi sản phẩm sẽ có picker
          <b> Style → Color → Size</b> với variant thật theo giá catalog. Lưu ý Shopify giới hạn{" "}
          <b>2048 variant/sản phẩm</b> — nên chọn ~2–4 garment để không vượt.
        </s-paragraph>
        {templates.length === 0 ? (
          <s-paragraph>
            Chưa có template nào.{" "}
            <s-link href="/app/templates">Tạo template trước</s-link> rồi quay lại trang này.
          </s-paragraph>
        ) : (
          <s-stack gap="small">
            {templates.map((template) => (
              <s-checkbox
                key={template.id}
                name="templateIds"
                value={template.id}
                label={template.name}
                checked={selectedTemplateIds.includes(template.id)}
                onChange={() => toggleTemplate(template.id)}
              />
            ))}
            <s-text>
              Đã chọn: {selectedTemplateIds.length} garment.
            </s-text>
          </s-stack>
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
          {selectedTemplateIds.map((id) => (
            <input key={id} type="hidden" name="templateIds" value={id} />
          ))}
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
