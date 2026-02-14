import { describe, it, expect } from "vitest";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const testFilePath = join(
  import.meta.dirname,
  "..",
  "feature_requests",
  "FR-test",
  "AGI-test.md"
);

/**
 * Extract the final result text from Claude's stream-json output.
 * Looks for the last `{"type":"result",...}` event in stdout and returns its `result` field.
 */
function extractAgentResult(stdout: string): string | null {
  let lastResult: string | null = null;

  for (const line of stdout.split("\n")) {
    // Stream-json events appear as raw JSON lines or prefixed with labels
    const jsonMatch = line.match(/\{.*"type"\s*:\s*"result".*\}/);
    if (!jsonMatch) continue;

    try {
      const event = JSON.parse(jsonMatch[0]);
      if (event.type === "result" && typeof event.result === "string") {
        lastResult = event.result;
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return lastResult;
}

describe("PR creation", () => {
  it("should process a backlog item and set status to Done", async () => {
    // 1. Reset the test file to status "Backlog"
    const initialContent = await readFile(testFilePath, "utf-8");
    const initialData = matter(initialContent);

    await writeFile(
      testFilePath,
      matter.stringify("", { ...initialData.data, status: "Backlog" })
    );

    // 2. Run the main loop with NAPOLI_MAX_ITERATIONS=1 to exit after one dispatch
    const { stdout, stderr } = await execAsync("npx tsx src/index.ts", {
      cwd: join(import.meta.dirname, ".."),
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NAPOLI_MAX_ITERATIONS: "1" },
    });

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    // 3. Verify the agent reported success (not a WORK_RESULT with success: false)
    const agentResult = extractAgentResult(stdout);
    expect(agentResult, "Could not extract agent result from stdout").not.toBeNull();
    expect(agentResult).not.toMatch(/success:\s*false/i);

    // 4. Verify the status changed to "Done"
    const finalContent = await readFile(testFilePath, "utf-8");
    const finalData = matter(finalContent);

    expect(finalData.data.status).toBe("Done");
  });
});
