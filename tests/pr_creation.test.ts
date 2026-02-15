import { describe, it, expect } from "vitest";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { spawn } from "child_process";

const testFileName = "country_test.md";
const queueDir = join(import.meta.dirname, "..", "request_queue");
const testFilePath = join(queueDir, testFileName);

function runOrchestrator(cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("tsx", ["src/index.ts"], {
      cwd,
      env: { ...process.env, DAWN_MAX_ITERATIONS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", reject);
  });
}

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

    // 2. Run the main loop with max 1 iteration, streaming output
    const exitCode = await runOrchestrator(join(import.meta.dirname, ".."));

    // 3. Verify the status changed from "Needs Research"
    const finalContent = await readFile(testFilePath, "utf-8");
    const finalData = matter(finalContent);

    // After one iteration, it should be in a non-initial status
    expect(finalData.data.status).not.toBe("Needs Research");
  });
});
