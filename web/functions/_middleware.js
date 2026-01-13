export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);

    const isApi = url.pathname === "/profile" || url.pathname === "/generate";
    if (!isApi) return context.next();

  
    const workerBase = "https://cf-ai-answer-copilot.di850122.workers.dev";

    const target = new URL(url.pathname + url.search, workerBase);

    // Only forward the headers we actually need.
    // Forwarding everything can cause runtime errors on Cloudflare.
    const headers = new Headers();
    const ct = context.request.headers.get("content-type");
    if (ct) headers.set("content-type", ct);

    const method = context.request.method;

    // Preflight
    if (method === "OPTIONS") {
      return fetch(target.toString(), { method, headers });
    }

    let body;
    if (method !== "GET" && method !== "HEAD") {
      body = await context.request.arrayBuffer();
    }

    const resp = await fetch(target.toString(), { method, headers, body });
    return resp;
  } catch (err) {
   
    return new Response(
      `Pages middleware error: ${err?.message || String(err)}`,
      { status: 502, headers: { "content-type": "text/plain" } }
    );
  }
}
