import { Hono } from "hono";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { z } from "zod";

/**
 * OpenAPI + Scalar docs for seo-api.
 * - GET /openapi.json   machine-readable spec (also written by `pnpm openapi`)
 * - GET /docs           Scalar interactive UI
 *
 * Add your own routes to the spec with createRoute(...) + specApp.openapi(...).
 */
export function setupDocs(app: Hono) {
  const specApp = new OpenAPIHono();

  const healthRoute = createRoute({
    method: "get",
    path: "/health",
    responses: {
      200: {
        description: "Service health",
        content: {
          "application/json": {
            schema: z.object({
              ok: z.boolean(),
              service: z.string(),
              uptime: z.number(),
              env: z.record(z.string(), z.unknown()),
            }),
          },
        },
      },
    },
  });
  specApp.openapi(healthRoute, (c) =>
    c.json({
      ok: true,
      service: "health",
      uptime: 0,
      env: { port: "0", dbType: "none", dbName: "" },
    }),
  );


  const spec = specApp.getOpenAPIDocument({
    openapi: "3.0.0",
    info: { title: "seo-api API", version: "0.1.0" },
    servers: [{ url: `http://localhost:3400` }],
  });

  app.get("/openapi.json", (c) => c.json(spec));
  app.get("/docs", apiReference({ spec: { url: "/openapi.json" } }));
}
