import { describe, expect, test } from "bun:test";
import type { CompositionDetail } from "../../../server/ws-composition-events.ts";
import type { CompositionCommand } from "./composition-model.ts";
import {
  compositionDetailRows, compositionFromDetail, exportAvailability,
} from "./composition-model.ts";

const command: CompositionCommand = {
  kind: "composition",
  name: "media-chain",
  created_at: "2026-07-19T00:00:00.000Z",
  stage_count: 2,
  composition_contract: {
    input: {
      family: "media", accepted_formats: ["mov"], required_streams: ["video"],
    },
    output: { family: "subtitle", format: "srt" },
  },
  stages: [
    {
      stage_index: 0, source_id: "convert-media-to-mp4",
      tool: "ffmpeg", install_weight: "light",
      command_template: {
        commands: [["ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/out.mp4"]],
        output_path: "{{input_0_dir}}/out.mp4",
      },
      checks: [{ type: "plays", target: true }],
      composition_contract: {
        input: {
          family: "media", accepted_formats: ["mov"], required_streams: ["video"],
        },
        output: { family: "media", format: "mp4", streams: ["video"] },
      },
    },
    {
      stage_index: 1, source_id: "transcribe-video-to-srt",
      tool: "whisper-cli", install_weight: "heavy",
      command_template: {
        commands: [["whisper-cli", "-f", "{{input_0}}", "-of", "{{input_0_dir}}/out"]],
        output_path: "{{input_0_dir}}/out.srt",
      },
      checks: [{ type: "srt_valid", target: true }],
      composition_contract: {
        input: {
          family: "media", accepted_formats: ["mp4"], required_streams: ["video"],
        },
        output: { family: "subtitle", format: "srt" },
      },
    },
  ],
};

const authoritativeDetail: CompositionDetail = {
  workflow_id: "media-chain",
  title: "Media Chain",
  created_at: "2026-07-19T00:00:00.000Z",
  stage_count: 2,
  command_count: 2,
  contract: {
    input: {
      family: "media", accepted_formats: ["mov"], required_streams: ["video"],
    },
    output: { family: "subtitle", format: "srt" },
  },
  stages: [
    {
      stage_index: 0,
      source_id: "convert-media-to-mp4",
      source_title: "Convert Media To Mp4",
      tools: ["ffmpeg"],
      resources: [],
      command_templates: [
        ["ffmpeg", "-i", "{{input_0}}", "{{input_0_dir}}/out.mp4"],
      ],
      output_template: "{{input_0_dir}}/out.mp4",
      checks: [{
        check_id: "stage-0-check-0",
        stage_index: 0,
        check_index: 0,
        source_id: "convert-media-to-mp4",
        name: "plays",
        target: true,
      }],
    },
    {
      stage_index: 1,
      source_id: "transcribe-video-to-srt",
      source_title: "Transcribe Video To Srt",
      tools: ["ffmpeg", "whisper-cli"],
      resources: ["whisper-large-v3-turbo"],
      command_templates: [
        ["whisper-cli", "-f", "{{input_0}}", "-of", "{{input_0_dir}}/out"],
      ],
      output_template: "{{input_0_dir}}/out.srt",
      checks: [{
        check_id: "stage-1-check-0",
        stage_index: 1,
        check_index: 0,
        source_id: "transcribe-video-to-srt",
        name: "srt_valid",
        target: true,
      }],
    },
  ],
  evidence: [],
  history: [],
};

describe("combined saved-command detail", () => {
  test("never turns locally assembled run snapshots into saved detail rows", () => {
    expect(command.detail).toBeUndefined();
    expect(command.stages).toHaveLength(2);
    expect(compositionDetailRows(command)).toEqual([]);
  });

  test("keeps saved detail unavailable until authoritative detail arrives", () => {
    const unavailable: CompositionCommand = {
      ...command,
      stages: command.stages.map((stage) => structuredClone(stage)),
    };
    expect(compositionDetailRows(unavailable)).toEqual([]);

    const authoritative = compositionFromDetail(
      authoritativeDetail, unavailable.stages,
    );
    expect(authoritative.detail).toEqual(authoritativeDetail);
    expect(compositionDetailRows(authoritative)).toHaveLength(2);
  });

  test("disables both exports with an honest managed-handoff reason", () => {
    expect(exportAvailability(command)).toEqual({
      script: false,
      raycast: false,
      reason: "Combined commands use managed and verified stage handoffs inside Steward.",
    });
  });

  test("hydrates fresh-browser catalog detail only from the authoritative event", () => {
    const loaded = compositionFromDetail(authoritativeDetail);
    expect(loaded.stages).toEqual([]);
    expect(loaded.detail).toEqual(authoritativeDetail);
    expect(compositionDetailRows(loaded)).toEqual([
      expect.objectContaining({
        stageIndex: 0, sourceId: "convert-media-to-mp4",
        sourceTitle: "Convert Media To Mp4", tools: ["ffmpeg"],
      }),
      expect.objectContaining({
        stageIndex: 1, sourceId: "transcribe-video-to-srt",
        sourceTitle: "Transcribe Video To Srt",
        tools: ["ffmpeg", "whisper-cli"],
        resources: ["whisper-large-v3-turbo"],
      }),
    ]);
  });

  test("preserves authoritative flattened order and duplicate check identity", () => {
    const nested: CompositionDetail = {
      ...authoritativeDetail,
      workflow_id: "nested-chain",
      title: "Nested Chain",
      stage_count: 3,
      command_count: 3,
      stages: [
        ...authoritativeDetail.stages,
        {
          ...authoritativeDetail.stages[1],
          stage_index: 2,
          checks: [{
            check_id: "stage-2-check-0",
            stage_index: 2,
            check_index: 0,
            source_id: "transcribe-video-to-srt",
            name: "srt_valid",
            target: true,
          }],
        },
      ],
    };
    const rows = compositionDetailRows(compositionFromDetail(nested));
    expect(rows.map(({ stageIndex, sourceId }) => ({ stageIndex, sourceId }))).toEqual([
      { stageIndex: 0, sourceId: "convert-media-to-mp4" },
      { stageIndex: 1, sourceId: "transcribe-video-to-srt" },
      { stageIndex: 2, sourceId: "transcribe-video-to-srt" },
    ]);
    expect(rows.flatMap((stage) => stage.checks)
      .filter((check) => check.name === "srt_valid")
      .map((check) => check.checkId)).toEqual([
        "stage-1-check-0", "stage-2-check-0",
      ]);
  });
});
