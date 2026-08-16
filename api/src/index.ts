/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { chunkText } from "./lib/chunk";
import { embedTexts, retrieveContext, formatContextBlock, type RetrieveResult } from "./lib/rag";

export class MemoryDO {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    // GET /profile
    if (request.method === "GET" && url.pathname === "/profile") {
      const profile = (await this.state.storage.get<string>("profile")) ?? "";
      return withCors(Response.json({ profile }));
    }

    // POST /profile
    if (request.method === "POST" && url.pathname === "/profile") {
      const body = (await request.json()) as { profile?: string };
      await this.state.storage.put("profile", body.profile ?? "");
      return withCors(Response.json({ ok: true }));
    }

    // GET /history
    if (request.method === "GET" && url.pathname === "/history") {
      const history = (await this.state.storage.get<any[]>("history")) ?? [];
      return withCors(Response.json({ history }));
    }

    // POST /history
    if (request.method === "POST" && url.pathname === "/history") {
      const body = (await request.json()) as { role?: string; content?: string };

      const history = (await this.state.storage.get<any[]>("history")) ?? [];
      history.push({
        role: body.role ?? "user",
        content: body.content ?? "",
        ts: Date.now(),
      });

      await this.state.storage.put("history", history.slice(-20));
      return withCors(Response.json({ ok: true }));
    }

    return new Response("Not found", { status: 404 });
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function withCors(resp: Response) {
  const headers = new Headers(resp.headers);
  const cors = corsHeaders();
  Object.keys(cors).forEach((k) => headers.set(k, (cors as any)[k]));
  return new Response(resp.body, { status: resp.status, headers });
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = request.headers.get("X-Admin-Token");
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN;
}

function logGenerationMetrics(
  env: Env,
  m: {
    userId: string;
    useRag: boolean;
    totalLatencyMs: number;
    retrievalLatencyMs: number;
    generationLatencyMs: number;
    retrievalHitCount: number;
    promptTokens: number | null;
    completionTokens: number | null;
  }
) {
  // Analytics Engine has no full local emulator, and a logging failure
  // should never break the actual response.
  try {
    env.RAG_ANALYTICS?.writeDataPoint({
      blobs: [m.userId, String(m.useRag)],
      doubles: [
        m.totalLatencyMs,
        m.retrievalLatencyMs,
        m.generationLatencyMs,
        m.retrievalHitCount,
        m.promptTokens ?? 0,
        m.completionTokens ?? 0,
      ],
      indexes: [m.userId],
    });
  } catch (err) {
    console.error("analytics write failed", err);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
}


    // Durable Object quick check
    if (url.pathname === "/health") {
      const id = env.MEMORY.idFromName("demo-user");
      const stub = env.MEMORY.get(id);
      return stub.fetch("https://do/profile");
    }

    // AI quick check
    if (url.pathname === "/ai-test") {
      const aiResp = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{ role: "user", content: "Say hello in one short sentence." }],
      });

      return withCors(
        Response.json({ response: (aiResp as { response?: string })?.response ?? "" })
      );

    }

    // Debug: add one message to history and return history
    if (url.pathname === "/debug-add") {
      const id = env.MEMORY.idFromName("demo-user");
      const stub = env.MEMORY.get(id);

      await stub.fetch("https://do/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: "hello from debug" }),
      });

      const resp = await stub.fetch("https://do/history");
      return resp;
    }

    // Get saved profile
    if (url.pathname === "/profile" && request.method === "GET") {
      const userId = url.searchParams.get("userId") || "demo-user";

      const id = env.MEMORY.idFromName(userId);
      const stub = env.MEMORY.get(id);

      return stub.fetch("https://do/profile");
    }

    // Save profile
    if (url.pathname === "/profile" && request.method === "POST") {
      const body = (await request.json()) as { userId?: string; profile?: string };
      const userId = body.userId ?? "demo-user";

      const id = env.MEMORY.idFromName(userId);
      const stub = env.MEMORY.get(id);

      return stub.fetch("https://do/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: body.profile ?? "" }),
      });
    }


    // Admin: ingest a document into the RAG knowledge base
    if (url.pathname === "/admin/ingest" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return withCors(new Response("Unauthorized", { status: 401 }));
      }

      const body = (await request.json()) as {
        scope?: "global" | "user";
        userId?: string;
        source?: string;
        text?: string;
      };

      const scope = body.scope ?? "global";
      const source = (body.source ?? "untitled").trim();
      const text = (body.text ?? "").trim();

      if (!text) {
        return withCors(Response.json({ error: "text is required" }, { status: 400 }));
      }
      if (scope === "user" && !body.userId) {
        return withCors(
          Response.json({ error: "userId is required for scope=user" }, { status: 400 })
        );
      }

      const namespace = scope === "user" ? (body.userId as string) : "global";
      const chunks = chunkText(text);
      const vectors = await embedTexts(env, chunks);

      await env.VECTORIZE.upsert(
        chunks.map((chunk, i) => ({
          id: `${namespace}:${source}:${i}`,
          values: vectors[i],
          namespace,
          metadata: { text: chunk, source, chunkIndex: i },
        }))
      );

      return withCors(Response.json({ ok: true, chunks: chunks.length, namespace }));
    }

    // Admin: LLM-as-judge scoring for the eval script
    if (url.pathname === "/judge" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return withCors(new Response("Unauthorized", { status: 401 }));
      }

      const body = (await request.json()) as {
        question?: string;
        expectedPoints?: string[];
        answer?: string;
      };

      const rubric = (body.expectedPoints ?? []).map((p, i) => `${i + 1}. ${p}`).join("\n");

      const judgePrompt = `
You are grading an AI-generated internship application answer.

QUESTION:
${body.question ?? ""}

The answer should ideally touch on these points:
${rubric || "(no specific points provided; grade for general quality)"}

ANSWER TO GRADE:
${body.answer ?? ""}

Score the answer from 1 (poor) to 5 (excellent) on how well it addresses the question and covers the expected points, and whether it stays grounded (no fabricated claims).

Output exactly one JSON object and nothing else: no preamble, no markdown fences, no nested wrapper object.
It must have exactly two top-level keys, "score" (integer 1-5) and "reasoning" (a one-sentence string). Example of the exact shape required:
{"score": 3, "reasoning": "Covers two of the three expected points but stays vague on impact."}
`.trim();

      const aiResp = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{ role: "user", content: judgePrompt }],
      });

      // Workers AI sometimes returns `.response` already parsed into an
      // object when the output looks like JSON, instead of the plain string
      // the type declares — handle both shapes rather than assuming a string.
      const rawResponse = (aiResp as { response?: unknown })?.response;
      let parsed: { score?: number; reasoning?: string } | null = null;
      if (rawResponse && typeof rawResponse === "object") {
        parsed = rawResponse as { score?: number; reasoning?: string };
      } else if (typeof rawResponse === "string") {
        try {
          const match = rawResponse.match(/\{[\s\S]*\}/);
          parsed = match ? JSON.parse(match[0]) : null;
        } catch {
          parsed = null;
        }
      }

      // Occasionally the answer comes back nested under a "reasoning" or
      // "result" key instead of the flat shape asked for; unwrap one level
      // if so rather than silently losing the score.
      if (parsed && typeof parsed.score !== "number") {
        const nested = (parsed as Record<string, unknown>).reasoning ?? (parsed as Record<string, unknown>).result;
        if (nested && typeof nested === "object" && typeof (nested as { score?: unknown }).score === "number") {
          parsed = nested as { score?: number; reasoning?: string };
        }
      }

      const rawText = typeof rawResponse === "string" ? rawResponse : JSON.stringify(rawResponse ?? "");

      return withCors(
        Response.json({
          score: parsed?.score ?? null,
          reasoning: parsed?.reasoning ?? rawText,
        })
      );
    }

    // Main endpoint: generate an application answer
    if (url.pathname === "/generate" && request.method === "POST") {
      const t0 = Date.now();

      const body = (await request.json()) as {
        userId?: string;
        profile?: string;
        question: string;
        jobDesc?: string;
        tone?: string;
        minWords?: number;
        maxWords?: number;
        useRag?: boolean;
      };

      const userId = body.userId ?? "demo-user";
      const tone = body.tone ?? "casual";
      const minWords = body.minWords ?? 100;
      const maxWords = body.maxWords ?? 150;
      const useRag = body.useRag ?? true;

      const id = env.MEMORY.idFromName(userId);
      const stub = env.MEMORY.get(id);

      // Save profile if provided
      if (body.profile) {
        await stub.fetch("https://do/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: body.profile }),
        });
      }

      // Read profile + history
      const profileResp = await stub.fetch("https://do/profile");
      const profileData = (await profileResp.json()) as { profile: string };

      const historyResp = await stub.fetch("https://do/history");
      const historyData = (await historyResp.json()) as { history: any[] };

      // Retrieval step (RAG): embed the question and pull the top matching
      // chunks from Vectorize (global advice corpus + this user's own docs).
      // A retrieval failure should degrade to the baseline prompt, not fail
      // the whole request.
      let retrieval: RetrieveResult = { chunks: [], retrievalLatencyMs: 0, hitCount: 0 };
      if (useRag && body.question) {
        try {
          retrieval = await retrieveContext(env, { question: body.question, userId });
        } catch (err) {
          console.error("retrieval failed", err);
        }
      }
      const contextBlock = formatContextBlock(retrieval.chunks);

      const system = `
You help a college CS student write internship application answers.
Be clear and human. No em dashes.
Keep it between ${minWords} and ${maxWords} words.
Tone: ${tone}.
${contextBlock ? "Use the RELEVANT CONTEXT below if it helps answer the question. Do not invent facts beyond the profile, job description, and this context." : ""}
`.trim();

      const userPrompt = `
PROFILE (about me):
${profileData.profile || "(no profile provided)"}

JOB DESCRIPTION (if provided):
${body.jobDesc || "(not provided)"}
${contextBlock ? `\nRELEVANT CONTEXT:\n${contextBlock}\n` : ""}
QUESTION:
${body.question}

Write the answer now.
`.trim();

      const genStart = Date.now();
      const aiResp = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [
          { role: "system", content: system },
          ...historyData.history.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: "user", content: userPrompt },
        ],
      });
      const generationLatencyMs = Date.now() - genStart;

      const answer = (aiResp as { response?: string })?.response ?? "";

      // Save conversation
      await stub.fetch("https://do/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: body.question }),
      });

      await stub.fetch("https://do/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: answer }),
      });

      const usage = (aiResp as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
        ?.usage;

      logGenerationMetrics(env, {
        userId,
        useRag,
        totalLatencyMs: Date.now() - t0,
        retrievalLatencyMs: retrieval.retrievalLatencyMs,
        generationLatencyMs,
        retrievalHitCount: retrieval.hitCount,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
      });

      return withCors(
        Response.json({
          answer,
          meta: { useRag, retrievalHitCount: retrieval.hitCount },
        })
      );
    }

    return new Response("OK");
  },
};

