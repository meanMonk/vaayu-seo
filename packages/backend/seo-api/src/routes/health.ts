import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) =>
  c.json({
    ok: true,
    service: process.env.SERVICE_NAME ?? "seo-api",
    uptime: process.uptime(),
    env: {
      port: process.env.PORT,
      dbType: process.env.DB_TYPE ?? "none",
      dbName: process.env.DB_NAME ?? "",
    },
  }),
);
