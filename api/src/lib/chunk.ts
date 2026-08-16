export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

// Rough estimate for English text; good enough for sizing chunks without
// pulling in a real tokenizer.
const CHARS_PER_TOKEN = 4;

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const targetTokens = options.targetTokens ?? 350;
  const overlapTokens = options.overlapTokens ?? 50;
  const targetChars = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > targetChars) {
      chunks.push(current.trim());
      current = current.slice(-overlapChars);
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph;

    // A single paragraph longer than ~1.5x the target: hard-split on sentence
    // boundaries so one giant paragraph doesn't become one giant chunk.
    while (current.length > targetChars * 1.5) {
      const splitAt = findSentenceBoundary(current, targetChars);
      chunks.push(current.slice(0, splitAt).trim());
      current = current.slice(Math.max(splitAt - overlapChars, 0));
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

function findSentenceBoundary(text: string, near: number): number {
  const window = text.slice(0, near + 200);
  const lastPeriod = window.lastIndexOf(". ");
  if (lastPeriod > near * 0.5) return lastPeriod + 1;
  return near;
}
