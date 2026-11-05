import assert from "node:assert/strict";
import test from "node:test";
import { decideException } from "../src/exception_decision.js";

test("a delivered shipment without proof is escalated", () => {
  const decision = decideException([
    { shipmentId: "SHP-204", status: "in_transit", occurredAt: "2026-09-29T08:00:00.000Z", detail: "At depot" },
    { shipmentId: "SHP-204", status: "delivered", occurredAt: "2026-09-29T10:00:00.000Z", detail: "Delivered" },
  ], []);

  assert.deepEqual(decision, { action: "escalate", reason: "missing_proof_of_delivery" });
});

test("proof permits a grounded answer", () => {
  const decision = decideException([
    { shipmentId: "SHP-204", status: "delivered", occurredAt: "2026-09-29T10:00:00.000Z", detail: "Delivered" },
  ], [
    { shipmentId: "SHP-204", documentId: "POD-8", signedBy: "M. Chen", capturedAt: "2026-09-29T10:02:00.000Z" },
  ]);

  assert.deepEqual(decision, { action: "answer", reason: "context_ready" });
});
