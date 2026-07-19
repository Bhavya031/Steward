import { describe, expect, test } from "bun:test";
import type { ComposableCatalogEntry } from "../../../server/composition-catalog.ts";
import {
  addSelection, canRunComposition, canonicalCompositionName, compatibilityRows,
  ineligibleReason, moveSelection, removeSelection,
} from "./composition-flow.ts";

const input = {
  family: "media" as const, accepted_formats: ["mp4" as const],
  required_streams: ["video" as const],
};
const output = {
  family: "media" as const, format: "mp4" as const,
  streams: ["video" as const, "audio" as const],
};
const eligible = (id: string): ComposableCatalogEntry => ({
  workflow_id: id, kind: "atomic", eligible: true,
  stage_count: 1, command_count: 1, contract: { input, output },
});
const catalog: ComposableCatalogEntry[] = [
  eligible("first-command"),
  eligible("second-command"),
  eligible("third-command"),
  {
    workflow_id: "pdf-command", kind: "atomic", eligible: true,
    stage_count: 1, command_count: 1,
    contract: {
      input: { family: "document", accepted_formats: ["pdf"] },
      output: { family: "document", format: "pdf", pdf_text_layer: "present" },
    },
  },
  {
    workflow_id: "ambiguous-command", kind: "atomic", eligible: false,
    stage_count: 1, command_count: 1,
    reason: "ambiguous_or_unsupported_contract",
  },
];

describe("Past Tasks composition selection", () => {
  test("renders server eligibility and honest ineligibility copy", () => {
    expect(ineligibleReason(catalog[0]!)).toBeUndefined();
    expect(ineligibleReason(catalog.at(-1)!))
      .toBe("Input or output format is not explicit enough to combine safely.");
  });

  test("selects, deselects, reorders, and refuses a ninth command", () => {
    let selected = addSelection([], "first-command", catalog);
    selected = addSelection(selected, "second-command", catalog);
    selected = addSelection(selected, "third-command", catalog);
    expect(moveSelection(selected, 2, -1)).toEqual([
      "first-command", "third-command", "second-command",
    ]);
    expect(removeSelection(selected, "second-command")).toEqual([
      "first-command", "third-command",
    ]);
    const eight = Array.from({ length: 8 }, (_, index) => eligible(`command-${index}`));
    let full: string[] = [];
    for (const item of eight) full = addSelection(full, item.workflow_id, eight);
    expect(full).toHaveLength(8);
    expect(() => addSelection(full, "ninth-command", [...eight, eligible("ninth-command")]))
      .toThrow("no more than eight");
  });

  test("shows every adjacent handoff and blocks incompatible order", () => {
    expect(compatibilityRows(
      ["first-command", "second-command", "third-command"], catalog,
    )).toEqual([
      { from: "first-command", to: "second-command", compatible: true },
      { from: "second-command", to: "third-command", compatible: true },
    ]);
    const rows = compatibilityRows(["first-command", "pdf-command"], catalog);
    expect(rows).toEqual([expect.objectContaining({
      from: "first-command", to: "pdf-command", compatible: false,
    })]);
    expect(canRunComposition(
      "media-chain", ["first-command", "pdf-command"],
      [new File(["x"], "input.mov")], catalog, false,
    )).toBe(false);
  });

  test("requires a canonical name, 2–8 selections, and exactly one file", () => {
    const file = new File(["x"], "input.mov");
    expect(canonicalCompositionName("  media-chain  ")).toBe("media-chain");
    expect(canonicalCompositionName("Media Chain")).toBeUndefined();
    expect(canRunComposition(
      "media-chain", ["first-command", "second-command"], [file], catalog, false,
    )).toBe(true);
    expect(canRunComposition(
      "media-chain", ["first-command"], [file], catalog, false,
    )).toBe(false);
    expect(canRunComposition(
      "media-chain", ["first-command", "second-command"], [file, file], catalog, false,
    )).toBe(false);
  });
});
