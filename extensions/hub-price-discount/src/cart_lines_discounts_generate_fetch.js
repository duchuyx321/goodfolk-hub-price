import { HttpRequestMethod } from "../generated/api";

const PRICE_API_URL = "https://goodfolk-hub-price.vercel.app/api/price";

export function cartLinesDiscountsGenerateFetch(input) {
  const items = input.cart.lines
    .map((line) => {
      const sku = line.sku?.value;
      return sku ? { lineId: line.id, sku } : null;
    })
    .filter(Boolean);

  return {
    request: {
      method: HttpRequestMethod.Post,
      url: PRICE_API_URL,
      headers: [
        { name: "Content-Type", value: "application/json" },
      ],
      jsonBody: { items },
      policy: { readTimeoutMs: 1500 },
    },
  };
}
