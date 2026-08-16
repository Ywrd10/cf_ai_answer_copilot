#!/usr/bin/env node
// Compares RAG-enabled vs. baseline /generate output across a fixed set of
// test queries, scored by a second LLM call (/judge) plus retrieval hit-rate
// from each response's `meta` field.
//
// Usage:
//   WORKER_URL=http://localhost:8787 ADMIN_TOKEN=... node eval/run-eval.mjs
//
// Each fixture gets two throwaway userIds (…-baseline / …-rag) so Durable
// Object chat history from one run never bleeds into another, and fixtures
// with a `personalDoc` get that text ingested under the RAG userId's own
// Vectorize namespace right before the RAG call runs.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKER_URL = (process.env.WORKER_URL || "http://localhost:8787").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.error("Set ADMIN_TOKEN (same value as the Worker's ADMIN_TOKEN secret).");
  process.exit(1);
}

async function ingest(scope, userId, source, text) {
  const res = await fetch(`${WORKER_URL}/admin/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
    body: JSON.stringify({ scope, userId, source, text }),
  });
  if (!res.ok) throw new Error(`ingest failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function generate(userId, fixture, useRag) {
  const res = await fetch(`${WORKER_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      profile: fixture.profile,
      jobDesc: fixture.jobDesc,
      question: fixture.question,
      tone: fixture.tone,
      minWords: fixture.minWords,
      maxWords: fixture.maxWords,
      useRag,
    }),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function judge(question, expectedPoints, answer) {
  const res = await fetch(`${WORKER_URL}/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN },
    body: JSON.stringify({ question, expectedPoints, answer }),
  });
  if (!res.ok) throw new Error(`judge failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function average(rows, key) {
  const valid = rows.filter((r) => typeof r[key] === "number");
  if (valid.length === 0) return null;
  return valid.reduce((sum, r) => sum + r[key], 0) / valid.length;
}

async function main() {
  const fixtures = JSON.parse(await readFile(path.join(__dirname, "queries.json"), "utf8"));

  const globalCorpusPath = path.join(__dirname, "..", "scripts", "seed-corpus", "advice-guide.txt");
  const globalText = await readFile(globalCorpusPath, "utf8");
  const seedResult = await ingest("global", undefined, "advice-guide", globalText);
  // Vectorize upserts are indexed asynchronously; give it a moment before
  // the first queries land.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log(`Seeded global advice corpus (${seedResult.chunks} chunks).\n`);

  const rows = [];

  for (const fixture of fixtures) {
    const baselineUserId = `eval-${fixture.id}-baseline`;
    const ragUserId = `eval-${fixture.id}-rag`;

    if (fixture.personalDoc) {
      await ingest("user", ragUserId, `${fixture.id}-personal-doc`, fixture.personalDoc);
      // Vectorize upserts are indexed asynchronously; querying immediately
      // after an upsert can race the index and miss the new vector.
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    const [baseline, rag] = await Promise.all([
      generate(baselineUserId, fixture, false),
      generate(ragUserId, fixture, true),
    ]);

    const [baselineJudged, ragJudged] = await Promise.all([
      judge(fixture.question, fixture.expectedPoints, baseline.answer),
      judge(fixture.question, fixture.expectedPoints, rag.answer),
    ]);

    const row = {
      id: fixture.id,
      question: fixture.question,
      baselineScore: baselineJudged.score,
      ragScore: ragJudged.score,
      ragHitCount: rag.meta?.retrievalHitCount ?? 0,
      baselineAnswer: baseline.answer,
      ragAnswer: rag.answer,
      baselineReasoning: baselineJudged.reasoning,
      ragReasoning: ragJudged.reasoning,
    };
    rows.push(row);

    console.log(
      `${fixture.id.padEnd(14)} baseline=${String(row.baselineScore ?? "?").padStart(2)}  rag=${String(
        row.ragScore ?? "?"
      ).padStart(2)}  hits=${row.ragHitCount}`
    );
  }

  const avgBaseline = average(rows, "baselineScore");
  const avgRag = average(rows, "ragScore");
  const avgHits = average(rows, "ragHitCount");

  console.log("\n--- Summary ---");
  console.log(`Queries: ${rows.length}`);
  console.log(`Average baseline score: ${avgBaseline?.toFixed(2) ?? "n/a"}`);
  console.log(`Average RAG score:      ${avgRag?.toFixed(2) ?? "n/a"}`);
  console.log(`Average retrieval hits (RAG runs): ${avgHits?.toFixed(2) ?? "n/a"}`);

  const resultsDir = path.join(__dirname, "results");
  await mkdir(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `eval-${Date.now()}.json`);
  await writeFile(outPath, JSON.stringify({ avgBaseline, avgRag, avgHits, rows }, null, 2));
  console.log(`\nFull results written to ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
