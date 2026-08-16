#!/usr/bin/env node
// Ingest a local text file into the RAG knowledge base via the Worker's
// admin-token-gated /admin/ingest endpoint (which chunks, embeds, and
// upserts to Vectorize).
//
// Usage:
//   WORKER_URL=http://localhost:8787 ADMIN_TOKEN=... node scripts/ingest.mjs \
//     --file scripts/seed-corpus/advice-guide.txt --source advice-guide --scope global
//
//   WORKER_URL=... ADMIN_TOKEN=... node scripts/ingest.mjs \
//     --file my-resume.txt --source resume --scope user --userId demo-user

import { readFile } from "node:fs/promises";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

async function main() {
  const filePath = arg("file");
  const source = arg("source");
  const scope = arg("scope", "global");
  const userId = arg("userId");

  if (!filePath || !source) {
    console.error(
      "Usage: node scripts/ingest.mjs --file <path> --source <name> [--scope global|user] [--userId <id>]"
    );
    process.exit(1);
  }
  if (scope === "user" && !userId) {
    console.error("--userId is required when --scope user");
    process.exit(1);
  }

  const workerUrl = (process.env.WORKER_URL || "http://localhost:8787").replace(/\/$/, "");
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    console.error("Set ADMIN_TOKEN (same value as the Worker's ADMIN_TOKEN secret).");
    process.exit(1);
  }

  const text = await readFile(filePath, "utf8");

  const res = await fetch(`${workerUrl}/admin/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": adminToken },
    body: JSON.stringify({ scope, userId, source, text }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`Ingest failed (${res.status}):`, data);
    process.exit(1);
  }
  console.log(`Ingested "${source}" (${scope}${userId ? `:${userId}` : ""}) -> ${data.chunks} chunks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
