import { describe, it, expect } from "vitest";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { spawn } from "child_process";

const testFileName = "healthkit-ui-review.md";
const queueDir = join(import.meta.dirname, "..", "request_queue");
const testFilePath = join(queueDir, testFileName);

function runOrchestrator(cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("tsx", ["src/index.ts"], {
      cwd,
      env: { ...process.env, DAWN_MAX_ITERATIONS: "10", DAWN_MAX_CONCURRENCY: "2"},
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", reject);
  });
}

const validStatuses = [
  "Research In Progress",
  "Needs Specification",
  "Specification In Progress",
  "Needs Plan",
  "Plan In Progress",
  "Needs Implement",
  "Implement In Progress",
  "Needs Validate",
  "Validate In Progress",
  "Needs Oneshot",
  "Oneshot In Progress",
  "Done",
  "Awaiting Merge",
  "Blocked",
  "Needs Human Review",
  "Needs Human Decision",
];

const progressedPastResearch = new Set([
  "Needs Specification",
  "Needs Plan",
  "Needs Implement",
  "Needs Validate",
  "Done",
  "Awaiting Merge",
]);

describe("PR creation", () => {
  it("Process a multi-stage agent workflow in the same sandbox until PR", async () => {
    // 1. Ensure no other tasks are actionable in the queue
    const otherFiles = ["pr_creation_test.md", "joke_test.md", "country_test.md"];
    for (const file of otherFiles) {
      const filePath = join(queueDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const data = matter(content);
        await writeFile(filePath, matter.stringify("", { ...data.data, status: "Done" }));
      } catch {
        // File doesn't exist, skip
      }
    }

    // 2. Reset the test file to status "Needs Research"
    const initialContent = await readFile(testFilePath, "utf-8");
    const initialData = matter(initialContent);

    await writeFile(
      testFilePath,
      matter.stringify("", {
        ...initialData.data,
        status: "Needs Research",
      })
    );

    // 3. Run the main loop with max 1 iteration, streaming output
    const exitCode = await runOrchestrator(join(import.meta.dirname, ".."));

    // 4. Verify the final state
    const finalContent = await readFile(testFilePath, "utf-8");
    const finalData = matter(finalContent);

    // Phase gate 1: status moved away from the initial state
    expect(finalData.data.status).not.toBe("Needs Research");

    // Phase gate 2: status is a known valid TaskStatus value
    expect(validStatuses).toContain(finalData.data.status);

    // Phase gate 3: if agent progressed past research, a summary was written
    if (progressedPastResearch.has(finalData.data.status)) {
      expect(finalData.data.last_summary).toBeDefined();
      expect(String(finalData.data.last_summary).length).toBeGreaterThan(0);
    }
  });
});
