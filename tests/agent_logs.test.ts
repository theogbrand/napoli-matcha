import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import matter from "gray-matter";
import { SandboxQueueProcessor } from "../src/lib/SandboxQueueProcessor.js";
import { TaskStatus } from "../src/lib/TaskStatus.js";

function makeProcessor(queueDir: string): SandboxQueueProcessor {
  const p = new SandboxQueueProcessor("dummy-key");
  (p as any).queueDir = queueDir;
  return p;
}

function writeFrontmatter(
  filePath: string,
  data: Record<string, unknown>
): Promise<void> {
  return writeFile(filePath, matter.stringify("", data));
}

describe("Agent logs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `agent-logs-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadAllTasks - ID assignment", () => {
    let processor: SandboxQueueProcessor;
    let queueDir: string;

    beforeEach(async () => {
      queueDir = join(tmpDir, "queue");
      await mkdir(queueDir, { recursive: true });
      processor = makeProcessor(queueDir);
    });

    it("assigns AGI-1 to a task with no ID", async () => {
      await writeFrontmatter(join(queueDir, "task.md"), {
        title: "Test Task",
        description: "Do something",
        repo: "https://github.com/test/repo",
        status: "Needs Research",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-1");

      const { data } = matter(await readFile(join(queueDir, "task.md"), "utf-8"));
      expect(data.id).toBe("AGI-1");
    });

    it("continues from the highest existing AGI-{n} across all files", async () => {
      await writeFrontmatter(join(queueDir, "done.md"), {
        id: "AGI-5",
        title: "Done Task",
        description: "Already done",
        repo: "https://github.com/test/repo",
        status: "Done",
      });
      await writeFrontmatter(join(queueDir, "new.md"), {
        title: "New Task",
        description: "Needs ID",
        repo: "https://github.com/test/repo",
        status: "Needs Research",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(2);

      const newTask = tasks.find((t) => t.title === "New Task");
      expect(newTask!.id).toBe("AGI-6");
    });

    it("returns tasks in all statuses", async () => {
      await writeFrontmatter(join(queueDir, "done.md"), {
        id: "AGI-1",
        title: "Done",
        description: "Finished",
        repo: "https://github.com/test/repo",
        status: "Done",
      });
      await writeFrontmatter(join(queueDir, "research.md"), {
        id: "AGI-2",
        title: "Research",
        description: "Research needed",
        repo: "https://github.com/test/repo",
        status: "Needs Research",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks.find((t) => t.status === TaskStatus.Done)).toBeDefined();
      expect(tasks.find((t) => t.status === TaskStatus.NeedsResearch)).toBeDefined();
    });

    it("preserves existing IDs without reassigning", async () => {
      await writeFrontmatter(join(queueDir, "has_id.md"), {
        id: "AGI-3",
        title: "Has ID",
        description: "Already assigned",
        repo: "https://github.com/test/repo",
        status: "Needs Research",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-3");
    });

    it("assigns sequential IDs to multiple tasks missing IDs", async () => {
      for (let i = 1; i <= 3; i++) {
        await writeFrontmatter(join(queueDir, `task${i}.md`), {
          title: `Task ${i}`,
          description: `Do thing ${i}`,
          repo: "https://github.com/test/repo",
          status: "Needs Research",
        });
      }

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(3);

      const ids = tasks.map((t) => t.id).sort();
      expect(ids).toEqual(["AGI-1", "AGI-2", "AGI-3"]);
    });

    it("ignores non-.md files in the queue directory", async () => {
      await writeFile(join(queueDir, "README.txt"), "not a task");
      await writeFrontmatter(join(queueDir, "task.md"), {
        title: "Real Task",
        description: "Do it",
        repo: "https://github.com/test/repo",
        status: "Needs Research",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Real Task");
    });

    it("populates all TaskRequest fields correctly", async () => {
      await writeFrontmatter(join(queueDir, "full.md"), {
        id: "AGI-10",
        title: "Full Task",
        description: "Complete description",
        repo: "https://github.com/test/repo",
        status: "Needs Implement",
        depends_on: ["AGI-9"],
        group: "auth",
        variant_hint: "variant-a",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks[0]).toEqual({
        id: "AGI-10",
        file: "full.md",
        filePath: join(queueDir, "full.md"),
        title: "Full Task",
        description: "Complete description",
        repo: "https://github.com/test/repo",
        status: TaskStatus.NeedsImplement,
        dependsOn: ["AGI-9"],
        group: "auth",
        variantHint: "variant-a",
      });
    });

    it("skips files with unknown status", async () => {
      await writeFrontmatter(join(queueDir, "bad.md"), {
        id: "AGI-1",
        title: "Bad Status",
        description: "Invalid",
        repo: "https://github.com/test/repo",
        status: "SomeInvalidStatus",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(0);
    });
  });
});
