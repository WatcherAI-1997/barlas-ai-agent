export type ActionRisk = "read" | "write" | "external" | "destructive";

export interface ProposedAction {
  tool: string;
  risk: ActionRisk;
  summary: string;
}

export interface ApprovalDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export function evaluateAction(action: ProposedAction): ApprovalDecision {
  if (action.risk === "read") {
    return {
      allowed: true,
      requiresApproval: false,
      reason: "Read-only actions are allowed inside the assigned scope.",
    };
  }

  return {
    allowed: false,
    requiresApproval: true,
    reason: `${action.risk} actions require explicit user approval.`,
  };
}

