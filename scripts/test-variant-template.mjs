import assert from "node:assert";
import {
  normalizeTemplate,
  buildCombos,
} from "../app/services/variant-template.logic.js";

// 1. Valid template
const input = {
  name: "  Áo thun  ",
  skuPattern: "{sku}-{color}-{size}",
  options: [
    {
      name: "Color",
      values: [
        { value: "Đen", skuKey: "BLACK", priceDelta: 0 },
        { value: "Trắng", skuKey: "WHITE", priceDelta: 10000 },
      ],
    },
    {
      name: "Size",
      values: [
        { value: "M", priceDelta: 0 },
        { value: "XL", priceDelta: 20000 },
      ],
    },
  ],
};
const t = normalizeTemplate(input);
assert.equal(t.name, "Áo thun");
assert.equal(t.skuPattern, "{sku}-{color}-{size}");
assert.equal(t.options[0].values[1].skuKey, "WHITE");
assert.equal(t.options[1].values[0].skuKey, "M"); // derived from value
assert.equal(t.options[1].values[1].priceDelta, 20000);
console.log("✓ valid template normalized");

// 2. Empty name
assert.throws(() => normalizeTemplate({ name: "  ", options: input.options }), /tên/i);
console.log("✓ empty name rejected");

// 3. No options
assert.throws(() => normalizeTemplate({ name: "x", options: [] }), /ít nhất một option/);
console.log("✓ no options rejected");

// 4. Duplicate option names (case-insensitive)
assert.throws(
  () =>
    normalizeTemplate({
      name: "x",
      options: [
        { name: "Size", values: [{ value: "M" }] },
        { name: "size", values: [{ value: "L" }] },
      ],
    }),
  /trùng tên/,
);
console.log("✓ duplicate option names rejected");

// 5. Duplicate values in an option
assert.throws(
  () =>
    normalizeTemplate({
      name: "x",
      options: [{ name: "Size", values: [{ value: "M" }, { value: "M" }] }],
    }),
  /trùng giá trị/,
);
console.log("✓ duplicate option values rejected");

// 6. Too many options (4 > 3)
assert.throws(
  () =>
    normalizeTemplate({
      name: "x",
      options: [
        { name: "A", values: [{ value: "1" }] },
        { name: "B", values: [{ value: "1" }] },
        { name: "C", values: [{ value: "1" }] },
        { name: "D", values: [{ value: "1" }] },
      ],
    }),
  /tối đa 3 option/,
);
console.log("✓ >3 options rejected");

// 7. Single combo rejected
assert.throws(
  () =>
    normalizeTemplate({
      name: "x",
      options: [{ name: "Size", values: [{ value: "M" }] }],
    }),
  /ít nhất 2 variant/,
);
console.log("✓ single-combo template rejected");

// 8. Invalid price delta
assert.throws(
  () =>
    normalizeTemplate({
      name: "x",
      options: [{ name: "Size", values: [{ value: "M", priceDelta: "abc" }] }],
    }),
  /không hợp lệ/,
);
console.log("✓ invalid priceDelta rejected");

// 9. Combo limit (100 × 50 = 5000 > 2048)
assert.throws(
  () =>
    normalizeTemplate({
      name: "x",
      options: [
        { name: "A", values: Array.from({ length: 100 }, (_, i) => ({ value: `a${i}` })) },
        { name: "B", values: Array.from({ length: 50 }, (_, i) => ({ value: `b${i}` })) },
      ],
    }),
  /vượt giới hạn/,
);
console.log("✓ >2048 combos rejected");

// 10. buildCombos — SKU pattern with named + positional placeholders
const combos = buildCombos(t, {
  baseSku: "G18500",
  legacyResourceId: "123",
  basePrice: "100000.00",
});
assert.equal(combos.length, 4);
const bySku = Object.fromEntries(combos.map((c) => [c.sku, c.price]));
assert.equal(bySku["G18500-BLACK-M"], "100000.00");
assert.equal(bySku["G18500-WHITE-XL"], "130000.00"); // 100000 + 10000 + 20000
assert.equal(bySku["G18500-BLACK-XL"], "120000.00");
// combo keys match selectedOptions ordering
assert.ok(
  combos.some((c) => c.key === JSON.stringify([["color", "Đen"], ["size", "M"]].sort())),
);
console.log("✓ buildCombos: SKU + price computation");

// 11. buildCombos — positional {option1}/{option2} + case-insensitive {COLOR}
const t2 = normalizeTemplate({
  name: "x",
  skuPattern: "{sku}-{option1}-{Option2}-{COLOR}",
  options: [
    { name: "Color", values: [{ value: "Red", skuKey: "R" }, { value: "Blue", skuKey: "B" }] },
    { name: "Size", values: [{ value: "M", skuKey: "M" }] },
  ],
});
const combos2 = buildCombos(t2, { baseSku: "A1", legacyResourceId: "1", basePrice: "10.00" });
assert.equal(combos2[0].sku, "A1-R-M-R");
assert.equal(combos2[1].sku, "A1-B-M-B");
// unknown placeholder is left as-is
const t3 = normalizeTemplate({
  name: "x",
  skuPattern: "{sku}-{unknown}",
  options: [
    {
      name: "Size",
      values: [
        { value: "M" },
        { value: "L" },
      ],
    },
  ],
});
const combos3 = buildCombos(t3, { baseSku: "A1", legacyResourceId: "1", basePrice: "10.00" });
assert.equal(combos3[0].sku, "A1-{unknown}");
assert.equal(combos3[1].sku, "A1-{unknown}");
console.log("✓ buildCombos: positional + case-insensitive + unknown placeholders");

// 12. buildCombos — base price clamped at 0
const t4 = normalizeTemplate({
  name: "x",
  options: [
    {
      name: "Size",
      values: [
        { value: "M", priceDelta: -50 },
        { value: "L", priceDelta: 0 },
      ],
    },
  ],
});
const combos4 = buildCombos(t4, { baseSku: "A1", legacyResourceId: "1", basePrice: "20.00" });
assert.equal(combos4[0].price, "0.00");
assert.equal(combos4[1].price, "20.00");
console.log("✓ buildCombos: price clamped at 0");

// 13. Missing base sku falls back to P{legacyResourceId}
const combos5 = buildCombos(t4, { baseSku: null, legacyResourceId: "42", basePrice: "20.00" });
assert.equal(combos5[0].sku, "P42-M-{option2}");
console.log("✓ buildCombos: fallback SKU from legacyResourceId");

console.log("\nAll variant-template logic checks passed ✅");
