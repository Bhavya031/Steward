# Steward Map

`.gitignore` — Local/build/model exclusions. Exports: none.
`bun.lockb` — Bun dependency lock. Exports: none.
`bunfig.toml` — Binary-lock configuration. Exports: none.
`MAP.md` — File index. Exports: none.
`GUIDE.md` — Project brain/current step. Exports: none.
`package.json` — Bun tooling. Exports: scripts `probe`, `test`, `typecheck`.
`README.md` — Public stub. Exports: none.
`tsconfig.json` — Strict server types. Exports: none.
`server/agent.ts` — Authenticated Codex planner/retry. Exports: `PLANNER_MODEL`, `CodexAuthStatus`, `AgentError`, `confirmCodexAuth`, `validatePlanForProfile`, `planTask`.
`server/plan.schema.json` — Planner output schema. Exports: none.
`server/plan.test.ts` — Plan safety tests. Exports: none.
`server/plan.ts` — Plan parsing/validation. Exports: `PlanTool`, `CheckTarget`, `CHECK_TYPES`, `PlanCheckType`, `PlanCheck`, `Plan`, `PlanValidationError`, `validatePlan`, `parsePlan`.
`server/probe.ts` — Typed system/tool probe. Exports: `ToolStatus`, `BrewStatus`, `SystemProfile`, `probeSystem`.
`server/tools.ts` — Final allowlist/install weights. Exports: `InstallWeight`, `AllowedBinary`, `TOOL_POLICIES`, `ALLOWED_BINARIES`, `installWeightFor`.
