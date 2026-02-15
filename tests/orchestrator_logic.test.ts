import { describe, it, expect } from "vitest";
import { SandboxQueueProcessor, TaskRequest } from "../src/lib/SandboxQueueProcessor.js";
import { TaskStatus } from "../src/lib/TaskStatus.js";

function makeTask(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    id: "AGI-1",
    file: "test.md",
    filePath: "/tmp/test.md",
    title: "Test",
    description: "A test task",
    repo: "https://github.com/test/repo",
    status: TaskStatus.NeedsResearch,
    dependsOn: [],
    ...overrides,
  };
}

describe("Orchestrator logic", () => {
  const processor = new SandboxQueueProcessor("dummy-key");

  describe("filterEligible", () => {
    it("returns actionable tasks not in active set", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.NeedsResearch }),
        makeTask({ id: "AGI-2", status: TaskStatus.Done }),
        makeTask({ id: "AGI-3", status: TaskStatus.NeedsImplement }),
      ];
      const eligible = processor.filterEligible(tasks, new Set());
      expect(eligible.map((t) => t.id)).toEqual(["AGI-1", "AGI-3"]);
    });

    it("excludes tasks already in the active set", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.NeedsResearch }),
      ];
      const eligible = processor.filterEligible(tasks, new Set(["AGI-1"]));
      expect(eligible).toHaveLength(0);
    });

    it("excludes tasks with unmet dependencies", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.Done }),
        makeTask({ id: "AGI-2", status: TaskStatus.NeedsImplement, dependsOn: ["AGI-1"] }),
        makeTask({ id: "AGI-3", status: TaskStatus.NeedsResearch, dependsOn: ["AGI-4"] }),
      ];
      const eligible = processor.filterEligible(tasks, new Set());
      // AGI-2 is eligible (dep AGI-1 is Done), AGI-3 is not (dep AGI-4 not found/not Done)
      expect(eligible.map((t) => t.id)).toEqual(["AGI-2"]);
    });

    it("returns empty for no actionable tasks", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.Done }),
        makeTask({ id: "AGI-2", status: TaskStatus.Blocked }),
      ];
      expect(processor.filterEligible(tasks, new Set())).toHaveLength(0);
    });
  });

  describe("isTerminal", () => {
    it("returns true when no non-Done task depends on this one", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.Done }),
        makeTask({ id: "AGI-2", status: TaskStatus.Done, dependsOn: ["AGI-1"] }),
      ];
      expect(processor.isTerminal(tasks[0], tasks)).toBe(true);
    });

    it("returns false when a non-Done task depends on this one", () => {
      const tasks = [
        makeTask({ id: "AGI-1", status: TaskStatus.NeedsResearch }),
        makeTask({ id: "AGI-2", status: TaskStatus.NeedsImplement, dependsOn: ["AGI-1"] }),
      ];
      expect(processor.isTerminal(tasks[0], tasks)).toBe(false);
    });

    it("returns true for standalone tasks", () => {
      const tasks = [makeTask({ id: "AGI-1" })];
      expect(processor.isTerminal(tasks[0], tasks)).toBe(true);
    });
  });

  describe("branchName", () => {
    it("uses group when present", () => {
      const task = makeTask({ group: "auth" });
      expect(processor.branchName(task)).toBe("feat/auth");
    });

    it("falls back to id when no group", () => {
      const task = makeTask({ id: "AGI-5" });
      expect(processor.branchName(task)).toBe("feat/AGI-5");
    });
  });
});
