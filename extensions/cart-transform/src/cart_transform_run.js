/**
 * Prices each cart line from the catalog price carried on the line itself
 * (`_price` attribute, set by the Goodfolk picker). Unlike a discount, this
 * changes the line's ACTUAL price, so checkout shows the plain price — no
 * discount line, no strikethrough, no "total savings".
 *
 * `_price` is client-supplied and treated as untrusted: the new price is
 * clamped to [25% of the original, 200% of the original] — so tampering can
 * never push the price below a 75% reduction of the item's own cost.
 */
export function cartTransformRun(input) {
  const operations = [];

  for (const line of input.cart.lines) {
    const priceAttr = line.priceAttribute?.value;
    if (!priceAttr) continue;

    const target = Number(priceAttr);
    const original = Number(line.cost?.amountPerQuantity?.amount);
    if (
      !Number.isFinite(target) ||
      target <= 0 ||
      !Number.isFinite(original) ||
      original <= 0
    ) {
      continue;
    }

    // Guard chống gian lận: giảm tối đa 75% giá gốc, tăng tối đa 100%.
    const floor = original * 0.25;
    const ceil = original * 2;
    const price = Math.min(Math.max(target, floor), ceil);

    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: price.toFixed(2),
            },
          },
        },
      },
    });
  }

  return { operations };
}
