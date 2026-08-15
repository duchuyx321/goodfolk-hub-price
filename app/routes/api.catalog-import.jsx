import { publishCatalog, authorized } from "../services/catalog.server";

export const action = async ({ request }) => {
  if (request.method !== "POST" || !authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const result = await publishCatalog(payload, "server-api");
    return Response.json({
      ok: true,
      created: result.created,
      version: result.version,
      entryCount: result.entryCount,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 422 });
  }
};
