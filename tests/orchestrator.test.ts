import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import matter from "gray-matter";
import { SandboxQueueProcessor, TaskRequest } from "../src/lib/SandboxQueueProcessor.js";
import { TaskStatus } from "../src/lib/TaskStatus.js";

function makeProcessor(featureRequestsDir: string): SandboxQueueProcessor {
  const p = new SandboxQueueProcessor("dummy-key");
  (p as any).featureRequestsDir = featureRequestsDir;
  return p;
}

function writeFrontmatter(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  return writeFile(filePath, matter.stringify("", data));
}

function makeTask(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    id: "AGI-1",
    file: "AGI-1.md",
    filePath: "/tmp/AGI-1.md",
    featureRequest: "FR-1",
    title: "Test Task",
    description: "Do something",
    repo: "https://github.com/test/repo",
    status: TaskStatus.Backlog,
    dependsOn: [],
    ...overrides,
  };
}

describe("Orchestrator", () => {
  let tmpDir: string;
  let processor: SandboxQueueProcessor;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `orchestrator-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    processor = makeProcessor(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("filterEligible", () => {
    it("returns only actionable tasks with satisfied dependencies", () => {
      const tasks: TaskRequest[] = [
        makeTask({ id: "AGI-1", status: TaskStatus.Done }),
        makeTask({ id: "AGI-2", status: TaskStatus.NeedsImplement, dependsOn: ["AGI-1"] }),
      ];

      const eligible = processor.filterEligible(tasks);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe("AGI-2");
    });

    it("skips tasks with unmet dependencies", () => {
      const tasks: TaskRequest[] = [
        makeTask({ id: "AGI-1", status: TaskStatus.NeedsImplement }),
        makeTask({ id: "AGI-2", status: TaskStatus.NeedsPlan, dependsOn: ["AGI-1"] }),
      ];

      const eligible = processor.filterEligible(tasks);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe("AGI-1");
    });

    it("treats Done and Canceled dependencies as satisfied", () => {
      const tasks: TaskRequest[] = [
        makeTask({ id: "AGI-1", status: TaskStatus.Done }),
        makeTask({ id: "AGI-2", status: TaskStatus.Canceled }),
        makeTask({
          id: "AGI-3",
          status: TaskStatus.NeedsResearch,
          dependsOn: ["AGI-1", "AGI-2"],
        }),
      ];

      const eligible = processor.filterEligible(tasks);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe("AGI-3");
    });

    it("skips non-actionable statuses (InProgress, Done, intervention)", () => {
      const tasks: TaskRequest[] = [
        makeTask({ id: "AGI-1", status: TaskStatus.ImplementInProgress }),
        makeTask({ id: "AGI-2", status: TaskStatus.Done }),
        makeTask({ id: "AGI-3", status: TaskStatus.Blocked }),
        makeTask({ id: "AGI-4", status: TaskStatus.NeedsHumanReview }),
        makeTask({ id: "AGI-5", status: TaskStatus.NeedsImplement }),
      ];

      const eligible = processor.filterEligible(tasks);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe("AGI-5");
    });

    it("treats unknown dependencies as satisfied", () => {
      const tasks: TaskRequest[] = [
        makeTask({ id: "AGI-1", status: TaskStatus.NeedsResearch, dependsOn: ["AGI-999"] }),
      ];

      const eligible = processor.filterEligible(tasks);
      expect(eligible).toHaveLength(1);
    });
  });

  describe("isTerminal", () => {
    it("returns true for tasks with no downstream dependents", () => {
      const tasks: TaskRequest[] = [
        makeTask({ id: "AGI-1" }),
        makeTask({ id: "AGI-2" }),
      ];

      expect(processor.isTerminal(tasks[0], tasks)).toBe(true);
      expect(processor.isTerminal(tasks[1], tasks)).toBe(true);
    });

    it("returns false for tasks that others depend on", () => {
      const tasks: TaskRequest[] = [
        makeTask({ id: "AGI-1" }),
        makeTask({ id: "AGI-2", dependsOn: ["AGI-1"] }),
      ];

      expect(processor.isTerminal(tasks[0], tasks)).toBe(false);
      expect(processor.isTerminal(tasks[1], tasks)).toBe(true);
    });

    it("handles multi-level dependency chains", () => {
      const tasks: TaskRequest[] = [
        makeTask({ id: "AGI-1" }),
        makeTask({ id: "AGI-2", dependsOn: ["AGI-1"] }),
        makeTask({ id: "AGI-3", dependsOn: ["AGI-2"] }),
      ];

      expect(processor.isTerminal(tasks[0], tasks)).toBe(false);
      expect(processor.isTerminal(tasks[1], tasks)).toBe(false);
      expect(processor.isTerminal(tasks[2], tasks)).toBe(true);
    });
  });

  describe("branchName", () => {
    it("returns feat/{group} for grouped tasks", () => {
      const task = makeTask({ group: "login-auth" });
      expect(processor.branchName(task)).toBe("feat/login-auth");
    });

    it("returns feat/{id} for standalone tasks", () => {
      const task = makeTask({ id: "AGI-42" });
      expect(processor.branchName(task)).toBe("feat/AGI-42");
    });

    it("prefers group over id when both present", () => {
      const task = makeTask({ id: "AGI-1", group: "my-group" });
      expect(processor.branchName(task)).toBe("feat/my-group");
    });
  });

  describe("loadAllTasks - nested discovery", () => {
    it("discovers tasks in nested feature_requests/FR-*/AGI-*.md structure", async () => {
      const fr1 = join(tmpDir, "FR-1");
      const fr2 = join(tmpDir, "FR-2");
      await mkdir(fr1, { recursive: true });
      await mkdir(fr2, { recursive: true });

      await writeFrontmatter(join(fr1, "AGI-1.md"), {
        id: "AGI-1",
        title: "Task A",
        description: "First",
        repo: "https://github.com/test/repo",
        status: "Needs Research",
      });
      await writeFrontmatter(join(fr2, "AGI-2.md"), {
        id: "AGI-2",
        title: "Task B",
        description: "Second",
        repo: "https://github.com/test/repo",
        status: "Needs Implement",
        dependsOn: ["AGI-1"],
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(2);

      const taskA = tasks.find((t) => t.id === "AGI-1")!;
      expect(taskA.featureRequest).toBe("FR-1");
      expect(taskA.status).toBe("Needs Research");

      const taskB = tasks.find((t) => t.id === "AGI-2")!;
      expect(taskB.featureRequest).toBe("FR-2");
      expect(taskB.status).toBe("Needs Implement");
      expect(taskB.dependsOn).toEqual(["AGI-1"]);
    });

    it("maps status strings to TaskStatus enum correctly", async () => {
      const fr = join(tmpDir, "FR-1");
      await mkdir(fr, { recursive: true });

      const statuses = [
        "Backlog",
        "Needs Research",
        "Implement In Progress",
        "Done",
        "Blocked",
      ];

      for (let i = 0; i < statuses.length; i++) {
        await writeFrontmatter(join(fr, `AGI-${i + 1}.md`), {
          id: `AGI-${i + 1}`,
          title: `Task ${i + 1}`,
          description: "Test",
          repo: "https://github.com/test/repo",
          status: statuses[i],
        });
      }

      const tasks = await processor.loadAllTasks();
      const taskStatuses = tasks.sort((a, b) => a.id.localeCompare(b.id)).map((t) => t.status);
      expect(taskStatuses).toEqual([
        TaskStatus.Backlog,
        TaskStatus.NeedsResearch,
        TaskStatus.ImplementInProgress,
        TaskStatus.Done,
        TaskStatus.Blocked,
      ]);
    });
  });
});
