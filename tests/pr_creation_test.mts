import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const testFileName = "pr_creation_test.md";
const queueDir = join(import.meta.dirname, "..", "request_queue");
const testFilePath = join(queueDir, testFileName);

try {
  console.log("=== PR Creation Test ===");

  // 1. ALWAYS reset the test file to status "Backlog" before running the test
  console.log("1. Preparing test markdown file...");
  const initialContent = await readFile(testFilePath, "utf-8");
  const initialData = matter(initialContent);

  console.log(`   Title: ${initialData.data.title}`);
  console.log(`   Current status: ${initialData.data.status}`);
  console.log(`   Repo: ${initialData.data.repo}`);

  // IMPORTANT: Always reset to Backlog so the main loop will process it
  console.log("   Resetting status to Backlog...");
  await writeFile(
    testFilePath,
    matter.stringify("", { ...initialData.data, status: "Backlog" })
  );
  console.log("   ✓ Status set to Backlog");

  // 2. Run the main loop
  console.log("\n2. Running main loop...");
  console.log("   Executing: npx tsx src/index.ts");
  console.log("   This will:");
  console.log("   - Create a Daytona sandbox");
  console.log("   - Clone the repository");
  console.log("   - Install Claude CLI and GitHub CLI");
  console.log("   - Run Claude to create a PR");
  console.log("   - Delete the sandbox");
  console.log("\n   Starting execution (this may take a few minutes)...\n");

  const startTime = Date.now();
  const { stdout, stderr } = await execAsync("npx tsx src/index.ts", {
    cwd: join(import.meta.dirname, ".."),
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for output
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  if (stdout) {
    console.log("\n--- STDOUT ---");
    console.log(stdout);
  }

  if (stderr) {
    console.log("\n--- STDERR ---");
    console.log(stderr);
  }

  // 3. Verify the status changed to "Done"
  console.log("\n3. Verifying results...");
  const finalContent = await readFile(testFilePath, "utf-8");
  const finalData = matter(finalContent);

  console.log(`   Final status: ${finalData.data.status}`);

  if (finalData.data.status === "Done") {
    console.log("\n✅ TEST PASSED!");
    console.log(`   - Status changed from "Backlog" to "Done"`);
    console.log(`   - Execution time: ${duration}s`);
    console.log(`   - PR should have been created in ${finalData.data.repo}`);
    console.log("\n   To verify the PR was created, check:");
    console.log(`   https://github.com/theogbrand/research/pulls`);
  } else {
    console.log("\n❌ TEST FAILED!");
    console.log(`   - Expected status "Done" but got "${finalData.data.status}"`);
    process.exit(1);
  }

} catch (error) {
  console.error("\n❌ TEST FAILED WITH ERROR!");
  console.error(error);
  process.exit(1);
}
