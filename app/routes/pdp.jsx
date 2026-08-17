import { useMemo, useRef, useState } from "react";
import { useLoaderData } from "react-router";
import { currentCatalog } from "../services/catalog.server";

// Public page: no auth. The standalone product picker (like sku_option_dev/shopify_demo2.html)
// rendered with real catalog data. Products are NOT created with variants — the chosen
// combination is sent to the cart as line properties (with `_sku`), and the
// hub-price-discount function adjusts the price to the catalog price.

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const catalog = await currentCatalog();

  const rawVariant =
    url.searchParams.get("variant") ||
    // eslint-disable-next-line no-undef
    process.env.PDP_CART_VARIANT_ID ||
    "";
  // Accept either the numeric variant id or a gid://shopify/ProductVariant/… handle.
  const variantId = rawVariant
    .replace(/^gid:\/\/shopify\/ProductVariant\//, "")
    .split("/")[0]
    .split("?")[0];

  const config = {
    // eslint-disable-next-line no-undef
    shop: url.searchParams.get("shop") || process.env.PDP_SHOP_DOMAIN || "",
    variantId,
  };

  return {
    catalog,
    config,
    // Expose non-secret env flags to the client safely via the data above only.
  };
};

const money = (n) => `$${Number(n).toFixed(2)}`;

function buildSku(catalog, garment, color, size) {
  const pattern = catalog?.skuPattern || "{garment}-{color}-{size}";
  // `size` is the size VALUE (a string) — look up the size object for its skuKey.
  const sizeObj = garment.sizes.find((s) => s.value === size);
  return pattern
    .replaceAll("{garment}", garment.value)
    .replaceAll("{color}", color.skuKey)
    .replaceAll("{size}", sizeObj?.skuKey || size);
}

export default function PdpPage() {
  const { catalog, config } = useLoaderData();
  const garments = catalog?.garments || [];

  const [garmentIdx, setGarmentIdx] = useState(0);
  const garment = garments[garmentIdx];
  const [color, setColor] = useState(garment?.colors?.[0] || null);
  const [size, setSize] = useState(null);
  const [adding, setAdding] = useState(false);
  const formRef = useRef(null);

  const price = useMemo(() => {
    if (!garment) return null;
    if (!size) return garment.basePrice;
    return garment.sizes.find((s) => s.value === size)?.price ?? garment.basePrice;
  }, [garment, size]);

  const sku = useMemo(() => {
    if (!garment || !color || !size) return null;
    return buildSku(catalog, garment, color, size);
  }, [catalog, garment, color, size]);

  const sizeInfo = size ? garment?.sizes.find((s) => s.value === size) : null;

  if (!catalog || !garments.length) {
    return (
      <main style={{ maxWidth: 640, margin: "60px auto", padding: "0 20px", fontFamily: "Inter, sans-serif" }}>
        <h1>Chưa có catalog</h1>
        <p>
          Catalog chưa được publish. Vào app &gt; <b>Hub Price Catalog</b> và upload option.json
          trước.
        </p>
      </main>
    );
  }

  const pickGarment = (i) => {
    setGarmentIdx(i);
    setColor(garments[i]?.colors?.[0] || null);
    setSize(null);
  };

  const pickColor = (c) => {
    setColor(c);
    setSize(null);
  };

  // Trang này chạy trên domain của app (khác domain store) nên không thể fetch
  // tới /cart/add.js (bị CORS chặn). Thay vào đó ta submit một form POST tới
  // /cart/add của store: form navigation không bị CORS giới hạn và store sẽ set
  // cookie giỏ hàng ngay trong lần điều hướng top-level này.
  const addToCart = (e) => {
    e.preventDefault();
    if (!sku || !config.shop || !config.variantId) return;
    setAdding(true);
    formRef.current?.submit();
  };

  const missingConfig = !config.shop || !config.variantId;
  const offSizes = color ? garment.sizes.filter((s) => !color.sizes.includes(s.value)).map((s) => s.value) : [];

  return (
    <main
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "26px 20px 70px",
        fontFamily: "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif",
        color: "#1a1a1a",
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280", border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "9px 13px", marginBottom: 22 }}>
        <b style={{ color: "#1a1a1a" }}>Goodfolk Goods</b> — chọn sản phẩm theo catalog (SKU:{" "}
        <code>{sku || "—"}</code>)
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 36 }} className="pdp-grid">
        <div>
          <img
            src={(color?.image || garment.image)}
            alt={color?.label || garment.label}
            style={{ width: "100%", aspectRatio: "1", objectFit: "contain", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}
          />
          <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
            {garment.colors.map((c) => (
              <button
                key={c.value}
                onClick={() => pickColor(c)}
                title={c.label}
                style={{
                  width: 52,
                  height: 52,
                  objectFit: "contain",
                  background: "#fff",
                  border: c.value === color.value ? "1.5px solid #1a1a1a" : "1.5px solid #e5e7eb",
                  borderRadius: 7,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <img src={c.image || c.hex} alt={c.label} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 6 }} />
              </button>
            ))}
          </div>
        </div>

        <div>
          <h1 style={{ fontSize: 24, margin: "0 0 6px", letterSpacing: "-.02em" }}>{garment.label}</h1>
          <div style={{ fontSize: 29, fontWeight: 650, margin: "14px 0 3px" }}>{money(price)}</div>
          {sizeInfo?.priceDiff > 0 && (
            <div style={{ color: "#6b7280", fontSize: 13 }}>đã gồm phụ thu size {size}: +{money(sizeInfo.priceDiff)}</div>
          )}

          <fieldset style={{ border: 0, margin: "24px 0 0", padding: 0 }}>
            <legend style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: "#6b7280", marginBottom: 10 }}>
              Style — <span style={{ color: "#1a1a1a", textTransform: "none", fontWeight: 500 }}>{garment.value}</span>
            </legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(74px,1fr))", gap: 9 }}>
              {garments.map((g, i) => (
                <button
                  key={g.value}
                  onClick={() => pickGarment(i)}
                  title={`${g.label} (${g.value})`}
                  style={{
                    position: "relative",
                    border: g.value === garment.value ? "1.5px solid #1a1a1a" : "1.5px solid #e5e7eb",
                    borderRadius: 10,
                    background: "#fff",
                    cursor: "pointer",
                    aspectRatio: "1",
                    padding: 0,
                  }}
                >
                  <img src={g.image} alt={g.label} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 9 }} />
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, margin: "24px 0 0", padding: 0 }}>
            <legend style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: "#6b7280", marginBottom: 10 }}>
              Color — <span style={{ color: "#1a1a1a", textTransform: "none", fontWeight: 500 }}>{color?.label}</span>
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {garment.colors.map((c) => (
                <button
                  key={c.value}
                  onClick={() => pickColor(c)}
                  title={c.label}
                  aria-label={c.label}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    cursor: "pointer",
                    border: c.value === color.value ? "2px solid #1a1a1a" : "2px solid #e5e7eb",
                    background: c.hex || "#ccc",
                  }}
                />
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, margin: "24px 0 0", padding: 0 }}>
            <legend style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: "#6b7280", marginBottom: 10 }}>
              Size — <span style={{ color: "#1a1a1a", textTransform: "none", fontWeight: 500 }}>{size || "chọn"}</span>
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {garment.sizes.map((s) => {
                const ok = color.sizes.includes(s.value);
                return (
                  <button
                    key={s.value}
                    disabled={!ok}
                    onClick={() => setSize(s.value)}
                    style={{
                      minWidth: 52,
                      padding: "11px 14px",
                      border: s.value === size ? "1px solid #1a1a1a" : "1px solid #e5e7eb",
                      background: s.value === size ? "#1a1a1a" : "#fff",
                      color: s.value === size ? "#fff" : "#1a1a1a",
                      borderRadius: 9,
                      cursor: ok ? "pointer" : "not-allowed",
                      fontSize: 14,
                      opacity: ok ? 1 : 0.55,
                      textDecoration: ok ? "none" : "line-through",
                    }}
                  >
                    {s.value}
                  </button>
                );
              })}
            </div>
            {offSizes.length > 0 && (
              <div style={{ color: "#b45309", fontSize: 12.5, marginTop: 9 }}>
                Màu {color.label} không có size: {offSizes.join(", ")}
              </div>
            )}
          </fieldset>

          <button
            onClick={addToCart}
            disabled={!sku || adding || missingConfig}
            style={{
              width: "100%",
              marginTop: 26,
              padding: 15,
              border: 0,
              borderRadius: 10,
              background: "#1a1a1a",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: sku && !missingConfig ? "pointer" : "not-allowed",
              opacity: sku && !missingConfig ? 1 : 0.4,
            }}
          >
            {missingConfig
              ? "Chưa cấu hình giỏ hàng"
              : adding
                ? "Đang chuyển đến giỏ hàng…"
                : `Add to cart — ${money(price)}`}
          </button>

          {missingConfig && (
            <div style={{ marginTop: 16, padding: "13px 15px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 13, color: "#6b7280" }}>
              Để bật nút Add to cart, cấu hình shop và variant gốc: thêm <code>?shop=SHOP.myshopify.com&amp;variant=VARIANT_ID</code>{" "}
              vào URL, hoặc set env <code>PDP_SHOP_DOMAIN</code> và <code>PDP_CART_VARIANT_ID</code>.
            </div>
          )}

          {!missingConfig && (
            <div style={{ marginTop: 16, padding: "13px 15px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 13, color: "#6b7280" }}>
              Khi bấm <b>Add to cart</b>, bạn được chuyển sang trang giỏ hàng của store{" "}
              (<code>{config.shop}/cart</code>) với SKU <code>{sku || "—"}</code> — giá được tính theo catalog bởi
              discount function.
            </div>
          )}

          <div style={{ marginTop: 16, padding: "13px 15px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span style={{ color: "#6b7280" }}>Style</span>
              <b>{garment.value}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span style={{ color: "#6b7280" }}>Color</span>
              <b>{color.label}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span style={{ color: "#6b7280" }}>Size</span>
              <b>{size || "—"}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span style={{ color: "#6b7280" }}>SKU</span>
              <b>
                <code>{sku || "—"}</code>
              </b>
            </div>
          </div>

          {!missingConfig && sku && (
            <form
              ref={formRef}
              method="post"
              action={`https://${config.shop}/cart/add`}
              style={{ display: "none" }}
              aria-hidden="true"
            >
              <input type="hidden" name="id" value={config.variantId} />
              <input type="hidden" name="quantity" value="1" />
              <input type="hidden" name="properties[_sku]" value={sku} />
              <input type="hidden" name="properties[_garment]" value={garment.value} />
              <input type="hidden" name="properties[Style]" value={garment.label} />
              <input type="hidden" name="properties[Color]" value={color.label} />
              <input type="hidden" name="properties[Size]" value={size} />
              <input type="hidden" name="properties[_price]" value={price} />
            </form>
          )}

          <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "#6b7280", margin: "30px 0 8px" }}>
            Payload gửi lên Shopify khi Add to cart
          </h3>
          <pre
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 13,
              overflowX: "auto",
              fontSize: 12,
              margin: 0,
            }}
          >
            {sku
              ? JSON.stringify(
                  {
                    items: [
                      {
                        quantity: 1,
                        properties: {
                          _sku: sku,
                          _garment: garment.value,
                          Style: garment.label,
                          Color: color.label,
                          Size: size,
                          _price: price,
                        },
                      },
                    ],
                  },
                  null,
                  2,
                )
              : "— chọn đủ Style + Color + Size —"}
          </pre>
        </div>
      </div>

      <style>{`@media(max-width:800px){.pdp-grid{grid-template-columns:1fr!important;gap:24px!important}}`}</style>
    </main>
  );
}
