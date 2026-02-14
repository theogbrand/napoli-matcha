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
  data: Record<string, unknown>,
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
      processor.handleStreamLine(json, "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toContain("[json]");
      expect(content).toContain('"type":"system"');
    });

    it("writes non-JSON lines with [raw] prefix", async () => {
      processor.handleStreamLine("some shell output", "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toBe("[raw] some shell output\n");
    });

    it("skips empty and whitespace-only lines", async () => {
      processor.handleStreamLine("", "test", logFile);
      processor.handleStreamLine("   ", "test", logFile);
      processor.handleStreamLine("\x1b[32m\x1b[0m", "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toBe("");
    });

    it("strips ANSI escape codes before parsing JSON", async () => {
      const json = JSON.stringify({ type: "result", result: "ok" });
      const ansiWrapped = `\x1b[32m${json}\x1b[0m`;
      processor.handleStreamLine(ansiWrapped, "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toContain("[json]");
      expect(content).toContain('"type":"result"');
    });

    it("treats malformed JSON as a raw line", async () => {
      processor.handleStreamLine("{not valid json", "test", logFile);
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
      processor.handleStreamLine(JSON.stringify(event), "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toContain("[json]");
      expect(content).toContain("Hello world");
    });

    it("writes result content for result events", async () => {
      const event = { type: "result", result: "Task completed successfully" };
      processor.handleStreamLine(JSON.stringify(event), "test", logFile);
      await flush();

      const content = await readFile(logFile, "utf-8");
      expect(content).toContain("[json]");
      expect(content).toContain("Task completed successfully");
    });
  });

  describe("loadAllTasks - discovery and ID assignment", () => {
    let processor: SandboxQueueProcessor;
    let frDir: string;

    beforeEach(async () => {
      frDir = join(tmpDir, "feature_requests");
      await mkdir(frDir, { recursive: true });
      processor = makeProcessor(frDir);
    });

    it("assigns AGI-1 to a task with no ID", async () => {
      const taskDir = join(frDir, "FR-1");
      await mkdir(taskDir, { recursive: true });
      await writeFrontmatter(join(taskDir, "AGI-0.md"), {
        title: "Test Task",
        description: "Do something",
        repo: "https://github.com/test/repo",
        status: "Backlog",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-1");

      const { data } = matter(
        await readFile(join(taskDir, "AGI-0.md"), "utf-8"),
      );
      expect(data.id).toBe("AGI-1");
    });

    it("continues from the highest existing AGI-{n} across all files", async () => {
      const taskDir = join(frDir, "FR-1");
      await mkdir(taskDir, { recursive: true });
      await writeFrontmatter(join(taskDir, "AGI-5.md"), {
        id: "AGI-5",
        title: "Done Task",
        description: "Already done",
        repo: "https://github.com/test/repo",
        status: "Done",
      });
      await writeFrontmatter(join(taskDir, "AGI-new.md"), {
        title: "New Task",
        description: "Needs ID",
        repo: "https://github.com/test/repo",
        status: "Backlog",
      });

      const tasks = await processor.loadAllTasks();
      const newTask = tasks.find((t) => t.title === "New Task");
      expect(newTask?.id).toBe("AGI-6");
    });

    it("returns all tasks regardless of status", async () => {
      const taskDir = join(frDir, "FR-1");
      await mkdir(taskDir, { recursive: true });
      await writeFrontmatter(join(taskDir, "AGI-1.md"), {
        id: "AGI-1",
        title: "Done",
        description: "Finished",
        repo: "https://github.com/test/repo",
        status: "Done",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe("Done");
    });

    it("preserves existing IDs without reassigning", async () => {
      const taskDir = join(frDir, "FR-1");
      await mkdir(taskDir, { recursive: true });
      await writeFrontmatter(join(taskDir, "AGI-3.md"), {
        id: "AGI-3",
        title: "Has ID",
        description: "Already assigned",
        repo: "https://github.com/test/repo",
        status: "Backlog",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("AGI-3");
    });

    it("discovers tasks across multiple FR directories", async () => {
      for (let i = 1; i <= 2; i++) {
        const dir = join(frDir, `FR-${i}`);
        await mkdir(dir, { recursive: true });
        await writeFrontmatter(join(dir, `AGI-${i}.md`), {
          id: `AGI-${i}`,
          title: `Task ${i}`,
          description: `Do thing ${i}`,
          repo: "https://github.com/test/repo",
          status: "Backlog",
        });
      }

      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(2);
      const ids = tasks.map((t) => t.id).sort();
      expect(ids).toEqual(["AGI-1", "AGI-2"]);
    });

    it("populates all TaskRequest fields correctly", async () => {
      const taskDir = join(frDir, "FR-2");
      await mkdir(taskDir, { recursive: true });
      await writeFrontmatter(join(taskDir, "AGI-10.md"), {
        id: "AGI-10",
        title: "Full Task",
        description: "Complete description",
        repo: "https://github.com/test/repo",
        status: "Backlog",
        dependsOn: ["AGI-9"],
        group: "login-auth",
        variantHint: "Variant 1 of 2",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks[0]).toEqual({
        id: "AGI-10",
        file: "AGI-10.md",
        filePath: join(taskDir, "AGI-10.md"),
        featureRequest: "FR-2",
        title: "Full Task",
        description: "Complete description",
        repo: "https://github.com/test/repo",
        status: "Backlog",
        dependsOn: ["AGI-9"],
        group: "login-auth",
        variantHint: "Variant 1 of 2",
      });
    });

    it("maps unknown status strings to Backlog", async () => {
      const taskDir = join(frDir, "FR-1");
      await mkdir(taskDir, { recursive: true });
      await writeFrontmatter(join(taskDir, "AGI-1.md"), {
        id: "AGI-1",
        title: "Unknown Status",
        description: "Test",
        repo: "https://github.com/test/repo",
        status: "SomeWeirdStatus",
      });

      const tasks = await processor.loadAllTasks();
      expect(tasks[0].status).toBe("Backlog");
    });

    it("returns empty array when no feature_requests exist", async () => {
      const tasks = await processor.loadAllTasks();
      expect(tasks).toHaveLength(0);
    });
  });
});
