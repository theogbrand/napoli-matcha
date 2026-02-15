import { describe, it, expect } from "vitest";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const testFileName = "pr_creation_test.md";
const queueDir = join(import.meta.dirname, "..", "request_queue");
const testFilePath = join(queueDir, testFileName);

describe("PR creation", () => {
  it("should process a Needs Research item through one iteration", async () => {
    // 1. Reset the test file to status "Needs Research"
    const initialContent = await readFile(testFilePath, "utf-8");
    const initialData = matter(initialContent);

    await writeFile(
      testFilePath,
      matter.stringify("", {
        ...initialData.data,
        status: "Needs Research",
      })
    );

    // 2. Run the main loop with max 1 iteration
    const { stdout, stderr } = await execAsync(
      "DAWN_MAX_ITERATIONS=1 npx tsx src/index.ts",
      {
        cwd: join(import.meta.dirname, ".."),
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    // 3. Verify the status changed from "Needs Research"
    const finalContent = await readFile(testFilePath, "utf-8");
    const finalData = matter(finalContent);

    // After one iteration, it should be in a non-initial status
    expect(finalData.data.status).not.toBe("Needs Research");
  });
});
