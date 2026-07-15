# Steward Map

Path | Purpose | Exports
--- | --- | ---
`.gitignore` | exclusions | —
`bun.lockb` | dependency lock | —
`bunfig.toml` | binary-lock config | —
`MAP.md` | file index | —
`GUIDE.md` | project brain | —
`package.json` | tooling | `probe`, `test`, `typecheck`
`README.md` | public stub | —
`tsconfig.json` | strict TS config | —
`server/agent.ts` | Codex planner | planning/auth API
`server/execution-types.ts` | contracts | timeout/result/event/options/error
`server/executor.test.ts` | boundary tests | —
`server/executor.ts` | process boundary | `executePlan`, `executeInstall`, contracts
`server/install-policy.ts` | install policy | validator/types
`server/path-policy.ts` | path grants | validator/types/error
`server/plan.schema.json` | plan schema | —
`server/plan.test.ts` | plan tests | —
`server/plan.ts` | plan validation | catalog/parser/validator/types/error
`server/probe.ts` | system probe | probe/types
`server/soffice-profile.ts` | LO isolation | factory/type
`server/tools.ts` | tool policy | binaries/policies/weight API
