import { ExecutionError } from "./execution-types.ts";

export type PathRole = "input" | "output" | "temporary" | "output-directory";
export interface ClassifiedPath { value: string; role: PathRole; index: number }
export interface ValueRule {
  kind: "value" | "path";
  accepts?: (value: string) => boolean;
  role?: PathRole;
  inline?: boolean;
}
export interface ToolFlagRules {
  switches: ReadonlySet<string>;
  values: ReadonlyMap<string, ValueRule>;
  positionals: readonly PathRole[] | PathRole | null;
  minPositionals?: number;
  maxPositionals?: number;
}

export const pathValue = (role: PathRole, inline = false): ValueRule =>
  ({ kind: "path", role, inline });
export const checkedValue = (
  accepts: (value: string) => boolean,
  inline = false,
): ValueRule => ({ kind: "value", accepts, inline });
export const oneOf = (...values: string[]) => (value: string): boolean => values.includes(value);
export const matches = (pattern: RegExp) => (value: string): boolean => pattern.test(value);

function option(
  token: string,
  rules: ToolFlagRules,
): { name: string; rule: ValueRule; inlineValue?: string } | null {
  const exact = rules.values.get(token);
  if (exact) return { name: token, rule: exact };
  const equals = token.indexOf("=");
  if (equals < 1) return null;
  const name = token.slice(0, equals);
  const rule = rules.values.get(name);
  if (!rule?.inline) return null;
  return { name, rule, inlineValue: token.slice(equals + 1) };
}

export function classifySimple(command: string[], rules: ToolFlagRules): ClassifiedPath[] {
  const paths: ClassifiedPath[] = [];
  let positional = 0;
  for (let index = 1; index < command.length; index += 1) {
    const token = command[index]!;
    if (rules.switches.has(token)) continue;
    const found = option(token, rules);
    if (found) {
      const valueIndex = found.inlineValue === undefined ? ++index : index;
      const value = found.inlineValue ?? command[valueIndex];
      if (!value) throw new ExecutionError(`${found.name} requires a value`);
      if (found.rule.kind === "path") {
        paths.push({ value, role: found.rule.role!, index: valueIndex });
      } else if (!found.rule.accepts?.(value)) {
        throw new ExecutionError(`value is not allowed for ${found.name}: ${value}`);
      }
      continue;
    }
    if (token.startsWith("-")) throw new ExecutionError(`flag is not allowed: ${token}`);
    if (rules.positionals === null) throw new ExecutionError(`unexpected argument: ${token}`);
    const role = Array.isArray(rules.positionals)
      ? rules.positionals[positional]
      : rules.positionals;
    if (!role) throw new ExecutionError(`unexpected positional argument: ${token}`);
    paths.push({ value: token, role, index });
    positional += 1;
  }
  if (positional < (rules.minPositionals ?? 0) || positional > (rules.maxPositionals ?? Infinity)) {
    throw new ExecutionError(`expected ${rules.minPositionals ?? 0}-${rules.maxPositionals ?? "many"} path arguments`);
  }
  return paths;
}
