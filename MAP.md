# Steward Map

File | Purpose | Exports
--- | --- | ---
.gitignore | exclusions | —
bun.lockb | lockfile | —
bunfig.toml | lock config | —
MAP.md | file index | —
GUIDE.md | project brain | —
package.json | tooling | scripts
README.md | public stub | —
tsconfig.json | TS config | —
server/agent.ts | planning | auth/plan APIs
server/execution-types.ts | execution contracts | types/error
server/executor.test.ts | boundary tests | —
server/executor.ts | process boundary | plan/install/helper/probe APIs
server/ffprobe-policy.ts | fixed probes | builder/validator/types
server/helper-executor.test.ts | helper tests | —
server/helper-policy.ts | helper grants | paths/types/validator
server/install-policy.ts | installs | validator/types
server/path-policy.ts | path grants | validator/types/error
server/plan.schema.json | plan schema | —
server/plan.test.ts | plan tests | —
server/plan.ts | plans | catalog/parser/validator/types/error
server/probe.ts | system probe | API/types
server/process-stream.ts | output streams | consumer
server/soffice-profile.ts | LO isolation | factory/type
server/tools.ts | tool policy | catalog/weights
server/verify/index.ts | dispatcher | verifier/types
server/verify/types.ts | contracts | result/context
server/verify/video.test.ts | video tests | —
server/verify/video.ts | video checks | verifier/types
