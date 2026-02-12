import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import matter from "gray-matter";
import { SandboxQueueProcessor } from "../src/lib/SandboxQueueProcessor.js";

/** Wait for fire-and-forget appendFile calls to settle */
const flush = () => new Promise((r) => setTimeout(r, 50));

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

  describe("handleStreamLine", () => {
    let processor: SandboxQueueProcessor;
    let logFile: string;

    beforeEach(async () => {
      processor = makeProcessor(tmpDir);
      logFile = join(tmpDir, "test.log");
      await writeFile(logFile, "");
    });

    it("parses valid JSON and writes with [json] prefix", async () => {
      const json = JSON.stringify({ type: "system", message: "hello" });
      (processor as any).handleStreamLine(json, "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toContain("[json]");
      expect(content).toContain('"type":"system"');
    });

    it("writes non-JSON lines with [raw] prefix", async () => {
      (processor as any).handleStreamLine("some shell output", "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toBe("[raw] some shell output\n");
    });

    it("skips empty and whitespace-only lines", async () => {
      (processor as any).handleStreamLine("", "test", logFile);
      (processor as any).handleStreamLine("   ", "test", logFile);
      (processor as any).handleStreamLine(
        "\x1b[32m\x1b[0m",
        "test",
        logFile
      );
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toBe("");
    });

    it("strips ANSI escape codes before parsing JSON", async () => {
      const json = JSON.stringify({ type: "result", result: "ok" });
      const ansiWrapped = `\x1b[32m${json}\x1b[0m`;
      (processor as any).handleStreamLine(ansiWrapped, "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toContain("[json]");
      expect(content).toContain('"type":"result"');
    });

    it("treats malformed JSON as a raw line", async () => {
      (processor as any).handleStreamLine("{not valid json", "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toBe("[raw] {not valid json\n");
    });

    it("writes assistant text content for assistant events", async () => {
      const event = {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      };
      (processor as any).handleStreamLine(
        JSON.stringify(event),
        "test",
        logFile
      );
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toContain("[json]");
      expect(content).toContain("Hello world");
    });

    it("writes result content for result events", async () => {
      const event = { type: "result", result: "Task completed successfully" };
      (processor as any).handleStreamLine(
        JSON.stringify(event),
        "test",
        logFile
      );
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toContain("[json]");
      expect(content).toContain("Task completed successfully");
    });
  });

  describe("loadTasksFromQueue - ID assignment", () => {
    let processor: SandboxQueueProcessor;
    let queueDir: string;

    beforeEach(async () => {
      queueDir = join(tmpDir, "queue");
      await mkdir(queueDir, { recursive: true });
      processor = makeProcessor(queueDir);
    });

    it("assigns AGI-1 to a Backlog task with no ID", async () => {
      await writeFrontmatter(join(queueDir, "task.md"), {
        title: "Test Task",
        description: "Do something",
        repo: "https://github.com/test/repo",
        number_of_sandboxes: 1,
        status: "Backlog",
      });

      const tasks = await (processor as any).loadTasksFromQueue();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-1");

      // Verify written back to frontmatter
      const { data } = matter(await readFile(join(queueDir, "task.md"), "utf-8"));
      expect(data.id).toBe("AGI-1");
    });

    it("continues from the highest existing AGI-{n} across all files", async () => {
      await writeFrontmatter(join(queueDir, "done.md"), {
        id: "AGI-5",
        title: "Done Task",
        description: "Already done",
        repo: "https://github.com/test/repo",
        number_of_sandboxes: 1,
        status: "Done",
      });
      await writeFrontmatter(join(queueDir, "new.md"), {
        title: "New Task",
        description: "Needs ID",
        repo: "https://github.com/test/repo",
        number_of_sandboxes: 1,
        status: "Backlog",
      });

      const tasks = await (processor as any).loadTasksFromQueue();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-6");
    });

    it("returns no tasks when none are in Backlog status", async () => {
      await writeFrontmatter(join(queueDir, "done.md"), {
        id: "AGI-1",
        title: "Done",
        description: "Finished",
        repo: "https://github.com/test/repo",
        number_of_sandboxes: 1,
        status: "Done",
      });

      const tasks = await (processor as any).loadTasksFromQueue();
      expect(tasks).toHaveLength(0);
    });

    it("preserves existing IDs on Backlog tasks without reassigning", async () => {
      await writeFrontmatter(join(queueDir, "has_id.md"), {
        id: "AGI-3",
        title: "Has ID",
        description: "Already assigned",
        repo: "https://github.com/test/repo",
        number_of_sandboxes: 1,
        status: "Backlog",
      });

      const tasks = await (processor as any).loadTasksFromQueue();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-3");

      // File should not have been rewritten
      const { data } = matter(
        await readFile(join(queueDir, "has_id.md"), "utf-8")
      );
      expect(data.id).toBe("AGI-3");
    });

    it("assigns sequential IDs to multiple Backlog tasks missing IDs", async () => {
      for (let i = 1; i <= 3; i++) {
        await writeFrontmatter(join(queueDir, `task${i}.md`), {
          title: `Task ${i}`,
          description: `Do thing ${i}`,
          repo: "https://github.com/test/repo",
          number_of_sandboxes: 1,
          status: "Backlog",
        });
      }

      const tasks = await (processor as any).loadTasksFromQueue();
      expect(tasks).toHaveLength(3);

      const ids = tasks.map((t: any) => t.id).sort();
      expect(ids).toEqual(["AGI-1", "AGI-2", "AGI-3"]);
    });

    it("ignores non-.md files in the queue directory", async () => {
      await writeFile(join(queueDir, "README.txt"), "not a task");
      await writeFrontmatter(join(queueDir, "task.md"), {
        title: "Real Task",
        description: "Do it",
        repo: "https://github.com/test/repo",
        number_of_sandboxes: 1,
        status: "Backlog",
      });

      const tasks = await (processor as any).loadTasksFromQueue();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Real Task");
    });

    it("populates all TaskRequest fields correctly", async () => {
      await writeFrontmatter(join(queueDir, "full.md"), {
        id: "AGI-10",
        title: "Full Task",
        description: "Complete description",
        repo: "https://github.com/test/repo",
        number_of_sandboxes: 3,
        status: "Backlog",
      });

      const tasks = await (processor as any).loadTasksFromQueue();
      expect(tasks[0]).toEqual({
        id: "AGI-10",
        file: "full.md",
        filePath: join(queueDir, "full.md"),
        title: "Full Task",
        description: "Complete description",
        repo: "https://github.com/test/repo",
        numberOfSandboxes: 3,
        status: "Backlog",
      });
    });
  });
});
