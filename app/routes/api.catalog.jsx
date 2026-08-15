import { currentCatalog } from "../services/catalog.server";

export const loader = async () => {
  const catalog = await currentCatalog();
  if (!catalog) return Response.json({ error: "Catalog not published" }, { status: 404 });

  return Response.json(catalog, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
