import { authorized, findPrice } from "../services/catalog.server";

export const action = async ({ request }) => {
  if (request.method !== "POST" || !authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const skus = Array.isArray(body?.items)
    ? body.items.map((item) => item?.sku).filter(Boolean)
    : [body?.sku].filter(Boolean);
  const entries = await Promise.all(skus.map(findPrice));
  if (entries.some((entry) => !entry)) {
    return Response.json({ error: "SKU not found" }, { status: 404 });
  }

  return Response.json({
    items: entries.map((entry) => ({
      sku: entry.sku,
      price: entry.price,
      currency: entry.currency,
      style: entry.style,
      color: entry.color,
      size: entry.size,
    })),
  });
};
