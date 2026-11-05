export type ShipmentEvent = {
  shipmentId: string;
  status: "in_transit" | "delivered" | "exception";
  occurredAt: string;
  detail: string;
};

export type ProofOfDelivery = {
  shipmentId: string;
  documentId: string;
  signedBy: string;
  capturedAt: string;
};

export type ExceptionDecision =
  | { action: "answer"; reason: "context_ready" }
  | { action: "escalate"; reason: "active_exception" | "missing_proof_of_delivery" };

export function decideException(
  events: ShipmentEvent[],
  proofs: ProofOfDelivery[],
): ExceptionDecision {
  const latest = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (latest?.status === "exception") {
    return { action: "escalate", reason: "active_exception" };
  }
  if (latest?.status === "delivered" && !proofs.some((proof) => proof.shipmentId === latest.shipmentId)) {
    return { action: "escalate", reason: "missing_proof_of_delivery" };
  }
  return { action: "answer", reason: "context_ready" };
}
