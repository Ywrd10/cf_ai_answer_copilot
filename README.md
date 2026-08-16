# cf_ai_answer_copilot

A simple AI-powered web app that helps CS students write better internship and job application answers.

You can save a short profile about yourself and generate tailored responses to application questions based on your background, tone, and word count preferences.

**Live demo:** https://cf-ai-answer-copilot.pages.dev/

---

## How it works
- Frontend UI built with plain HTML, CSS, and JavaScript
- Backend built with Cloudflare Workers
- Uses Workers AI (Llama 3.3) to generate responses
- Uses Durable Objects to store user profile and recent chat history

---

## Tech stack
- Cloudflare Workers
- Workers AI (Llama 3.3 for generation, bge-base-en-v1.5 for embeddings)
- Vectorize (RAG knowledge base)
- Durable Objects (SQLite-backed)
- Workers Analytics Engine (latency/retrieval/token observability)
- Cloudflare Pages
- Vanilla HTML / CSS / JS

---

## RAG

`/generate` retrieves from a Vectorize index (`cf-ai-answer-copilot-kb`, 768-dim, bge-base-en-v1.5 embeddings) before generating, split into two namespaces:
- `global` — a shared corpus of application-writing advice
- one namespace per `userId` — that user's own uploaded docs (resume, past answers)

Set `useRag: false` in a `/generate` request to skip retrieval (used by the eval script as a baseline).

**Ingest a document:**
```bash
cd api
WORKER_URL=http://localhost:8787 ADMIN_TOKEN=... npm run ingest -- \
  --file scripts/seed-corpus/advice-guide.txt --source advice-guide --scope global
# or, per-user:
WORKER_URL=... ADMIN_TOKEN=... npm run ingest -- \
  --file my-resume.txt --source resume --scope user --userId demo-user
```

**Run the eval** (15–20 fixed queries in `eval/queries.json`, scored by a second LLM call at `/judge`, comparing RAG vs. baseline):
```bash
cd api
WORKER_URL=http://localhost:8787 ADMIN_TOKEN=... npm run eval
```

`/admin/ingest` and `/judge` are gated by an `X-Admin-Token` header checked against the `ADMIN_TOKEN` secret — set it locally in `.dev.vars` **at the repo root** (next to `wrangler.jsonc` — see `.dev.vars.example`; Wrangler resolves `.dev.vars` relative to the config file's directory, not your cwd) and in production with `npx wrangler secret put ADMIN_TOKEN`.

Per-request latency (retrieval/generation/total), retrieval hit count, and token usage are logged to the `RAG_ANALYTICS` Analytics Engine dataset on every `/generate` call.

---

## Local development

> **Note:** the Worker's config lives in `wrangler.jsonc` at the repo root — the only wrangler config in this repo. The `npm run dev`/`deploy`/`cf-typegen` scripts in `api/package.json` point at it explicitly with `--config ../wrangler.jsonc`; do the same if you run `wrangler` directly from `api/` (otherwise a bare `npx wrangler <cmd>` run from `api/` will happily create a new, divergent config there instead of erroring). Wrangler resolves `.dev.vars` relative to the config file's directory too, so it must live at the repo root, not in `api/`.

1. Clone the repo
2. Install deps and set up bindings (first time only):
   ```bash
   cd api
   npm install
   npx wrangler login
   npx wrangler vectorize create cf-ai-answer-copilot-kb --dimensions=768 --metric=cosine
   npx wrangler secret put ADMIN_TOKEN --config ../wrangler.jsonc
   cd ..
   cp .dev.vars.example .dev.vars   # then edit the value to match
   ```
3. Run the Worker:
   ```bash
   npm run dev
   ```

## Screenshot
<img width="1917" height="997" alt="cf-ai" src="https://github.com/user-attachments/assets/19b07826-305a-4cc7-8d92-78e8b9632fb8" />
