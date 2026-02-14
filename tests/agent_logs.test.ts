import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import matter from "gray-matter";
import { SandboxQueueProcessor } from "../src/lib/SandboxQueueProcessor.js";

/** Wait for fire-and-forget appendFile calls to settle */
const flush = () => new Promise((r) => setTimeout(r, 50));

function makeProcessor(featureRequestsDir: string): SandboxQueueProcessor {
  const p = new SandboxQueueProcessor("dummy-key");
  (p as any).featureRequestsDir = featureRequestsDir;
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

  describe("loadAllTasks - ID assignment", () => {
    let processor: SandboxQueueProcessor;
    let frDir: string;

    beforeEach(async () => {
      frDir = join(tmpDir, "feature_requests");
      await mkdir(join(frDir, "FR-1"), { recursive: true });
      processor = makeProcessor(frDir);
    });

    it("assigns AGI-1 to a task with no ID", async () => {
      await writeFrontmatter(join(frDir, "FR-1", "AGI-0.md"), {
        title: "Test Task",
        description: "Do something",
        repo: "https://github.com/test/repo",
        status: "Backlog",
      });

      const tasks = await (processor as any).loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-1");
    });

    it("continues from the highest existing AGI-{n} across all files", async () => {
      await writeFrontmatter(join(frDir, "FR-1", "AGI-5.md"), {
        id: "AGI-5",
        title: "Done Task",
        description: "Already done",
        repo: "https://github.com/test/repo",
        status: "Done",
      });
      await mkdir(join(frDir, "FR-2"), { recursive: true });
      await writeFrontmatter(join(frDir, "FR-2", "AGI-0.md"), {
        title: "New Task",
        description: "Needs ID",
        repo: "https://github.com/test/repo",
        status: "Backlog",
      });

      const tasks = await (processor as any).loadAllTasks();
      // loadAllTasks returns ALL tasks, not just Backlog
      expect(tasks).toHaveLength(2);
      const newTask = tasks.find((t: any) => t.title === "New Task");
      expect(newTask.id).toBe("AGI-6");
    });

    it("returns all tasks regardless of status", async () => {
      await writeFrontmatter(join(frDir, "FR-1", "AGI-1.md"), {
        id: "AGI-1",
        title: "Done",
        description: "Finished",
        repo: "https://github.com/test/repo",
        status: "Done",
      });

      const tasks = await (processor as any).loadAllTasks();
      // loadAllTasks returns ALL tasks (filtering happens in filterEligible)
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe("Done");
    });

    it("preserves existing IDs without reassigning", async () => {
      await writeFrontmatter(join(frDir, "FR-1", "AGI-3.md"), {
        id: "AGI-3",
        title: "Has ID",
        description: "Already assigned",
        repo: "https://github.com/test/repo",
        status: "Backlog",
      });

      const tasks = await (processor as any).loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-3");
    });

    it("assigns sequential IDs to multiple tasks missing IDs", async () => {
      for (let i = 1; i <= 3; i++) {
        await writeFrontmatter(join(frDir, "FR-1", `AGI-${i}0.md`), {
          title: `Task ${i}`,
          description: `Do thing ${i}`,
          repo: "https://github.com/test/repo",
          status: "Backlog",
        });
      }

      const tasks = await (processor as any).loadAllTasks();
      expect(tasks).toHaveLength(3);

      const ids = tasks.map((t: any) => t.id).sort();
      expect(ids).toEqual(["AGI-1", "AGI-2", "AGI-3"]);
    });

    it("only picks up .md files matching AGI-*.md pattern", async () => {
      await writeFile(join(frDir, "FR-1", "README.txt"), "not a task");
      await writeFrontmatter(join(frDir, "FR-1", "AGI-1.md"), {
        id: "AGI-1",
        title: "Real Task",
        description: "Do it",
        repo: "https://github.com/test/repo",
        status: "Backlog",
      });

      const tasks = await (processor as any).loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Real Task");
    });

    it("populates all TaskRequest fields correctly", async () => {
      await writeFrontmatter(join(frDir, "FR-1", "AGI-10.md"), {
        id: "AGI-10",
        title: "Full Task",
        description: "Complete description",
        repo: "https://github.com/test/repo",
        status: "Backlog",
        dependsOn: ["AGI-5"],
        group: "my-group",
        variantHint: "Variant 1 of 2",
      });

      const tasks = await (processor as any).loadAllTasks();
      expect(tasks[0]).toEqual({
        id: "AGI-10",
        file: "AGI-10.md",
        filePath: join(frDir, "FR-1", "AGI-10.md"),
        featureRequest: "FR-1",
        title: "Full Task",
        description: "Complete description",
        repo: "https://github.com/test/repo",
        status: "Backlog",
        dependsOn: ["AGI-5"],
        group: "my-group",
        variantHint: "Variant 1 of 2",
      });
    });
  });
});
