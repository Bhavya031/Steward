import {
  checkedValue, classifySimple, matches, oneOf, pathValue,
  type ClassifiedPath, type ToolFlagRules,
} from "./flag-policy-core.ts";
import { ExecutionError } from "./execution-types.ts";

const integer = matches(/^\d+$/);
const ffprobe: ToolFlagRules = {
  switches: new Set(["-show_format", "-show_streams", "-count_frames"]),
  values: new Map([
    ["-v", checkedValue(oneOf("quiet", "error", "warning"))],
    ["-of", checkedValue(oneOf("json", "compact", "default"))],
    ["-show_entries", checkedValue(matches(/^(?:format|stream)=[a-z_,:]+$/))],
  ]),
  positionals: ["input"], minPositionals: 1, maxPositionals: 1,
};

const magick: ToolFlagRules = {
  switches: new Set(["-strip", "-auto-orient", "-flatten"]),
  values: new Map([
    ["-resize", checkedValue(matches(/^\d*x\d*[!^<>]?$|^\d+%$/))],
    ["-thumbnail", checkedValue(matches(/^\d*x\d*[!^<>]?$|^\d+%$/))],
    ["-quality", checkedValue(matches(/^(?:100|[1-9]?\d)$/))],
    ["-colorspace", checkedValue(oneOf("sRGB", "RGB", "Gray"))],
    ["-density", checkedValue(integer)], ["-alpha", checkedValue(oneOf("on", "off", "remove"))],
    ["-gravity", checkedValue(oneOf("Center", "North", "South", "East", "West"))],
    ["-extent", checkedValue(matches(/^\d+x\d+$/))],
  ]),
  positionals: ["input", "output"], minPositionals: 2, maxPositionals: 2,
};

const whisper: ToolFlagRules = {
  switches: new Set([
    "-osrt", "--translate", "--no-timestamps", "--print-progress",
  ]),
  values: new Map([
    ["-m", pathValue("input")], ["-f", pathValue("input")],
    ["-of", pathValue("output-prefix")],
    ["-l", checkedValue(matches(/^(?:auto|[a-z]{2,3})$/))],
    ["-t", checkedValue(integer)], ["-p", checkedValue(integer)],
  ]),
  positionals: null, minPositionals: 0, maxPositionals: 0,
};
const whisperOutputFormats = new Set(["-otxt", "-osrt", "-ovtt", "-oj"]);

export function classifyMediaTool(tool: "ffprobe" | "magick" | "whisper-cli", command: string[]): ClassifiedPath[] {
  if (tool === "whisper-cli") {
    const formats = command.filter((argument) => whisperOutputFormats.has(argument));
    if (formats.length !== 1 || formats[0] !== "-osrt") {
      throw new ExecutionError("whisper-cli requires exactly one output format: -osrt");
    }
    if (command.filter((argument) => argument === "-of").length !== 1) {
      throw new ExecutionError("whisper-cli requires exactly one -of output prefix");
    }
  }
  const paths = classifySimple(command, tool === "ffprobe" ? ffprobe : tool === "magick" ? magick : whisper);
  if (tool === "whisper-cli") {
    if (paths.filter((path) => path.role === "output-prefix").length !== 1) {
      throw new ExecutionError("whisper-cli requires exactly one -of output prefix");
    }
  }
  return paths;
}
