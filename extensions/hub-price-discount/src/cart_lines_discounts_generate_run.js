import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from '../generated/api';


/**
  * @typedef {import("../generated/api").CartInput} RunInput
  * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
  */

/**
  * @param {RunInput} input
  * @returns {CartLinesDiscountsGenerateRunResult}
  */

export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length || !input.fetchResult?.jsonBody?.items) {
    return {operations: []};
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );

  if (!hasProductDiscountClass) {
    return {operations: []};
  }

  const prices = new Map(
    input.fetchResult.jsonBody.items.map((item) => [item.sku, Number(item.price)]),
  );
  const candidates = [];

  for (const line of input.cart.lines) {
    const sku = line.sku?.value;
    const targetPrice = prices.get(sku);
    const currentSubtotal = Number(line.cost.subtotalAmount.amount);
    const discount = currentSubtotal - targetPrice * line.quantity;
    if (!sku || !Number.isFinite(targetPrice) || discount <= 0) continue;

    candidates.push({
      message: `Hub price: ${sku}`,
      targets: [{ cartLine: { id: line.id } }],
      value: {
        fixedAmount: {
          amount: discount.toFixed(2),
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
