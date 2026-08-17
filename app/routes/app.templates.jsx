import { useState } from "react";
import { useActionData, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listTemplates,
  createTemplate,
  deleteTemplate,
  shopCurrency,
} from "../services/variant-template.server";

const DEFAULT_SKU_PATTERN = "{sku}-{option1}-{option2}";

const emptyOption = () => ({
  name: "",
  values: [{ value: "", skuKey: "", priceDelta: "" }],
});

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const [templates, currency] = await Promise.all([
    listTemplates(),
    shopCurrency(admin),
  ]);
  return { templates, currency };
};

function parseTemplateForm(form) {
  const options = [];
  for (let i = 0; form.has(`optionName_${i}`); i++) {
    const values = [];
    for (let j = 0; form.has(`value_${i}_${j}`); j++) {
      values.push({
        value: form.get(`value_${i}_${j}`),
        skuKey: form.get(`skuKey_${i}_${j}`) || "",
        priceDelta: form.get(`priceDelta_${i}_${j}`) || 0,
      });
    }
    options.push({ name: form.get(`optionName_${i}`), values });
  }
  return {
    name: form.get("templateName"),
    skuPattern: form.get("templateSkuPattern"),
    options,
  };
}

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  try {
    if (intent === "create") {
      await createTemplate(parseTemplateForm(form));
      return { ok: true, message: "Đã lưu template mới." };
    }
    if (intent === "delete") {
      await deleteTemplate(String(form.get("id") || ""));
      return { ok: true, message: "Đã xoá template." };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "Yêu cầu không hợp lệ." };
};

function TemplateForm({ currency }) {
  const [name, setName] = useState("");
  const [skuPattern, setSkuPattern] = useState(DEFAULT_SKU_PATTERN);
  const [options, setOptions] = useState([emptyOption()]);

  const updateOption = (index, patch) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  const updateValue = (optionIndex, valueIndex, patch) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === optionIndex
          ? {
              ...o,
              values: o.values.map((v, j) => (j === valueIndex ? { ...v, ...patch } : v)),
            }
          : o,
      ),
    );

  const addOption = () => setOptions((prev) => [...prev, emptyOption()]);
  const removeOption = (index) => setOptions((prev) => prev.filter((_, i) => i !== index));

  const addValue = (optionIndex) =>
    setOptions((prev) =>
      prev.map((o, i) => (i === optionIndex ? { ...o, values: [...o.values, { value: "", skuKey: "", priceDelta: "" }] } : o)),
    );

  const removeValue = (optionIndex, valueIndex) =>
    setOptions((prev) =>
      prev.map((o, i) =>
        i === optionIndex ? { ...o, values: o.values.filter((_, j) => j !== valueIndex) } : o,
      ),
    );

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="create" />
      <s-stack gap="base">
        <s-text-field
          label="Tên template"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="VD: Áo thun cơ bản (Size + Màu)"
          required
        />
        <s-text-field
          label="SKU pattern"
          value={skuPattern}
          onInput={(e) => setSkuPattern(e.currentTarget.value)}
          details="{sku} = SKU gốc của sản phẩm · {option1}, {option2} = mã SKU giá trị option theo thứ tự · cũng có thể dùng tên option: {size}, {color}"
        />

        {options.map((option, i) => (
          <s-box key={i} padding="400">
            <s-stack gap="base">
              <s-text-field
                label={`Option ${i + 1}`}
                value={option.name}
                onInput={(e) => updateOption(i, { name: e.currentTarget.value })}
                placeholder="VD: Size, Color, Chất liệu…"
              />
              {option.values.map((value, j) => (
                <s-stack key={j} gap="small" direction="horizontal" wrap>
                  <s-text-field
                    label="Giá trị"
                    value={value.value}
                    onInput={(e) => updateValue(i, j, { value: e.currentTarget.value })}
                    placeholder="VD: XL"
                  />
                  <s-text-field
                    label="Mã SKU (tuỳ chọn)"
                    value={value.skuKey}
                    onInput={(e) => updateValue(i, j, { skuKey: e.currentTarget.value })}
                    placeholder="Tự sinh nếu để trống"
                  />
                  <s-number-field
                    label={`Chênh lệch giá (${currency})`}
                    value={value.priceDelta}
                    onInput={(e) => updateValue(i, j, { priceDelta: e.currentTarget.value })}
                    placeholder="0"
                  />
                  <s-button type="button" onClick={() => removeValue(i, j)} disabled={option.values.length === 1}>
                    Xoá giá trị
                  </s-button>
                </s-stack>
              ))}
              <s-stack direction="horizontal" gap="small">
                <s-button type="button" onClick={() => addValue(i)}>
                  + Thêm giá trị
                </s-button>
                <s-button type="button" onClick={() => removeOption(i)} tone="critical" disabled={options.length === 1}>
                  Xoá option
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        ))}

        <s-button type="button" onClick={addOption} disabled={options.length >= 3}>
          + Thêm option (tối đa 3)
        </s-button>
        <s-button type="submit" variant="primary">
          Lưu template
        </s-button>
      </s-stack>

      {/* Hidden inputs mirror the editor state so the form always submits it reliably */}
      <input type="hidden" name="templateName" value={name} />
      <input type="hidden" name="templateSkuPattern" value={skuPattern} />
      {options.map((option, i) => (
        <span key={i}>
          <input type="hidden" name={`optionName_${i}`} value={option.name} />
          {option.values.map((value, j) => (
            <span key={j}>
              <input type="hidden" name={`value_${i}_${j}`} value={value.value} />
              <input type="hidden" name={`skuKey_${i}_${j}`} value={value.skuKey} />
              <input type="hidden" name={`priceDelta_${i}_${j}`} value={value.priceDelta} />
            </span>
          ))}
        </span>
      ))}
    </Form>
  );
}

export default function TemplatesPage({ loaderData }) {
  const result = useActionData();
  const { templates, currency } = loaderData;

  return (
    <s-page heading="Variant Templates">
      <s-section heading="Tạo template mới">
        <s-paragraph>
          Template lưu một bộ option dùng chung (VD: Size S/M/L/XL + Màu). Sau đó áp template này cho nhiều
          sản phẩm chưa có variant — Shopify sẽ tự tạo toàn bộ variant kèm giá và SKU.
        </s-paragraph>
        <TemplateForm currency={currency} />
      </s-section>

      {result?.ok && <s-banner tone="success">{result.message}</s-banner>}
      {result?.error && <s-banner tone="critical">{result.error}</s-banner>}

      <s-section heading="Template hiện có">
        {templates.length === 0 ? (
          <s-paragraph>Chưa có template nào. Tạo template đầu tiên ở trên.</s-paragraph>
        ) : (
          <s-stack gap="base">
            {templates.map((template) => (
              <s-box key={template.id} padding="400">
                <s-stack gap="small">
                  <s-text variant="headingMd">{template.name}</s-text>
                  <s-text>
                    {template.options
                      .map(
                        (option) =>
                          `${option.name} (${option.values.map((v) => v.value).join(", ")})`,
                      )
                      .join(" × ")}
                  </s-text>
                  <s-text>SKU pattern: {template.skuPattern}</s-text>
                  <s-stack direction="horizontal" gap="small">
                    <s-link href={`/app/templates/apply?templateId=${template.id}`}>Áp dụng cho sản phẩm</s-link>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={template.id} />
                      <s-button type="submit" tone="critical" size="slim">
                        Xoá
                      </s-button>
                    </Form>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
