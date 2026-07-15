import {
  checkedValue, classifySimple, matches, oneOf, pathValue,
  type ClassifiedPath, type ToolFlagRules,
} from "./flag-policy-core.ts";

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
  switches: new Set(["-otxt", "-osrt", "-ovtt", "-oj", "--translate", "--no-timestamps"]),
  values: new Map([
    ["-m", pathValue("input")], ["-f", pathValue("input")], ["-of", pathValue("output")],
    ["-l", checkedValue(matches(/^(?:auto|[a-z]{2,3})$/))],
    ["-t", checkedValue(integer)], ["-p", checkedValue(integer)],
  ]),
  positionals: null, minPositionals: 0, maxPositionals: 0,
};

export function classifyMediaTool(tool: "ffprobe" | "magick" | "whisper-cli", command: string[]): ClassifiedPath[] {
  return classifySimple(command, tool === "ffprobe" ? ffprobe : tool === "magick" ? magick : whisper);
}
