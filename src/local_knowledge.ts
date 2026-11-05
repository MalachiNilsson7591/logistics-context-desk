import { readFile } from "node:fs/promises";
import type { KnowledgeHit } from "./infrai_knowledge.js";

export const knowledgeFile = new URL("../logistics-operations.json", import.meta.url);

type LocalVector = KnowledgeHit & { values: number[] };

export async function queryLocalKnowledge(embedding: number[], topK = 4): Promise<KnowledgeHit[]> {
  const vectors = JSON.parse(await readFile(knowledgeFile, "utf8")) as LocalVector[];
  const magnitude = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return vectors.map(({ id, metadata, values }) => {
    if (values.length !== embedding.length) throw new Error("Seed and query embedding dimensions differ; reseed the local index.");
    const denominator = magnitude(values) * magnitude(embedding);
    const score = denominator === 0 ? 0 : values.reduce((sum, value, index) => sum + value * embedding[index], 0) / denominator;
    return { id, metadata, score };
  }).sort((a, b) => b.score - a.score).slice(0, topK);
}
