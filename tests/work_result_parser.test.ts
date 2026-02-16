import { describe, it, expect } from "vitest";
import { TaskStatus } from "../src/lib/TaskStatus.js";
import {
  parseWorkResult,
  resolveNextStatus,
} from "../src/lib/WorkResultParser.js";

describe("WorkResultParser", () => {
  describe("resolveNextStatus", () => {
    it("maps plain status strings to TaskStatus", () => {
      expect(resolveNextStatus("Needs Plan")).toBe(TaskStatus.NeedsPlan);
      expect(resolveNextStatus("Done")).toBe(TaskStatus.Done);
    });

    it("strips ∞ prefix", () => {
      expect(resolveNextStatus("∞ Needs Specification")).toBe(
        TaskStatus.NeedsSpecification
      );
      expect(resolveNextStatus("∞ Blocked")).toBe(TaskStatus.Blocked);
    });

    it("strips surrounding quotes", () => {
      expect(resolveNextStatus('"∞ Needs Plan"')).toBe(TaskStatus.NeedsPlan);
      expect(resolveNextStatus("'Done'")).toBe(TaskStatus.Done);
    });

    it("returns null on unknown status", () => {
      expect(resolveNextStatus("Nonexistent")).toBeNull();
      expect(resolveNextStatus("Ready for Review")).toBeNull();
    });
  });

  describe("parseWorkResult", () => {
    it("returns null when no WORK_RESULT marker found", () => {
      expect(parseWorkResult("just some output")).toBeNull();
    });

    it("parses a successful research result", () => {
      const output = `Some log output...

WORK_RESULT:
  success: true
  stage_completed: research
  branch_name: feat/AGI-1
  commit_hash: abc1234
  next_status: "∞ Needs Plan"
  summary: |
    Researched the codebase and documented findings.
`;
      const result = parseWorkResult(output)!;
      expect(result).not.toBeNull();
      expect(result.success).toBe(true);
      expect(result.stageCompleted).toBe("research");
      expect(result.branchName).toBe("feat/AGI-1");
      expect(result.commitHash).toBe("abc1234");
      expect(result.nextStatus).toBe(TaskStatus.NeedsPlan);
      expect(result.summary).toContain("Researched");
    });

    it("parses a failed result with error", () => {
      const output = `WORK_RESULT:
  success: false
  stage_completed: implement
  error: |
    Failed during Phase 2: tests broke.
`;
      const result = parseWorkResult(output)!;
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed during Phase 2");
    });

    it("parses PR creation result", () => {
      const output = `WORK_RESULT:
  success: true
  stage_completed: validate
  branch_name: feat/AGI-5
  merge_status: pr_created
  pr_url: https://github.com/org/repo/pull/42
  next_status: "∞ Awaiting Merge"
  summary: All checks pass. PR created.
`;
      const result = parseWorkResult(output)!;
      expect(result.mergeStatus).toBe("pr_created");
      expect(result.prUrl).toBe("https://github.com/org/repo/pull/42");
      expect(result.nextStatus).toBe(TaskStatus.AwaitingMerge);
    });

    it("parses artifact_path into result.artifactPath", () => {
      const output = `WORK_RESULT:
  success: true
  stage_completed: research
  branch_name: dawn/AGI-4
  artifact_path: dawn-docs/active/research/2026-02-15-AGI-4-feature-slug.md
  commit_hash: def5678
  next_status: "∞ Needs Plan"
  summary: Researched and documented.
`;
      const result = parseWorkResult(output)!;
      expect(result).not.toBeNull();
      expect(result.artifactPath).toBe(
        "dawn-docs/active/research/2026-02-15-AGI-4-feature-slug.md"
      );
      expect(result.stageCompleted).toBe("research");
      expect(result.success).toBe(true);
    });

    it("parses preview_url into result.previewUrl", () => {
      const output = `WORK_RESULT:
  success: true
  stage_completed: implement
  branch_name: dawn/AGI-7
  preview_url: https://3000-eyJhbGci.proxy.daytona.works
  commit_hash: abc1234
  next_status: "∞ Needs Validate"
  summary: Implemented with live preview running.
`;
      const result = parseWorkResult(output)!;
      expect(result).not.toBeNull();
      expect(result.previewUrl).toBe(
        "https://3000-eyJhbGci.proxy.daytona.works"
      );
      expect(result.success).toBe(true);
    });

    it("uses the LAST WORK_RESULT block if multiple exist", () => {
      const output = `WORK_RESULT:
  success: false
  error: first attempt failed

More output...

WORK_RESULT:
  success: true
  stage_completed: oneshot
  next_status: Done
  summary: Completed on retry.
`;
      const result = parseWorkResult(output)!;
      expect(result.success).toBe(true);
      expect(result.stageCompleted).toBe("oneshot");
    });
  });
});
