import { ExecutionError } from "./execution-types.ts";
import {
  checkedValue, classifySimple, matches, oneOf, pathValue,
  type ClassifiedPath, type ToolFlagRules,
} from "./flag-policy-core.ts";

const integer = matches(/^\d+$/);
const decimal = matches(/^\d+(?:\.\d+)?$/);
const bitrate = matches(/^\d+(?:\.\d+)?[kKmM]?$/);
const time = matches(/^(?:\d+:)?(?:\d+:)?\d+(?:\.\d+)?$/);
const map = matches(/^0(?::[vasd](?::\d+)?)?\??$/);
const loudnorm = (value: string): boolean => {
  if (!value.startsWith("loudnorm=")) return false;
  return !/[;,]/.test(value) && value.slice("loudnorm=".length).split(":").every((part) =>
    /^(?:I|TP|LRA|measured_I|measured_TP|measured_LRA|measured_thresh|offset)=-?\d+(?:\.\d+)?$/.test(part) ||
    /^(?:linear)=(?:true|false)$/.test(part) || /^(?:print_format)=(?:json|summary)$/.test(part)
  );
};
const videoFilter = matches(/^(?:scale=-?\d+:-?\d+|fps=\d+(?:\.\d+)?|format=(?:yuv420p|yuv422p|yuv444p)|transpose=[0-3])$/);

const rules: ToolFlagRules = {
  switches: new Set(["-an", "-vn", "-sn", "-dn", "-nostdin", "-hide_banner", "-shortest"]),
  values: new Map([
    ["-i", pathValue("input")], ["-passlogfile", pathValue("temporary", true)],
    ["-loglevel", checkedValue(oneOf("quiet", "panic", "fatal", "error", "warning", "info"))],
    ["-map", checkedValue(map)], ["-c", checkedValue(oneOf("copy"))],
    ["-c:v", checkedValue(oneOf("copy", "libx264", "libx265", "vp9", "libvpx-vp9"))],
    ["-c:a", checkedValue(oneOf("copy", "aac", "libmp3lame", "flac", "pcm_s16le", "pcm_s24le", "libopus"))],
    ["-preset", checkedValue(oneOf("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"))],
    ["-crf", checkedValue(matches(/^(?:[0-9]|[1-4]\d|5[01])$/))],
    ["-b:v", checkedValue(bitrate)], ["-b:a", checkedValue(bitrate)],
    ["-maxrate", checkedValue(bitrate)], ["-bufsize", checkedValue(bitrate)],
    ["-pass", checkedValue(oneOf("1", "2"))],
    ["-f", checkedValue(oneOf("null", "mp4", "mov", "matroska", "webm", "mp3", "wav", "flac", "ogg", "ipod", "adts"), true)],
    ["-pix_fmt", checkedValue(oneOf("yuv420p", "yuv422p", "yuv444p", "gray"))],
    ["-movflags", checkedValue(oneOf("+faststart"))], ["-t", checkedValue(time)],
    ["-ss", checkedValue(time)], ["-to", checkedValue(time)], ["-fs", checkedValue(integer)],
    ["-ar", checkedValue(integer)], ["-ac", checkedValue(integer)], ["-r", checkedValue(decimal)],
    ["-sample_fmt", checkedValue(oneOf("s16", "s32", "flt", "dbl"))],
    ["-af", checkedValue(loudnorm)], ["-filter:a", checkedValue(loudnorm)],
    ["-vf", checkedValue(videoFilter)], ["-filter:v", checkedValue(videoFilter)],
    ["-map_metadata", checkedValue(oneOf("-1"))], ["-threads", checkedValue(integer)],
  ]),
  positionals: "output", minPositionals: 1,
};

function formatUses(command: string[]): Array<{ index: number; value: string }> {
  const uses: Array<{ index: number; value: string }> = [];
  for (let index = 1; index < command.length; index += 1) {
    if (command[index] === "-f") uses.push({ index, value: command[index + 1] ?? "" });
    else if (command[index]!.startsWith("-f=")) uses.push({ index, value: command[index]!.slice(3) });
  }
  return uses;
}

export function classifyFfmpeg(command: string[]): ClassifiedPath[] {
  const paths = classifySimple(command, rules);
  for (const format of formatUses(command)) {
    const target = paths.find((path) => path.index > format.index && path.role !== "temporary");
    if (!target || target.role === "input") {
      throw new ExecutionError("ffmpeg input formats and unbound -f outputs are not allowed");
    }
    if (format.value === "null") target.role = "temporary";
  }
  return paths;
}
