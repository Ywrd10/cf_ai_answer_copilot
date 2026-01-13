export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Send API routes to the Worker
  if (url.pathname.startsWith("/profile") || url.pathname.startsWith("/generate")) {
    // CHANGE THIS to your Worker URL once you have it (next step)
    const workerBase = "cf-ai-answer-copilot-v1.di850122.workers.dev";

    const target = new URL(workerBase);
    target.pathname = url.pathname;
    target.search = url.search;

    const req = new Request(target.toString(), context.request);
    return fetch(req);
  }

 
  return context.next();
}
