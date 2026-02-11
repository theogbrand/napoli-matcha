import { Daytona } from "@daytonaio/sdk";
import dotenv from "dotenv";
import matter from "gray-matter";
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

dotenv.config();

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const queueDir = join(import.meta.dirname, "..", "request_queue");

async function runInSandbox(prompt: string, label: string) {
  const sandbox = await daytona.create({ language: "typescript" });
  console.log(`[${label}] Sandbox created`);
  try {
    await sandbox.process.executeCommand("npm install -g @anthropic-ai/claude-code");
    const escaped = prompt.replace(/'/g, "'\\''");
    const cmd = `claude -p '${escaped}' --dangerously-skip-permissions --output-format=stream-json --model claude-haiku-4-5-20251001 --verbose`;
    const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! };
    const response = await sandbox.process.executeCommand(cmd, undefined, env);
    const lines = response.result.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text") console.log(`[${label}] ${block.text}`);
          }
        } else if (event.type === "result") {
          console.log(`[${label}] Result: ${event.result}`);
        }
      } catch {}
    }
  } finally {
    await sandbox.delete();
    console.log(`[${label}] Deleted`);
  }
}

const files = (await readdir(queueDir)).filter((f) => f.endsWith(".md"));

for (const file of files) {
  const filePath = join(queueDir, file);
  const raw = await readFile(filePath, "utf-8");
  const { data } = matter(raw);
  if (data.status !== "Backlog") continue;

  console.log(`Processing: ${data.title}`);
  await writeFile(filePath, matter.stringify("", { ...data, status: "In Progress" }));

  const tasks = Array.from({ length: data.number_of_sandboxes }, (_, i) =>
    runInSandbox(data.description, `${data.title}-${i + 1}`)
  );
  await Promise.all(tasks);

  await writeFile(filePath, matter.stringify("", { ...data, status: "Done" }));
  console.log(`Completed: ${data.title}`);
}
