import { Daytona } from "@daytonaio/sdk";
import dotenv from "dotenv";
import matter from "gray-matter";
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

dotenv.config();

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const queueDir = join(import.meta.dirname, "..", "request_queue");

async function runInSandbox(prompt: string, label: string, repo: string) {
  const sandbox = await daytona.create({ language: "typescript" });
  console.log(`[${label}] Sandbox created`);
  try {
    const repoDir = "/home/daytona/repo";
    await sandbox.git.clone(repo, repoDir);
    console.log(`[${label}] Repo cloned`);

    console.log(`[${label}] Installing Claude CLI...`);
    const claudeInstall = await sandbox.process.executeCommand(
      "mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global' && npm install -g @anthropic-ai/claude-code"
    );
    console.log(`[${label}] Claude CLI exit code: ${claudeInstall.exitCode}`);
    if (claudeInstall.exitCode !== 0) {
      console.error(`[${label}] Failed to install Claude CLI: ${claudeInstall.result}`);
      throw new Error("Failed to install Claude CLI");
    }

    const claudeVerify = await sandbox.process.executeCommand("export PATH=~/.npm-global/bin:$PATH && which claude && claude --version");
    console.log(`[${label}] Claude CLI location and version: ${claudeVerify.result}`);

    console.log(`[${label}] Installing GitHub CLI from binary...`);
    const ghInstall = await sandbox.process.executeCommand(
      "GH_VERSION=2.86.0 && mkdir -p ~/bin && curl -fsSL https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz -o /tmp/gh.tar.gz && tar -xzf /tmp/gh.tar.gz -C /tmp && cp /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh ~/bin/gh && chmod +x ~/bin/gh && export PATH=~/bin:$PATH"
    );
    console.log(`[${label}] GitHub CLI install exit code: ${ghInstall.exitCode}`);
    if (ghInstall.exitCode !== 0) {
      console.error(`[${label}] Failed to install gh CLI: ${ghInstall.result}`);
      throw new Error("Failed to install gh CLI");
    }

    const ghVerify = await sandbox.process.executeCommand("export PATH=~/bin:$PATH && gh --version");
    console.log(`[${label}] GitHub CLI version: ${ghVerify.result}`);

    console.log(`[${label}] Configuring git...`);
    await sandbox.process.executeCommand('git config --global user.email "claude@anthropic.com"');
    await sandbox.process.executeCommand('git config --global user.name "Claude Agent"');
    console.log(`[${label}] Git configured`);

    const fullPrompt = `You are working in a cloned git repo. Your task:

1. Create a new branch with a descriptive name for this feature
2. Implement the following feature: ${prompt}
3. Commit your changes with a clear commit message
4. Push the branch to origin
5. Create a pull request using \`gh pr create\` with a clear title and description

IMPORTANT: Use \`gh\` CLI for creating the PR (GITHUB_TOKEN is already set in the environment). Do NOT use interactive flags.`;

    const escaped = fullPrompt.replace(/'/g, "'\\''");
    const cmd = `export PATH=~/.npm-global/bin:~/bin:$PATH && claude -p '${escaped}' --dangerously-skip-permissions --output-format=stream-json --model claude-sonnet-4-5-20250929 --verbose`;
    const env = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
      PATH: `/home/daytona/.npm-global/bin:/home/daytona/bin:${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}`,
    };
    console.log(`[${label}] Executing command: ${cmd}`);
    const response = await sandbox.process.executeCommand(cmd, repoDir, env);
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
      } catch (error) {
        console.log(`[${label}] Error parsing line: ${line}`);
        console.log(`[${label}] Error details: ${JSON.stringify(error)}`);
      }
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
    runInSandbox(data.description, `${data.title}-${i + 1}`, data.repo)
  );
  await Promise.all(tasks);

  await writeFile(filePath, matter.stringify("", { ...data, status: "Done" }));
  console.log(`Completed: ${data.title}`);
}
