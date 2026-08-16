export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

const SCORE_THRESHOLD = 0.5;
const TOP_K_PER_NAMESPACE = 5;
const MAX_CHUNKS = 5;

export interface RetrievedChunk {
  id: string;
  text: string;
  source: string;
  score: number;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  retrievalLatencyMs: number;
  hitCount: number;
}

export async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const resp = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  return (resp as { data?: number[][] })?.data ?? [];
}

export async function retrieveContext(
  env: Env,
  params: { question: string; userId: string }
): Promise<RetrieveResult> {
  const start = Date.now();
  const [queryVector] = await embedTexts(env, [params.question]);

  if (!queryVector) {
    return { chunks: [], retrievalLatencyMs: Date.now() - start, hitCount: 0 };
  }

  // Global (shared advice corpus) and per-user (resume/past answers) live in
  // separate Vectorize namespaces; merge both result sets by score.
  const namespaces = Array.from(new Set(["global", params.userId]));

  const results = await Promise.all(
    namespaces.map((namespace) =>
      env.VECTORIZE.query(queryVector, {
        topK: TOP_K_PER_NAMESPACE,
        namespace,
        returnMetadata: "all",
      })
    )
  );

  const chunks: RetrievedChunk[] = results
    .flatMap((r) => r.matches)
    .filter((m) => m.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHUNKS)
    .map((m) => ({
      id: m.id,
      text: String(m.metadata?.text ?? ""),
      source: String(m.metadata?.source ?? "unknown"),
      score: m.score,
    }))
    .filter((c) => c.text);

  return {
    chunks,
    retrievalLatencyMs: Date.now() - start,
    hitCount: chunks.length,
  };
}

export function formatContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks.map((c, i) => `[${i + 1}] (source: ${c.source})\n${c.text}`).join("\n\n");
}
