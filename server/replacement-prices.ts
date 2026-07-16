import type { Plan, PlanCheckType } from "./plan.ts";
import type { Recipe } from "./recipe-types.ts";

export interface ReplacementClaim { replaced_service: string; monthly_price: number }
type PriceKey = `${Plan["tool"]}:${PlanCheckType}`;

// Pricing basis: lowest advertised per-month price at the annual billing rate,
// verified July 16, 2026. Never mix monthly-billed and annual-equivalent rates.
const PRICE_MAP: Partial<Record<PriceKey, ReplacementClaim>> = {
  "ffmpeg:size_under": { replaced_service: "Clideo", monthly_price: 9 },
  "ffmpeg:format_matches": { replaced_service: "CloudConvert", monthly_price: 8 },
  "ffmpeg:loudness_matches": { replaced_service: "Auphonic", monthly_price: 11 },
  "pandoc:format_matches": { replaced_service: "Convertio", monthly_price: 6.99 },
};
const CLASS_PRIORITY: PlanCheckType[] = ["size_under", "loudness_matches", "format_matches"];

export function replacementClaimFor(plan: Pick<Plan, "tool" | "checks">): ReplacementClaim | null {
  for (const type of CLASS_PRIORITY) {
    if (!plan.checks.some((check) => check.type === type)) continue;
    const claim = PRICE_MAP[`${plan.tool}:${type}`];
    if (claim) return { ...claim };
  }
  return null;
}

export function killTotalFor(
  recipes: ReadonlyArray<Pick<Recipe, "replaced_service" | "monthly_price">>,
): number {
  const services = new Map<string, number>();
  for (const recipe of recipes) {
    if (recipe.replaced_service === undefined && recipe.monthly_price === undefined) continue;
    if (recipe.replaced_service === undefined || recipe.monthly_price === undefined) {
      throw new Error("replacement claim must include both service and price");
    }
    const cents = Math.round(recipe.monthly_price * 100);
    const prior = services.get(recipe.replaced_service);
    if (prior !== undefined && prior !== cents) {
      throw new Error(`conflicting prices for ${recipe.replaced_service}`);
    }
    services.set(recipe.replaced_service, cents);
  }
  return [...services.values()].reduce((total, cents) => total + cents, 0) / 100;
}
