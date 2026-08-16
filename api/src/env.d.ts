// Secrets aren't declared in wrangler config (set via `wrangler secret put`),
// so `wrangler types` can't infer them. Declared here to merge into the
// global `Env` interface generated in worker-configuration.d.ts.
interface Env {
  ADMIN_TOKEN: string;
}
