/* Goodfolk Product Options
 * Renders the shared catalog picker (Style / Color / Size) for products without
 * real variants, then attaches the chosen combination to the cart line as
 * properties (`_sku`, Style, Color, Size) on submit. The hub-price-discount
 * Shopify Function prices the line from the catalog.
 */
(() => {
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn)
      : fn();

  ready(() => {
    const root = document.querySelector("[data-goodfolk-options]");
    if (!root) return;

    const catalogUrl =
      root.dataset.catalogUrl ||
      "https://goodfolk-hub-price.vercel.app/api/catalog";

    const state = { catalog: null, garmentIdx: 0, color: null, size: null };

    const money = (n) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(n) || 0);

    const garment = () => state.catalog?.garments?.[state.garmentIdx] || null;
    const sku = () => {
      const g = garment();
      if (!g || !state.color || !state.size) return null;
      // state.size is the size VALUE (a string) — look up the size object for skuKey.
      const sizeObj = g.sizes.find((s) => s.value === state.size);
      const pattern = state.catalog?.skuPattern || "{garment}-{color}-{size}";
      return pattern
        .replaceAll("{garment}", g.value)
        .replaceAll("{color}", state.color.skuKey)
        .replaceAll("{size}", (sizeObj && sizeObj.skuKey) || state.size);
    };
    const price = () => {
      const g = garment();
      if (!g) return null;
      if (!state.size) return g.basePrice;
      return g.sizes.find((s) => s.value === state.size)?.price ?? g.basePrice;
    };

    function render() {
      const g = garment();
      if (!g) return;
      const colors = g.colors || [];
      const sizes = g.sizes || [];
      const offSizes = state.color
        ? sizes.filter((s) => !state.color.sizes.includes(s.value)).map((s) => s.value)
        : [];

      const sizeInfo = state.size ? sizes.find((s) => s.value === state.size) : null;
      const currentSku = sku();

      root.innerHTML = `
        <div class="goodfolk-options__body">
          <div class="goodfolk-options__price-row">
            <span class="goodfolk-options__price">${money(price())}</span>
            ${
              sizeInfo?.priceDiff > 0
                ? `<span class="goodfolk-options__diff">đã gồm phụ thu size ${state.size}: +${money(sizeInfo.priceDiff)}</span>`
                : ""
            }
          </div>

          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Style — <span>${g.value}</span></legend>
            <div class="goodfolk-options__styles">
              ${state.catalog.garments
                .map(
                  (item, i) => `
                  <button type="button" class="goodfolk-options__style${i === state.garmentIdx ? " is-active" : ""}" data-style="${i}" title="${item.label} (${item.value})">
                    <img src="${item.image}" alt="${item.label}" loading="lazy" />
                    <span class="goodfolk-options__style-code">${item.value}</span>
                  </button>`
                )
                .join("")}
            </div>
          </fieldset>

          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Color — <span>${state.color ? state.color.label : "chọn"}</span></legend>
            <div class="goodfolk-options__colors">
              ${colors
                .map(
                  (c) => `
                  <button type="button" class="goodfolk-options__color${c.value === state.color?.value ? " is-active" : ""}" data-color="${c.value}" title="${c.label}" aria-label="${c.label}" style="background:${c.hex || "#ccc"}"></button>`
                )
                .join("")}
            </div>
          </fieldset>

          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Size — <span>${state.size || "chọn"}</span></legend>
            <div class="goodfolk-options__sizes">
              ${sizes
                .map((s) => {
                  const ok = !state.color || state.color.sizes.includes(s.value);
                  return `<button type="button" class="goodfolk-options__size${s.value === state.size ? " is-active" : ""}${ok ? "" : " is-off"}" data-size="${s.value}" ${ok ? "" : "disabled"}>${s.value}</button>`;
                })
                .join("")}
            </div>
            ${
              offSizes.length
                ? `<p class="goodfolk-options__note">Màu ${state.color.label} không có size: ${offSizes.join(", ")}</p>`
                : ""
            }
          </fieldset>

          <p class="goodfolk-options__sku">
            SKU: <code>${currentSku || "— chọn đủ Style + Color + Size —"}</code>
          </p>
        </div>
      `;
      syncButton();
    }

    function syncButton() {
      const btn = document.querySelector(
        'product-form button[type="submit"], .product-form__submit'
      );
      if (!btn) return;
      const ok = !!sku();
      btn.disabled = !ok;
    }

    function syncPagePrice() {
      const priceEl = document.querySelector("[data-product-price]");
      if (priceEl && price()) priceEl.textContent = money(price());
      const skuEl = document.querySelector("[data-sku]");
      if (skuEl && sku()) skuEl.textContent = sku();
    }

    function handleSubmitBefore(e) {
      const fd = e.detail && e.detail.form;
      if (!fd) return;
      const currentSku = sku();
      if (!currentSku) return; // submit button is disabled until fully selected
      fd.append("properties[_sku]", currentSku);
      fd.append("properties[_garment]", garment().value);
      fd.append("properties[Style]", garment().label);
      fd.append("properties[Color]", state.color.label);
      fd.append("properties[Size]", state.size);
    }

    function bind() {
      root.addEventListener("click", (e) => {
        const styleBtn = e.target.closest("[data-style]");
        const colorBtn = e.target.closest("[data-color]");
        const sizeBtn = e.target.closest("[data-size]");
        if (styleBtn) {
          state.garmentIdx = Number(styleBtn.dataset.style);
          state.color = null;
          state.size = null;
          const g = garment();
          if (g?.colors?.[0]) state.color = g.colors[0];
          render();
          syncPagePrice();
        } else if (colorBtn) {
          const g = garment();
          state.color = g.colors.find((c) => c.value === colorBtn.dataset.color) || null;
          state.size = null;
          render();
          syncPagePrice();
        } else if (sizeBtn) {
          state.size = sizeBtn.dataset.size;
          render();
          syncPagePrice();
        }
      });

      document.addEventListener("product-form:submit:before", handleSubmitBefore);
    }

    fetch(catalogUrl, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((catalog) => {
        if (!catalog || !Array.isArray(catalog.garments) || !catalog.garments.length) {
          throw new Error("catalog rỗng");
        }
        state.catalog = catalog;
        const g = catalog.garments[0];
        state.color = g.colors?.[0] || null;
        bind();
        render();
        syncPagePrice();
      })
      .catch((err) => {
        root.innerHTML = `<p class="goodfolk-options__error">Không tải được bộ chọn sản phẩm (${err.message}).</p>`;
      });
  });
})();
