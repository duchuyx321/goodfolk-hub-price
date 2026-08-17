import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from '../generated/api';


/**
  * @typedef {import("../generated/api").CartInput} RunInput
  * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
  */

/**
  * Prices each cart line from the catalog price carried on the line itself
  * (`_price` property, set by the Goodfolk picker). No network access is used,
  * so this works on any Shopify plan.
  *
  * `_price` is client-supplied, so it is treated as untrusted: the discount is
  * capped at 75% of the line's own cost to bound any tampering. (75% covers
  * the largest legitimate gap in the catalog: max $47.95 -> min $15.95 = 66.7%.)
  *
  * @param {RunInput} input
  * @returns {CartLinesDiscountsGenerateRunResult}
  */

export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length) {
    return {operations: []};
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );

  if (!hasProductDiscountClass) {
    return {operations: []};
  }

  const candidates = [];

  for (const line of input.cart.lines) {
    const sku = line.sku?.value;
    const targetPrice = Number(line.price?.value);
    const currentSubtotal = Number(line.cost.subtotalAmount.amount);
    if (!sku || !line.price?.value || !Number.isFinite(targetPrice) || targetPrice <= 0) {
      continue;
    }

    const discount = currentSubtotal - targetPrice * line.quantity;
    if (discount <= 0) continue;

    // Guard: never discount more than 75% of the line's own cost.
    const applied = Math.min(discount, currentSubtotal * 0.75);
    if (applied <= 0) continue;

    candidates.push({
      message: "Goodfolk price",
      targets: [{ cartLine: { id: line.id } }],
      value: {
        fixedAmount: {
          amount: applied.toFixed(2),
          appliesToEachItem: false,
        },
      },
    });
  }

  return candidates.length
    ? {
        operations: [{
          productDiscountsAdd: {
            candidates,
            selectionStrategy: ProductDiscountSelectionStrategy.All,
          },
        }],
      }
    : {operations: []};
}
