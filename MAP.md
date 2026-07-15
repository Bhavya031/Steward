# Steward Map

File | Purpose | Exports
--- | --- | ---
.gitignore | exclusions | —
bun.lockb | dependency lock | —
bunfig.toml | binary-lock config | —
MAP.md | file index | —
GUIDE.md | project brain | —
package.json | tooling | probe/test/typecheck
README.md | public stub | —
tsconfig.json | strict TS | —
server/agent.ts | Codex planner | planning/auth API
server/execution-types.ts | contracts | timeout/result/events/options/error
server/executor.test.ts | boundary tests | —
server/executor.ts | sole process boundary | plan/install/helper APIs, contracts
server/helper-executor.test.ts | helper tests | —
server/helper-policy.ts | helper tier/grants | paths/types/validator
server/install-policy.ts | install policy | validator/types
server/path-policy.ts | path grants | validator/types/error
server/plan.schema.json | plan schema | —
server/plan.test.ts | plan tests | —
server/plan.ts | plan validation | catalog/parser/validator/types/error
server/probe.ts | system probe | probe/types
server/process-stream.ts | bounded streams | consumer
server/soffice-profile.ts | LO isolation | factory/type
server/tools.ts | primary policy | binaries/policies/weights
