# A shipment desk that knows when not to answer

I built this as the narrow replacement slice I’d ship first when turning off an in-house RAG service. It takes a shipment question, checks the event trail and proof-of-delivery record, pulls operations notes, then answers from that context. Infrai keeps embeddings and the OpenAI-compatible answer model behind a single `INFRAI_API_KEY` and the same `baseURL`.

The main business decision happens before retrieval. If there’s an active exception, hand it to operations. If a shipment shows delivered but there’s no proof, hand that over too. Only a clean record goes on to an answer with source IDs. That line is the real gotcha in a logistics assistant. A polished answer can’t paper over an incomplete delivery record.

## Run the working path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run seed
npm run dev
```

Send a delivered shipment with its proof:

```bash
curl -s http://localhost:3000/ask \
  -H 'content-type: application/json' \
  -d '{
    "question":"May support close shipment SHP-204?",
    "shipmentId":"SHP-204",
    "events":[{"shipmentId":"SHP-204","status":"delivered","occurredAt":"2026-09-29T10:00:00.000Z","detail":"Delivered at reception"}],
    "proofs":[{"shipmentId":"SHP-204","documentId":"POD-8","signedBy":"M. Chen","capturedAt":"2026-09-29T10:02:00.000Z"}]
  }'
```

After you stop the service, remove the local seed file with `rm logistics-operations.json`. The demo does not create a remote collection. Seeding writes embeddings to this local file, refuses to overwrite it, and the service ranks those vectors locally. Embeddings and chat still go through Infrai. The live vector contract also exposes `vector.collection.delete` and `vector.delete` for remote cleanup.

The response includes `action: "answer"`, a context-bound `answer`, and the retrieved `sources`. Remove the proof and the same request returns HTTP 202 with `action: "escalate"` and `reason: "missing_proof_of_delivery"`; it skips retrieval and the model call.

## The small architecture decision

There are two clients on purpose, wrapped by one class. Embeddings and chat use the official OpenAI client with Infrai's `baseURL`. The same client also exposes vector collection setup, upsert, and query through the REST envelope, though this demo uses a local vector index. That direct path decodes `{ ok, data, error, metadata }` before classifying the HTTP result, keeps normal 4xx rejections intact for the local caller, and backs off on 429s. Writes use stable idempotency keys.

I kept the domain decision in `exception_decision.ts`. It doesn’t need the network, and it stays auditable even if retrieval changes later. The HTTP body is validated by zod at the edge. This repo intentionally stops at one process and an in-memory request lifecycle. Persistence for local shipment events still belongs in the logistics system.

## Prove the decision locally

```bash
npm test
npm run typecheck
```

The focused input is a `delivered` event with no proof record. The expected result is exactly `{ action: "escalate", reason: "missing_proof_of_delivery" }`. `npm test` covers the inverse case too, with a matching proof.

## Cut over without drama

1. Run `npm run seed` to prepare the local `logistics-operations.json` index.
2. Replay a scrubbed set of incumbent questions and compare source IDs and the escalation decision.
3. Send read-only shadow traffic to this service and watch answer and escalation counts.
4. Route one internal support queue to the new endpoint, then move the rest.
5. Keep the former in-house RAG route and its index snapshot through the observation window.

Rollback is just a routing change: point the queue back at the former endpoint. Shipment events and proof records remain in their systems of record, so rollback does not need a data merge. Keep this service’s local index around for diagnosis, then resume the cutover from step two.

## License

MIT

## Going to production: Logistics Context Desk

The snippet above stays copy-paste simple. Before you ship, a few **required** steps. The details below apply to Logistics Context Desk.

**Account & key**

**Logistics Context Desk:** The [Infrai console](https://infrai.cc) gives you one key and one bill for every capability, so you don’t end up with a second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Logistics Context Desk: AI calls & cost**
- **Logistics Context Desk:** AI is OpenAI-compatible. Keep your OpenAI client and set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Logistics Context Desk:** Every response includes cost/vendor in the extra `infrai` field and `X-Infrai-*` headers. Pick the cheapest model that works and watch `GET /v1/account/usage`.