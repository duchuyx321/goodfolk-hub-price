export const DEFAULT_SKU_PATTERN = "{sku}-{option1}-{option2}";
export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 2048;

const slugKey = (value) => value.trim().replace(/\s+/g, "-");

export function normalizeTemplate(input) {
  const name = String(input?.name || "").trim();
  if (!name) throw new Error("Template cần có tên.");

  const skuPattern = String(input?.skuPattern || "").trim() || DEFAULT_SKU_PATTERN;

  const rawOptions = Array.isArray(input?.options) ? input.options : [];
  if (rawOptions.length === 0) throw new Error("Template cần ít nhất một option.");
  if (rawOptions.length > MAX_OPTIONS) {
    throw new Error(`Shopify hỗ trợ tối đa ${MAX_OPTIONS} option cho một sản phẩm.`);
  }

  let basePrice = null;
  if (input?.basePrice !== undefined && input?.basePrice !== null && input?.basePrice !== "") {
    basePrice = Math.round(Number(input.basePrice) * 100) / 100;
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      throw new Error("Giá gốc (basePrice) của template không hợp lệ.");
    }
  }

  const garment = input?.garment ? String(input.garment).trim() : null;

  const optionNames = new Set();
  const options = rawOptions.map((opt) => {
    const optName = String(opt?.name || "").trim();
    if (!optName) throw new Error("Mỗi option cần có tên.");
    const lowerName = optName.toLowerCase();
    if (optionNames.has(lowerName)) throw new Error(`Option trùng tên: ${optName}`);
    optionNames.add(lowerName);

    const values = Array.isArray(opt?.values) ? opt.values : [];
    if (values.length === 0) throw new Error(`Option "${optName}" cần ít nhất một giá trị.`);

    const seen = new Set();
    const cleanedValues = values.map((v) => {
      const value = String(v?.value ?? "").trim();
      if (!value) throw new Error(`Option "${optName}" có giá trị rỗng.`);
      if (seen.has(value)) throw new Error(`Option "${optName}" trùng giá trị: ${value}`);
      seen.add(value);

      const priceDelta = Number(v?.priceDelta ?? 0);
      if (!Number.isFinite(priceDelta)) {
        throw new Error(`Giá chênh lệch của "${value}" không hợp lệ.`);
      }

      return {
        value,
        skuKey: String(v?.skuKey ?? "").trim() || slugKey(value),
        priceDelta: Math.round(priceDelta * 100) / 100,
      };
    });

    return { name: optName, values: cleanedValues };
  });

  const comboCount = options.reduce((count, opt) => count * opt.values.length, 1);
  if (comboCount < 2) throw new Error("Template cần tạo ít nhất 2 variant.");
  if (comboCount > MAX_VARIANTS) {
    throw new Error(`Template tạo ${comboCount} variant, vượt giới hạn ${MAX_VARIANTS} của Shopify.`);
  }

  return { name, skuPattern, basePrice, garment, options };
}

// Cartesian product of option values → per-variant { key, sku, price }.
// key matches a variant's selectedOptions; price = base price + sum of price deltas.
export function buildCombos(template, product) {
  const baseSku = product.baseSku || `P${product.legacyResourceId}`;
  const baseCents = Math.round((Number(product.basePrice) || 0) * 100);
  const optionNames = template.options.map((option) => option.name.toLowerCase());

  const combos = [];
  const walk = (index, accValues, accSkus, accCents) => {
    if (index === template.options.length) {
      const key = JSON.stringify(
        accValues.map(([name, value]) => [name.toLowerCase(), value]).sort(),
      );
      combos.push({
        key,
        sku: expandPattern(template.skuPattern, { baseSku, optionNames, accSkus }),
        price: (Math.max(0, accCents) / 100).toFixed(2),
      });
      return;
    }

    const option = template.options[index];
    for (const value of option.values) {
      accValues.push([option.name, value.value]);
      accSkus.push(value.skuKey);
      walk(index + 1, accValues, accSkus, accCents + Math.round(value.priceDelta * 100));
      accValues.pop();
      accSkus.pop();
    }
  };

  walk(0, [], [], baseCents);
  return combos;
}

function expandPattern(pattern, { baseSku, optionNames, accSkus }) {
  const map = new Map([["sku", baseSku]]);
  optionNames.forEach((name, index) => {
    map.set(name, accSkus[index]);
    map.set(`option${index + 1}`, accSkus[index]);
  });
  return pattern.replace(/\{([^{}]+)\}/g, (match, key) => {
    const value = map.get(key.trim().toLowerCase());
    return value !== undefined ? value : match;
  });
}
