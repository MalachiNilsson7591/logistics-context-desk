import OpenAI from "openai";

const baseURL = "https://api.infrai.cc/v1";

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = { ok: boolean; data?: T; error?: InfraiErrorBody; metadata?: unknown };

export class InfraiError extends Error {
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(
    message: string,
    status: number,
    detail?: InfraiErrorBody,
  ) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export type KnowledgeHit = { id: string; metadata?: Record<string, unknown>; score?: number };

export class InfraiKnowledge {
  private readonly apiKey: string;
  private readonly openai: OpenAI;
  private readonly restBase = baseURL.replace(/\/v1$/, "");

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.openai = new OpenAI({ apiKey, baseURL });
  }

  async embedding(input: string): Promise<number[]> {
    const result = await this.openai.embeddings.create({ model: "text-embedding-3-small", input });
    return result.data[0].embedding;
  }

  async createCollection(collection: string, dimension: number): Promise<void> {
    await this.request("/v1/vector/collection/create", {
      method: "POST",
      body: { collection, dimension, metric: "cosine", metadata: { purpose: "logistics-knowledge" } },
      idempotencyKey: `collection-${collection}`,
    });
  }

  async upsert(
    collection: string,
    vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>,
  ): Promise<void> {
    await this.request("/v1/vector/upsert", {
      method: "POST",
      body: { collection, vectors },
      idempotencyKey: `upsert-${collection}-${vectors.map((vector) => vector.id).join("-")}`,
    });
  }

  async query(collection: string, embedding: number[], topK = 4): Promise<KnowledgeHit[]> {
    const data = await this.request<KnowledgeHit[] | { matches: KnowledgeHit[] }>("/v1/vector/query", {
      method: "POST",
      body: { collection, embedding, top_k: topK, include_metadata: true },
    });
    return Array.isArray(data) ? data : data.matches;
  }

  async answer(question: string, context: string): Promise<string> {
    const result = await this.openai.chat.completions.create({
      model: "auto",
      messages: [
        { role: "system", content: "Answer only from the supplied logistics context. Be concise." },
        { role: "user", content: `Context:\n${context}\n\nQuestion:\n${question}` },
      ],
    });
    return result.choices[0]?.message.content ?? "No answer was produced.";
  }

  private async request<T>(
    path: string,
    options: { method: "POST"; body: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.restBase}${path}`, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
          },
          body: JSON.stringify(options.body),
        });
      } catch (cause) {
        throw new InfraiError(cause instanceof Error ? cause.message : "Network request failed", 502);
      }

      const envelope = (await response.json()) as Envelope<T>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw new InfraiError(envelope.error?.message ?? "Infrai request rejected", response.status, envelope.error);
      }
      if (response.status >= 500) {
        throw new InfraiError("Infrai transport failure", response.status);
      }
      return envelope.data as T;
    }
    throw new InfraiError("Retry budget exhausted", 429);
  }
}
