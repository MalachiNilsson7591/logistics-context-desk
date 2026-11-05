import { queryLocalKnowledge } from "./local_knowledge.js";
import { createServer } from "node:http";
import { z } from "zod";
import { decideException } from "./exception_decision.js";
import { InfraiError, InfraiKnowledge } from "./infrai_knowledge.js";

const AskBody = z.object({
  question: z.string().min(5),
  shipmentId: z.string().min(1),
  events: z.array(z.object({
    shipmentId: z.string(),
    status: z.enum(["in_transit", "delivered", "exception"]),
    occurredAt: z.string().datetime(),
    detail: z.string(),
  })),
  proofs: z.array(z.object({
    shipmentId: z.string(),
    documentId: z.string(),
    signedBy: z.string(),
    capturedAt: z.string().datetime(),
  })),
});

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service.");
const knowledge = new InfraiKnowledge(apiKey);

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/ask") {
    return send(response, 404, { error: "route_not_found" });
  }
  try {
    const body = AskBody.parse(await readJson(request));
    const decision = decideException(
      body.events.map((event) => ({
        shipmentId: event.shipmentId,
        status: event.status,
        occurredAt: event.occurredAt,
        detail: event.detail,
      })),
      body.proofs.map((proof) => ({
        shipmentId: proof.shipmentId,
        documentId: proof.documentId,
        signedBy: proof.signedBy,
        capturedAt: proof.capturedAt,
      })),
    );
    if (decision.action === "escalate") {
      return send(response, 202, { shipmentId: body.shipmentId, ...decision });
    }

    const embedding = await knowledge.embedding(body.question);
    const hits = await queryLocalKnowledge(embedding);
    const context = hits.map((hit) => JSON.stringify(hit.metadata ?? {})).join("\n");
    const answer = await knowledge.answer(body.question, context);
    return send(response, 200, { shipmentId: body.shipmentId, action: "answer", answer, sources: hits.map((hit) => hit.id) });
  } catch (error) {
    if (error instanceof z.ZodError) return send(response, 400, { error: "invalid_request", issues: error.issues });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.detail ?? { message: error.message } });
    }
    return send(response, 500, { error: "internal_error" });
  }
});

function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`Shipment desk listening on http://localhost:${process.env.PORT ?? 3000}`);
});
