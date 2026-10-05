/**
 * Writes openapi.json to disk so clients / codegen can consume it.
 * Usage:  pnpm openapi   (runs scripts/gen-openapi.ts)
 * The spec is built by the same code used at runtime (src/docs.ts).
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { setupDocs } from "../src/docs.js";

// setupDocs mounts /openapi.json on the app; reuse it to render the spec.
const app = new Hono();
setupDocs(app);

const res = await app.request("/openapi.json");
const spec = await res.json();

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
writeFileSync(out, JSON.stringify(spec, null, 2));
console.log(`[openapi] wrote ${out}`);
