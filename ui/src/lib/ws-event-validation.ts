import type { WsServerEvent } from "../../../server/ws-events.ts";

type RecordValue = Record<string, unknown>;
type Predicate = (value: unknown) => boolean;

const TOOLS = new Set([
  "ffmpeg", "ffprobe", "pandoc", "magick", "ocrmypdf", "whisper-cli", "gs", "soffice",
]);
const CHECKS = new Set([
  "size_under", "duration_matches", "streams_present", "plays",
  "audio_stream_present", "loudness_matches", "true_peak_under",
  "file_valid", "page_count_positive", "page_count_matches", "text_extractable",
  "format_matches", "srt_valid", "cue_count", "timestamps_monotonic",
]);
const MEDIA_FORMATS = new Set([
  "avi", "flac", "m4a", "mkv", "mov", "mp3", "mp4", "ogg", "wav", "webm",
]);
const DOCUMENT_FORMATS = new Set(["docx", "epub", "html", "md", "pdf", "txt"]);
const INELIGIBLE_REASONS = new Set([
  "ambiguous_or_unsupported_contract", "stage_limit", "command_limit",
]);

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(
  value: unknown,
  required: string[],
  optional: string[] = [],
): value is RecordValue {
  if (!record(value) || !required.every((key) => Object.hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key));
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function boolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function list(value: unknown, predicate: Predicate): boolean {
  return Array.isArray(value) && value.every(predicate);
}

function strings(value: unknown): boolean {
  return list(value, text);
}

function stringLists(value: unknown): boolean {
  return list(value, strings);
}

function oneOf(value: unknown, values: Set<string>): boolean {
  return text(value) && values.has(value);
}

function checkTarget(value: unknown): boolean {
  return text(value) || finite(value) || boolean(value);
}

function planCheck(value: unknown): boolean {
  return exact(value, ["type", "target"]) &&
    oneOf(value.type, CHECKS) && checkTarget(value.target);
}

function verification(value: unknown): boolean {
  return exact(value, ["name", "pass", "expected", "actual"]) &&
    text(value.name) && boolean(value.pass) &&
    text(value.expected) && text(value.actual);
}

function derivation(value: unknown): boolean {
  return exact(value, ["name", "args"]) &&
    value.name === "size_target_video_bitrate" &&
    exact(value.args, ["target_bytes", "audio_kbps", "safety_factor"]) &&
    integer(value.args.target_bytes) && finite(value.args.audio_kbps) &&
    finite(value.args.safety_factor);
}

function derivations(value: unknown): boolean {
  return record(value) && Object.values(value).every(derivation);
}

function commandTemplate(value: unknown): boolean {
  return exact(value, ["commands", "output_path"]) &&
    stringLists(value.commands) && text(value.output_path);
}

function recipe(value: unknown): boolean {
  if (!exact(
    value,
    [
      "name", "command_template", "checks", "created_at", "arch", "tool",
      "install_weight",
    ],
    [
      "kind", "task_signature", "replaced_service", "monthly_price",
      "derivations", "intermediates", "resources",
    ],
  )) return false;
  return (value.kind === undefined || value.kind === "atomic") &&
    text(value.name) && commandTemplate(value.command_template) &&
    list(value.checks, planCheck) && text(value.created_at) && text(value.arch) &&
    oneOf(value.tool, TOOLS) &&
    (value.install_weight === "light" || value.install_weight === "heavy") &&
    (value.task_signature === undefined || text(value.task_signature)) &&
    (value.replaced_service === undefined || text(value.replaced_service)) &&
    (value.monthly_price === undefined || finite(value.monthly_price)) &&
    (value.derivations === undefined || derivations(value.derivations)) &&
    (value.intermediates === undefined || strings(value.intermediates)) &&
    (value.resources === undefined ||
      list(value.resources, (item) => item === "whisper-large-v3-turbo"));
}

function mediaInput(value: RecordValue): boolean {
  return exact(value, ["family", "accepted_formats", "required_streams"]) &&
    value.family === "media" &&
    list(value.accepted_formats, (item) => oneOf(item, MEDIA_FORMATS)) &&
    list(value.required_streams, (item) => item === "audio" || item === "video");
}

function documentInput(value: RecordValue): boolean {
  return exact(
    value, ["family", "accepted_formats"], ["required_pdf_text_layer"],
  ) && value.family === "document" &&
    list(value.accepted_formats, (item) => oneOf(item, DOCUMENT_FORMATS)) &&
    (value.required_pdf_text_layer === undefined ||
      value.required_pdf_text_layer === "absent" ||
      value.required_pdf_text_layer === "present");
}

function subtitleInput(value: RecordValue): boolean {
  return exact(value, ["family", "accepted_formats"]) &&
    value.family === "subtitle" &&
    Array.isArray(value.accepted_formats) &&
    value.accepted_formats.length === 1 && value.accepted_formats[0] === "srt";
}

function contractInput(value: unknown): boolean {
  return record(value) &&
    (mediaInput(value) || documentInput(value) || subtitleInput(value));
}

function mediaOutput(value: RecordValue): boolean {
  return exact(value, ["family", "format", "streams"]) &&
    value.family === "media" && oneOf(value.format, MEDIA_FORMATS) &&
    list(value.streams, (item) => item === "audio" || item === "video");
}

function documentOutput(value: RecordValue): boolean {
  return exact(value, ["family", "format"], ["pdf_text_layer"]) &&
    value.family === "document" && oneOf(value.format, DOCUMENT_FORMATS) &&
    (value.pdf_text_layer === undefined || value.pdf_text_layer === "absent" ||
      value.pdf_text_layer === "present" || value.pdf_text_layer === "unknown");
}

function subtitleOutput(value: RecordValue): boolean {
  return exact(value, ["family", "format"]) &&
    value.family === "subtitle" && value.format === "srt";
}

function contractOutput(value: unknown): boolean {
  return record(value) &&
    (mediaOutput(value) || documentOutput(value) || subtitleOutput(value));
}

function contract(value: unknown): boolean {
  return exact(value, ["input", "output"]) &&
    contractInput(value.input) && contractOutput(value.output);
}

function catalogEntry(value: unknown): boolean {
  if (!record(value) || !text(value.workflow_id) ||
      (value.kind !== "atomic" && value.kind !== "composition") ||
      !boolean(value.eligible) || !integer(value.stage_count) ||
      !integer(value.command_count)) return false;
  return value.eligible
    ? exact(
      value,
      ["workflow_id", "kind", "eligible", "stage_count", "command_count", "contract"],
    ) && contract(value.contract)
    : exact(
      value,
      ["workflow_id", "kind", "eligible", "stage_count", "command_count", "reason"],
    ) && oneOf(value.reason, INELIGIBLE_REASONS);
}

function resource(value: unknown): boolean {
  return exact(value, ["id", "bytes", "sha256", "source"]) &&
    text(value.id) && integer(value.bytes) &&
    text(value.sha256) && text(value.source);
}

function compositionToolRequirement(value: unknown): boolean {
  return exact(value, ["tools", "command"]) &&
    strings(value.tools) && strings(value.command);
}

function planSummary(value: unknown): boolean {
  return exact(value, [
    "tool", "command_count", "output_path", "checks", "commands",
    "intermediates", "derivations",
  ]) && oneOf(value.tool, TOOLS) && integer(value.command_count) &&
    text(value.output_path) && strings(value.checks) &&
    stringLists(value.commands) && strings(value.intermediates) &&
    (value.derivations === null || derivations(value.derivations));
}

function savedSummary(value: unknown): boolean {
  return exact(value, ["workflow_id", "created_at", "stage_count", "contract"]) &&
    text(value.workflow_id) && text(value.created_at) &&
    integer(value.stage_count) && contract(value.contract);
}

function compositionDetailCheck(
  value: unknown,
  stageIndex: number,
  sourceId: string,
  checkIndex: number,
  checkIds: Set<string>,
): boolean {
  if (!exact(value, [
    "check_id", "stage_index", "check_index", "source_id", "name", "target",
  ]) || !text(value.check_id) || value.stage_index !== stageIndex ||
      value.check_index !== checkIndex || value.source_id !== sourceId ||
      !oneOf(value.name, CHECKS) || !checkTarget(value.target)) {
    return false;
  }
  const requiredId = `stage-${stageIndex}-check-${checkIndex}`;
  if (value.check_id !== requiredId || checkIds.has(value.check_id)) return false;
  checkIds.add(value.check_id);
  return true;
}

function compositionDetailStage(
  value: unknown,
  stageIndex: number,
  sourceIds: Set<string>,
  checkIds: Set<string>,
): number | undefined {
  if (!exact(value, [
    "stage_index", "source_id", "source_title", "tools", "resources",
    "command_templates", "output_template", "checks",
  ]) || value.stage_index !== stageIndex || !text(value.source_id) ||
      sourceIds.has(value.source_id) || !text(value.source_title) ||
      !strings(value.tools) || !strings(value.resources) ||
      !Array.isArray(value.command_templates) ||
      value.command_templates.length === 0 ||
      !value.command_templates.every((command) =>
        Array.isArray(command) && command.length > 0 && command.every(text)
      ) ||
      !text(value.output_template) || !Array.isArray(value.checks)) {
    return undefined;
  }
  for (let checkIndex = 0; checkIndex < value.checks.length; checkIndex += 1) {
    if (!compositionDetailCheck(
      value.checks[checkIndex], stageIndex, value.source_id, checkIndex, checkIds,
    )) return undefined;
  }
  sourceIds.add(value.source_id);
  return value.command_templates.length;
}

function compositionDetail(value: unknown): boolean {
  if (!exact(value, [
    "workflow_id", "title", "created_at", "stage_count", "command_count",
    "contract", "stages", "evidence", "history",
  ]) || !text(value.workflow_id) || !text(value.title) ||
      !text(value.created_at) || !integer(value.stage_count) ||
      !integer(value.command_count) || !contract(value.contract) ||
      !Array.isArray(value.stages) ||
      value.stage_count !== value.stages.length ||
      value.stage_count < 2 || value.stage_count > 8 ||
      value.command_count < 2 || value.command_count > 8 ||
      !Array.isArray(value.evidence) || value.evidence.length !== 0 ||
      !Array.isArray(value.history) || value.history.length !== 0) {
    return false;
  }
  const sourceIds = new Set<string>();
  const checkIds = new Set<string>();
  let commandCount = 0;
  for (let stageIndex = 0; stageIndex < value.stages.length; stageIndex += 1) {
    const stageCommandCount = compositionDetailStage(
      value.stages[stageIndex], stageIndex, sourceIds, checkIds,
    );
    if (stageCommandCount === undefined) return false;
    commandCount += stageCommandCount;
  }
  return commandCount === value.command_count;
}

function run(value: RecordValue, keys: string[], optional: string[] = []): boolean {
  return exact(value, ["type", "run_id", ...keys], optional) && text(value.run_id);
}

export function isWsServerEvent(value: unknown): value is WsServerEvent {
  if (!record(value) || !text(value.type)) return false;
  switch (value.type) {
    case "workflow_catalog":
      return exact(value, ["type", "workflows"]) && list(value.workflows, recipe);
    case "composable_catalog":
      return exact(value, ["type", "workflows"]) && list(value.workflows, catalogEntry);
    case "composition_detail":
      return exact(value, ["type", "detail"]) && compositionDetail(value.detail);
    case "run_started":
      return run(value, ["action", "files"]) &&
        (value.action === "task" || value.action === "recipe") && strings(value.files);
    case "composition_run_started":
      return run(value, ["action", "workflow_id"]) &&
        (value.action === "create" || value.action === "recipe") &&
        text(value.workflow_id);
    case "activity":
      return run(value, ["message"]) && text(value.message);
    case "model_call_count":
      return run(value, ["model_calls"]) && integer(value.model_calls);
    case "command_started":
      return run(value, ["argv"]) && strings(value.argv);
    case "command_completed":
      return run(value, ["exit_code", "duration_ms"]) &&
        integer(value.exit_code) && finite(value.duration_ms);
    case "verification_started":
      return run(value, []);
    case "verification_completed":
      return run(value, ["duration_ms"]) && finite(value.duration_ms);
    case "install_required":
      return run(value, ["tool", "command", "resources"]) &&
        (value.tool === null || text(value.tool)) &&
        (value.command === null || strings(value.command)) &&
        list(value.resources, resource);
    case "composition_install_required":
      return run(value, ["tools", "resources"]) &&
        list(value.tools, compositionToolRequirement) &&
        list(value.resources, resource);
    case "install_progress":
    case "composition_install_progress":
      return run(value, ["id", "received", "total", "percent"]) &&
        text(value.id) && finite(value.received) &&
        finite(value.total) && finite(value.percent);
    case "install_complete":
    case "composition_install_complete":
      return run(value, ["message"]) && text(value.message);
    case "composition_install_denied":
      return run(value, []);
    case "check_pending":
      return run(value, ["name"]) && text(value.name);
    case "check_result":
      return run(value, ["name", "pass", "expected", "actual"]) &&
        verification({
          name: value.name, pass: value.pass,
          expected: value.expected, actual: value.actual,
        });
    case "repair_attempt":
      return run(value, [
        "attempt", "previous_plan", "failed_checks", "stderr_tail",
      ]) && integer(value.attempt) && planSummary(value.previous_plan) &&
        list(value.failed_checks, verification) && text(value.stderr_tail);
    case "recipe_saved":
      return run(value, ["recipe"]) && recipe(value.recipe);
    case "recipe_matched":
      return run(value, ["name", "score", "model_calls"]) &&
        text(value.name) && finite(value.score) && value.model_calls === 0;
    case "workflow_selected":
    case "composition_selected":
      return run(value, ["workflow_id", "model_calls"]) &&
        text(value.workflow_id) && value.model_calls === 0;
    case "run_complete":
      return run(value, ["success"], ["output_path", "model_calls"]) &&
        boolean(value.success) &&
        (value.output_path === undefined || text(value.output_path)) &&
        (value.model_calls === undefined || integer(value.model_calls));
    case "error":
      return exact(value, ["type", "message"], ["run_id"]) &&
        text(value.message) && (value.run_id === undefined || text(value.run_id));
    case "composition_stage_started":
      return run(value, ["stage_index", "source_id"]) &&
        integer(value.stage_index) && text(value.source_id);
    case "composition_command_started":
      return run(value, ["stage_index", "source_id", "command_index"]) &&
        integer(value.stage_index) && text(value.source_id) &&
        integer(value.command_index);
    case "composition_command_completed":
      return run(value, [
        "stage_index", "source_id", "command_index", "exit_code", "duration_ms",
      ]) && integer(value.stage_index) && text(value.source_id) &&
        integer(value.command_index) && integer(value.exit_code) &&
        finite(value.duration_ms);
    case "composition_verification_started":
      return run(value, ["stage_index", "source_id"]) &&
        integer(value.stage_index) && text(value.source_id);
    case "composition_verification_completed":
      return run(value, ["stage_index", "source_id", "duration_ms"]) &&
        integer(value.stage_index) && text(value.source_id) &&
        finite(value.duration_ms);
    case "composition_check_pending":
      return run(value, ["stage_index", "source_id", "name"]) &&
        integer(value.stage_index) && text(value.source_id) && text(value.name);
    case "composition_check_result":
      return run(value, [
        "stage_index", "source_id", "name", "pass", "expected", "actual",
      ]) && integer(value.stage_index) && text(value.source_id) &&
        verification({
          name: value.name, pass: value.pass,
          expected: value.expected, actual: value.actual,
        });
    case "composition_cleanup":
      return run(value, ["success"], ["failed_actions"]) &&
        boolean(value.success) &&
        (value.failed_actions === undefined || strings(value.failed_actions));
    case "composition_saved":
      return run(value, ["workflow"]) && savedSummary(value.workflow);
    case "composition_run_complete":
      return run(value, ["success", "model_calls"], ["output_name"]) &&
        boolean(value.success) && value.model_calls === 0 &&
        (value.output_name === undefined || text(value.output_name));
    case "composition_error":
      return run(value, ["message"]) && text(value.message);
    default:
      return false;
  }
}
