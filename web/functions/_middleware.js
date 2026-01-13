export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Only proxy API routes
  const isApi = url.pathname === "/profile" || url.pathname === "/generate";
  if (!isApi) return context.next();

 const workerBase = "cf-ai-answer-copilot-v1.di850122.workers.dev";
  const target = new URL(url.pathname + url.search, workerBase);

  // Clone headers
  const headers = new Headers(context.request.headers);

  // Handle body safely 
  let body = null;
  const method = context.request.method;

  if (method !== "GET" && method !== "HEAD") {
    body = await context.request.arrayBuffer();
  }

  return fetch(target.toString(), {
    method,
    headers,
    body,
  });
}
