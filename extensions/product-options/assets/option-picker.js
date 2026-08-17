/* Goodfolk Product Options — picker thích ứng (UI giống shopify_demo2.html).
 *
 * CHẾ ĐỘ 1 — sản phẩm có VARIANT THẬT (data-variants ≥ 2, đủ Color+Size):
 *   hiển thị theo variant của sản phẩm, add đúng variant id → giá native.
 * CHẾ ĐỘ 2 — sản phẩm KHÔNG variant:
 *   đọc bộ option chung từ app (catalog API), gửi properties
 *   _sku/_price/Style/Color/Size → discount function hạ giá về đúng catalog.
 */
(() => {
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn)
      : fn();

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const money = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(n) || 0);

  ready(() => {
    const root = document.querySelector("[data-goodfolk-options]");
    if (!root) return;

    const catalogUrl =
      root.dataset.catalogUrl ||
      "https://goodfolk-hub-price.vercel.app/api/catalog";

    let variants = [];
    let optionNames = [];
    try { variants = JSON.parse(root.dataset.variants || "[]"); } catch (_) { variants = []; }
    try { optionNames = JSON.parse(root.dataset.optionNames || "[]"); } catch (_) { optionNames = []; }

    const dims = {};
    optionNames.forEach((name, index) => {
      const n = String(name || "").toLowerCase();
      if (/style|loại|garment/.test(n)) dims.style = index;
      if (/color|màu/.test(n)) dims.color = index;
      if (/size|kích thước/.test(n)) dims.size = index;
    });
    const hasVariantData = variants.length >= 2 && dims.color !== undefined && dims.size !== undefined;

    let catalog = null;
    const garmentMetaFor = (code) => {
      if (!catalog) return null;
      return (
        catalog.garments.find(
          (g) => String(g.value).toLowerCase() === String(code || "").toLowerCase(),
        ) || null
      );
    };
    const colorMetaFor = (code, color) => {
      const meta = garmentMetaFor(code);
      if (!meta) return null;
      const c = String(color).toLowerCase();
      return (
        (meta.colors || []).find(
          (entry) =>
            String(entry.label).toLowerCase() === c ||
            String(entry.value).toLowerCase() === c,
        ) || null
      );
    };

    function hideNativePickers() {
      document.querySelectorAll("[data-shopify-variant-picker], [data-sku-option-picker]").forEach((el) => {
        el.style.display = "none";
      });
    }

    function syncSubmitButton(sku, price) {
      const btn = document.querySelector(
        'product-form button[type="submit"], .product-form__submit',
      );
      if (!btn) return;
      btn.disabled = !sku;
      const label = btn.querySelector("[data-add-to-cart-text]");
      if (label) {
        if (!label.dataset.origLabel) label.dataset.origLabel = label.textContent.trim();
        label.textContent = sku ? `Add to cart — ${money(price)}` : label.dataset.origLabel;
      }
    }

    function syncPagePrice(price, sku) {
      if (price) {
        document.querySelectorAll("[data-product-price]").forEach((el) => {
          el.textContent = money(price);
        });
      }
      const skuEl = document.querySelector("[data-sku]");
      if (skuEl && sku) skuEl.textContent = sku;
    }

    // ---- CHẾ ĐỘ 1: variant thật ----
    const V = {
      styleIdx: dims.style,
      colorIdx: dims.color,
      sizeIdx: dims.size,
      state: null,
      valueAt: (v, i) => (v.options && v.options[i] !== undefined ? String(v.options[i]) : ""),
      styleOf: (v) => (V.styleIdx === undefined ? null : V.valueAt(v, V.styleIdx)),
      colorOf: (v) => V.valueAt(v, V.colorIdx),
      sizeOf: (v) => V.valueAt(v, V.sizeIdx),
      variantFor(style, color, size) {
        return variants.find(
          (v) => V.styleOf(v) === style && V.colorOf(v) === color && V.sizeOf(v) === size,
        ) || null;
      },
    };
    V.styles = V.styleIdx === undefined ? [null] : [...new Set(variants.map(V.styleOf))];
    V.isMulti = V.styleIdx !== undefined && V.styles.length > 1;
    V.colorsOf = (style) => [...new Set(variants.filter((v) => V.styleOf(v) === style).map(V.colorOf))];
    V.sizesOf = (style, color) => [
      ...new Set(variants.filter((v) => V.styleOf(v) === style && V.colorOf(v) === color).map(V.sizeOf)),
    ];
    V.basePriceOf = (style) => {
      const meta = garmentMetaFor(style);
      if (meta && Number(meta.basePrice) > 0) return Number(meta.basePrice);
      const prices = variants.filter((v) => V.styleOf(v) === style).map((v) => Number(v.price)).filter((n) => Number.isFinite(n));
      return prices.length ? Math.min(...prices) : 0;
    };

    function renderVariant() {
      const s = V.state;
      const v = s.variant;
      const colors = V.colorsOf(s.style);
      const sizes = s.color ? V.sizesOf(s.style, s.color) : [];
      const meta = garmentMetaFor(s.style);

      const sub = [
        s.style,
        s.color ? (colorMetaFor(s.style, s.color) || { label: s.color }).label : null,
        s.size,
      ].filter(Boolean).join(" · ") || (meta ? meta.label : "");

      const price = v ? money(v.price) : `từ ${money(V.basePriceOf(s.style))}`;
      const diff =
        v && meta && Number(meta.basePrice) > 0 ? Number(v.price) - Number(meta.basePrice) : 0;
      const note = v && diff > 0.005 ? `đã gồm phụ thu size ${s.size}: +${money(diff)}` : "";

      root.innerHTML = `
        <div class="goodfolk-options__body">
          <div class="goodfolk-options__price-row">
            <span class="goodfolk-options__price">${price}</span>
            ${note ? `<span class="goodfolk-options__diff">${escapeHtml(note)}</span>` : ""}
          </div>
          <div class="goodfolk-options__sub">${escapeHtml(sub)}</div>

          ${V.isMulti ? `
          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Style — <span>${escapeHtml(s.style || "chọn")}</span></legend>
            <div class="goodfolk-options__styles">
              ${V.styles.map((style) => {
                const m = garmentMetaFor(style);
                const label = m ? m.label : style;
                const tip = `${escapeHtml(label)}<i>${escapeHtml(style)} · từ ${money(V.basePriceOf(style))} · ${V.colorsOf(style).length} màu</i>`;
                return `<button type="button" class="goodfolk-options__style${style === s.style ? " is-active" : ""}" data-style="${escapeHtml(style)}" aria-label="${escapeHtml(label)}">
                  ${m && m.image ? `<img src="${escapeHtml(m.image)}" alt="" loading="lazy" />` : ""}
                  <span class="goodfolk-options__tip">${tip}</span>
                </button>`;
              }).join("")}
            </div>
          </fieldset>` : ""}

          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Color — <span>${escapeHtml(s.color || "chọn")}</span></legend>
            <div class="goodfolk-options__colors">
              ${colors.map((color) => {
                const m = colorMetaFor(s.style, color);
                const label = m ? m.label : color;
                const active = color === s.color ? " is-active" : "";
                const title = escapeHtml(label);
                return m && m.hex
                  ? `<button type="button" class="goodfolk-options__color${active}" data-color="${escapeHtml(color)}" style="background:${escapeHtml(m.hex)}" aria-label="${title}"><span class="goodfolk-options__tip">${title}</span></button>`
                  : `<button type="button" class="goodfolk-options__color goodfolk-options__color--chip${active}" data-color="${escapeHtml(color)}" title="${title}">${title}</button>`;
              }).join("")}
            </div>
          </fieldset>

          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Size — <span>${escapeHtml(s.size || "chưa chọn")}</span></legend>
            <div class="goodfolk-options__sizes">
              ${sizes.map((size) => {
                const matched = s.color ? V.variantFor(s.style, s.color, size) : null;
                const selectable = !s.color || (matched && matched.available);
                const active = size === s.size ? " is-active" : "";
                return `<button type="button" class="goodfolk-options__size${active}" data-size="${escapeHtml(size)}" ${selectable ? "" : "disabled"}>${escapeHtml(size)}</button>`;
              }).join("")}
            </div>
            ${s.color ? (() => {
              const all = [...new Set(variants.filter((x) => V.styleOf(x) === s.style).map(V.sizeOf))];
              const have = new Set(V.sizesOf(s.style, s.color));
              const off = all.filter((size) => !have.has(size));
              return off.length ? `<p class="goodfolk-options__warn">Màu này không có size: ${escapeHtml(off.join(", "))}</p>` : "";
            })() : ""}
          </fieldset>

          <div class="goodfolk-options__chosen">
            ${V.isMulti ? `<div class="goodfolk-options__chosen-row"><span>Style</span><b>${escapeHtml(s.style || "—")}</b></div>` : ""}
            <div class="goodfolk-options__chosen-row"><span>Color</span><b>${escapeHtml(s.color || "—")}</b></div>
            <div class="goodfolk-options__chosen-row"><span>Size</span><b>${escapeHtml(s.size || "—")}</b></div>
            <div class="goodfolk-options__chosen-row"><span>SKU</span><b><code>${v ? escapeHtml(v.sku) : "—"}</code></b></div>
          </div>
        </div>
      `;
      syncSubmitButton(v ? v.sku : null, v ? v.price : null);
      syncPagePrice(v ? v.price : null, v ? v.sku : null);
      hideNativePickers();
    }

    function bindVariant() {
      root.addEventListener("click", (e) => {
        const st = e.target.closest("[data-style]");
        const co = e.target.closest("[data-color]");
        const si = e.target.closest("[data-size]");
        const s = V.state;
        if (st) {
          s.style = st.dataset.style; s.color = null; s.size = null; s.variant = null; renderVariant();
        } else if (co) {
          s.color = co.dataset.color;
          if (s.size && !V.sizesOf(s.style, s.color).includes(s.size)) { s.size = null; s.variant = null; }
          else s.variant = s.size ? V.variantFor(s.style, s.color, s.size) : null;
          renderVariant();
        } else if (si) {
          if (s.size === si.dataset.size) { s.size = null; s.variant = null; }
          else { s.size = si.dataset.size; s.variant = V.variantFor(s.style, s.color, s.size); }
          renderVariant();
        }
      });
      document.addEventListener("submit", (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!(form.getAttribute("action") || "").includes("/cart/add")) return;
        if (!V.state.variant) return;
        let input = form.querySelector('input[name="id"]');
        if (!input) {
          input = document.createElement("input");
          input.type = "hidden";
          input.name = "id";
          form.appendChild(input);
        }
        input.value = String(V.state.variant.id);
      }, true);
      document.addEventListener("product-form:submit:before", (e) => {
        const fd = e.detail && e.detail.form;
        if (!fd || !V.state.variant) return;
        const form = e.currentTarget;
        const idInput = form && typeof form.querySelector === "function" ? form.querySelector('input[name="id"]') : null;
        if (idInput && idInput.value === String(V.state.variant.id)) return;
        fd.set("id", String(V.state.variant.id));
      });
      V.state = { style: V.styles[0] || null, color: null, size: null, variant: null };
      renderVariant();
    }

    // ---- CHẾ ĐỘ 2: catalog từ app ----
    const C = { garment: null, color: null, size: null, data: null };
    C.selectedSize = () => (C.garment && C.size ? C.garment.sizes.find((s) => s.value === C.size) || null : null);
    C.selectedPrice = () => { const s = C.selectedSize(); return s ? Number(s.price) : null; };
    C.selectedSku = () => {
      if (!C.garment || !C.color || !C.size) return null;
      const size = C.selectedSize();
      if (!size || !C.color.sizes.includes(C.size)) return null;
      return (C.data.skuPattern || "{garment}-{color}-{size}")
        .replace("{garment}", C.garment.value)
        .replace("{color}", C.color.skuKey)
        .replace("{size}", size.skuKey);
    };

    function renderCatalog() {
      const g = C.garment, c = C.color, s = C.size;
      const size = C.selectedSize(), sku = C.selectedSku(), price = C.selectedPrice();
      const sub = [g.value, c ? c.label : null, s].filter(Boolean).join(" · ");

      root.innerHTML = `
        <div class="goodfolk-options__body">
          <div class="goodfolk-options__price-row">
            <span class="goodfolk-options__price">${size ? money(price) : `từ ${money(Number(g.basePrice) || 0)}`}</span>
            ${size && Number(size.priceDiff) > 0 ? `<span class="goodfolk-options__diff">đã gồm phụ thu size ${escapeHtml(s)}: +${money(Number(size.priceDiff))}</span>` : ""}
          </div>
          <div class="goodfolk-options__sub">${escapeHtml(sub)}</div>

          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Style — <span>${escapeHtml(g.label)}</span></legend>
            <div class="goodfolk-options__styles">
              ${C.data.garments.map((garment) => {
                const active = garment.value === g.value ? " is-active" : "";
                const tip = `${escapeHtml(garment.label)}<i>${escapeHtml(garment.value)} · từ ${money(Number(garment.basePrice) || 0)} · ${(garment.colors || []).length} màu</i>`;
                return `<button type="button" class="goodfolk-options__style${active}" data-style="${escapeHtml(garment.value)}" aria-label="${escapeHtml(garment.label)}">
                  ${garment.image ? `<img src="${escapeHtml(garment.image)}" alt="" loading="lazy" />` : ""}
                  <span class="goodfolk-options__tip">${tip}</span>
                </button>`;
              }).join("")}
            </div>
          </fieldset>

          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Color — <span>${c ? escapeHtml(c.label) : "chọn"}</span></legend>
            <div class="goodfolk-options__colors">
              ${(g.colors || []).map((color) => {
                const active = color.value === c.value ? " is-active" : "";
                const title = escapeHtml(color.label);
                return color.hex
                  ? `<button type="button" class="goodfolk-options__color${active}" data-color="${escapeHtml(color.value)}" style="background:${escapeHtml(color.hex)}" aria-label="${title}"><span class="goodfolk-options__tip">${title}</span></button>`
                  : `<button type="button" class="goodfolk-options__color goodfolk-options__color--chip${active}" data-color="${escapeHtml(color.value)}" title="${title}">${title}</button>`;
              }).join("")}
            </div>
          </fieldset>

          <fieldset class="goodfolk-options__fieldset">
            <legend class="goodfolk-options__legend">Size — <span>${escapeHtml(s || "chưa chọn")}</span></legend>
            <div class="goodfolk-options__sizes">
              ${(g.sizes || []).map((option) => {
                const selectable = c ? c.sizes.includes(option.value) : true;
                const active = option.value === s ? " is-active" : "";
                return `<button type="button" class="goodfolk-options__size${active}" data-size="${escapeHtml(option.value)}" ${selectable ? "" : "disabled"}>${escapeHtml(option.value)}</button>`;
              }).join("")}
            </div>
            ${c ? (() => {
              const off = (g.sizes || []).map((x) => x.value).filter((size) => !c.sizes.includes(size));
              return off.length ? `<p class="goodfolk-options__warn">Màu này không có size: ${escapeHtml(off.join(", "))}</p>` : "";
            })() : ""}
          </fieldset>

          <div class="goodfolk-options__chosen">
            <div class="goodfolk-options__chosen-row"><span>Style</span><b>${escapeHtml(g.value)}</b></div>
            <div class="goodfolk-options__chosen-row"><span>Color</span><b>${c ? escapeHtml(c.label) : "—"}</b></div>
            <div class="goodfolk-options__chosen-row"><span>Size</span><b>${escapeHtml(s || "—")}</b></div>
            <div class="goodfolk-options__chosen-row"><span>SKU</span><b><code>${sku ? escapeHtml(sku) : "—"}</code></b></div>
          </div>
        </div>
      `;
      syncSubmitButton(sku, price);
      syncPagePrice(price, sku);
      hideNativePickers();
    }

    function bindCatalog() {
      root.addEventListener("click", (e) => {
        const st = e.target.closest("[data-style]");
        const co = e.target.closest("[data-color]");
        const si = e.target.closest("[data-size]");
        if (st) {
          C.garment = C.data.garments.find((g) => g.value === st.dataset.style) || C.garment;
          C.color = C.garment.colors[0] || null;
          C.size = null;
          renderCatalog();
        } else if (co) {
          C.color = C.garment.colors.find((c) => c.value === co.dataset.color) || null;
          if (C.size && !C.color.sizes.includes(C.size)) C.size = null;
          renderCatalog();
        } else if (si) {
          if (C.size === si.dataset.size) C.size = null;
          else if (!C.color || C.color.sizes.includes(si.dataset.size)) C.size = si.dataset.size;
          renderCatalog();
        }
      });

      const setProps = (form, values) => {
        for (const [name, value] of Object.entries(values)) {
          let input = form.querySelector(`[name="properties[${name}]"]`);
          if (!input) {
            input = document.createElement("input");
            input.type = "hidden";
            input.name = `properties[${name}]`;
            form.appendChild(input);
          }
          input.value = value || "";
        }
      };
      const formValues = () => {
        const size = C.selectedSize(), sku = C.selectedSku();
        if (!sku || !size || !C.color) return null;
        return {
          _sku: sku,
          _price: String(Number(size.price).toFixed(2)),
          Style: C.garment.label,
          Color: C.color.label,
          Size: C.size,
        };
      };
      document.addEventListener("submit", (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!(form.getAttribute("action") || "").includes("/cart/add")) return;
        const values = formValues();
        if (values) setProps(form, values);
      }, true);
      document.addEventListener("product-form:submit:before", (e) => {
        const fd = e.detail && e.detail.form;
        if (!fd) return;
        const values = formValues();
        if (!values) return;
        for (const [name, value] of Object.entries(values)) fd.set(`properties[${name}]`, value);
      });
    }

    if (hasVariantData) {
      bindVariant();
    } else {
      fetch(catalogUrl, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d || !Array.isArray(d.garments) || !d.garments.length) { root.remove(); return; }
          C.data = d;
          C.garment = d.garments[0];
          C.color = C.garment.colors[0] || null;
          C.size = null;
          bindCatalog();
          renderCatalog();
        })
        .catch(() => root.remove());
    }
  });
})();
