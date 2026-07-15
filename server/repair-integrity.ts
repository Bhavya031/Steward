import { PlanValidationError, type Plan } from "./plan.ts";

export function enforceRepairIntegrity(original: Plan, revised: Plan): Plan {
  if (JSON.stringify(revised.checks) !== JSON.stringify(original.checks)) {
    throw new PlanValidationError("repair must preserve every verification check and target");
  }
  return revised;
}
