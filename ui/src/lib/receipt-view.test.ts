import { describe, expect, test } from "bun:test";
import { createRunProgress, reduceClientEvent, reduceServerEvent } from "./run-progress.ts";
import { scriptText } from "./receipt-view.ts";

describe("saved-workflow script export", () => {
  test("keeps quoted $1 support with a separate static macOS picker wrapper", () => {
    let progress = reduceClientEvent(createRunProgress(), {
      type: "run_saved_workflow",
      workflow_id: "copy-video",
      files: ["/private/tmp/staged/source clip.mov"],
    });
    progress = reduceServerEvent(progress, {
      type: "command_started",
      run_id: "run-1",
      argv: [
        "ffmpeg", "-i", "/private/tmp/staged/source clip.mov",
        "-c", "copy", "/private/tmp/staged/source clip-copy.mp4",
      ],
    }, 100);

    const script = scriptText(progress, "copy-video");
    expect(script).toContain('if [ "$#" -eq 0 ]; then');
    expect(script).toContain("/usr/bin/osascript <<'STEWARD_PICKER'");
    expect(script).toContain(
      'POSIX path of (choose file with prompt "Choose a file for this Steward workflow")',
    );
    expect(script).toContain(
      `'ffmpeg' '-i' "$1" '-c' 'copy' '/private/tmp/staged/source clip-copy.mp4'`,
    );
    expect(script).not.toContain("/private/tmp/staged/source clip.mov");
    expect(script).not.toMatch(/\beval\b/);
    expect(script.indexOf("# Trusted input wrapper"))
      .toBeLessThan(script.indexOf("# Exact verified transformation commands"));
    expect(script.match(/'ffmpeg'/g)).toHaveLength(1);
  });

  test("quotes every non-input argv without command substitution", () => {
    let progress = reduceClientEvent(createRunProgress(), {
      type: "run_saved_workflow",
      workflow_id: "safe-copy",
      files: ["/tmp/$(touch bad).mov"],
    });
    progress = reduceServerEvent(progress, {
      type: "command_started",
      run_id: "run-2",
      argv: ["ffmpeg", "-i", "/tmp/$(touch bad).mov", "/tmp/owner's output.mp4"],
    }, 100);
    const script = scriptText(progress, "safe-copy");
    expect(script).toContain(
      `'ffmpeg' '-i' "$1" '/tmp/owner'\\''s output.mp4'`,
    );
    expect(script).not.toContain("$(touch bad)");
  });
});
