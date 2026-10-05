import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health.js";
import analyzeRoutes from "./routes/analyze.js";
import pagespeedRoutes from "./routes/pagespeed.js";
import { setupDocs } from "./docs.js";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());
app.route("/health", healthRoutes);
app.route("/analyze", analyzeRoutes);
app.route("/api/analyze", analyzeRoutes);
app.route("/pagespeed", pagespeedRoutes);
app.route("/api/pagespeed", pagespeedRoutes);
setupDocs(app);

const port = Number(process.env.PORT ?? 3000);
console.log(`seo-api listening on :${port}  (docs: http://localhost:${port}/docs)`);

serve({ fetch: app.fetch, port });
