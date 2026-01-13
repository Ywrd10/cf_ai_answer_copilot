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

      return withCors(Response.json({ response: aiResp?.response ?? "" }));

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



    // Main endpoint: generate an application answer
    if (url.pathname === "/generate" && request.method === "POST") {
      const body = (await request.json()) as {
        userId?: string;
        profile?: string;
        question: string;
        jobDesc?: string;
        tone?: string;
        minWords?: number;
        maxWords?: number;
      };

      const userId = body.userId ?? "demo-user";
      const tone = body.tone ?? "casual";
      const minWords = body.minWords ?? 100;
      const maxWords = body.maxWords ?? 150;

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

      const system = `
You help a college CS student write internship application answers.
Be clear and human. No em dashes.
Keep it between ${minWords} and ${maxWords} words.
Tone: ${tone}.
`.trim();

      const userPrompt = `
PROFILE (about me):
${profileData.profile || "(no profile provided)"}

JOB DESCRIPTION (if provided):
${body.jobDesc || "(not provided)"}

QUESTION:
${body.question}

Write the answer now.
`.trim();

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

      const answer = aiResp?.response ?? "";

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

      return withCors(Response.json({ answer }));
    }

    return new Response("OK");
  },
};

