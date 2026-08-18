import type { Operation, Proposal } from "./types.js";

export type ReviewRisk = "low" | "medium" | "high";

const riskRank: Record<ReviewRisk, number> = { low: 1, medium: 2, high: 3 };

const operationService = (operation: Operation) =>
  operation.kind === "createInstance" || operation.kind === "createScript"
    ? operation.target.parent.path[0] ?? "DataModel"
    : operation.target.path[0] ?? "DataModel";

export function summarizeProposalRisk(proposal: Proposal) {
  let risk: ReviewRisk = "low";
  const reasons: string[] = [];
  const services = new Set<string>();
  for (const operation of proposal.operations) {
    const service = operationService(operation);
    services.add(service);
    let operationRisk: ReviewRisk = "low";
    if (operation.kind === "replaceScriptSource") {
      operationRisk = service === "ServerScriptService" || service === "ServerStorage" ? "high" : "medium";
      reasons.push(`Code changes under ${service}`);
    } else if (operation.kind === "createScript") {
      operationRisk = service === "ServerScriptService" || service === "ServerStorage" ? "high" : "medium";
      reasons.push(`Creates ${operation.target.className} under ${service}`);
    } else if (operation.kind === "createInstance") {
      operationRisk = "medium";
      if (["RemoteEvent", "RemoteFunction"].includes(operation.target.className)) {
        operationRisk = "high";
        reasons.push(`Creates network boundary ${operation.target.className}`);
      }
    } else if (operation.kind === "deleteInstance") {
      operationRisk = "medium";
      reasons.push(`Deletes instance under ${service}`);
    } else if (operation.kind === "reparentInstance") {
      operationRisk = "medium";
      reasons.push(`Reparents/renames instance under ${service}`);
    }
    if (riskRank[operationRisk] > riskRank[risk]) risk = operationRisk;
  }

  if (proposal.operations.length >= 50) {
    risk = "high";
    reasons.push(`Broad proposal with ${proposal.operations.length} operations`);
  }
  return {
    risk,
    reasons: reasons.length > 0 ? reasons : ["Only allow-listed property changes"],
    services: [...services].sort(),
  };
}
