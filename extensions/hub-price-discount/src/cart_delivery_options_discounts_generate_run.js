import {
  DeliveryDiscountSelectionStrategy,
  DiscountClass,
} from "../generated/api";

/**
 * Nhận diện option ship thường (được miễn phí) theo handle hoặc title.
 * Ship nhanh / express không khớp pattern này nên không bị discount.
 */
const STANDARD_SHIPPING_PATTERN = /standard|thường|thuong|tiêu chuẩn|tieu chuan|ground/i;

function isStandardShippingOption(option) {
  return STANDARD_SHIPPING_PATTERN.test(`${option.title || ""} ${option.handle || ""}`);
}

/**
 * @typedef {import("../generated/api").DeliveryInput} RunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsDiscountsGenerateRunResult} CartDeliveryOptionsDiscountsGenerateRunResult
 */

/**
 * @param {RunInput} input
 * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
 */

export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  const hasShippingDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Shipping,
  );

  if (!hasShippingDiscountClass) {
    return { operations: [] };
  }

  const candidates = [];

  for (const group of input.cart.deliveryGroups) {
    const standardOption = group.deliveryOptions?.find(isStandardShippingOption);
    if (!standardOption) continue;

    candidates.push({
      message: "FREE DELIVERY",
      targets: [
        {
          deliveryOption: {
            handle: standardOption.handle,
          },
        },
      ],
      value: {
        percentage: {
          value: 100,
        },
      },
    });
  }

  return candidates.length
    ? {
        operations: [
          {
            deliveryDiscountsAdd: {
              candidates,
              selectionStrategy: DeliveryDiscountSelectionStrategy.All,
            },
          },
        ],
      }
    : { operations: [] };
}
