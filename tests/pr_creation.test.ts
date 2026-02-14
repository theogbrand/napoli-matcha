import { describe, it, expect } from "vitest";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const testFileName = "pr_creation_test.md";
const queueDir = join(import.meta.dirname, "..", "request_queue");
const testFilePath = join(queueDir, testFileName);

describe("PR creation", () => {
  it("should process a backlog item and set status to Done", async () => {
    // 1. Reset the test file to status "Backlog"
    const initialContent = await readFile(testFilePath, "utf-8");
    const initialData = matter(initialContent);

    await writeFile(
      testFilePath,
      matter.stringify("", { ...initialData.data, status: "Backlog" })
    );

    // 2. Run the main loop
    const { stdout, stderr } = await execAsync("npx tsx src/index.ts", {
      cwd: join(import.meta.dirname, ".."),
      maxBuffer: 10 * 1024 * 1024,
    });

    // Save full test output to logs/ for debugging
    const logsDir = join(import.meta.dirname, "..", "logs", "test-runs");
    await mkdir(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = join(logsDir, `pr-creation-${timestamp}.log`);
    await writeFile(logPath, [
      `=== Test Run: ${new Date().toISOString()} ===`,
      `\n=== STDOUT ===\n${stdout}`,
      `\n=== STDERR ===\n${stderr}`,
    ].join("\n"));
    console.log(`Test output saved to: ${logPath}`);

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    // 3. Verify the status changed to "Done"
    const finalContent = await readFile(testFilePath, "utf-8");
    const finalData = matter(finalContent);

    expect(finalData.data.status).toBe("Done");
  });
});
