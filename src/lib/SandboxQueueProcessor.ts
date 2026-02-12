import { Daytona, Sandbox } from "@daytonaio/sdk";
import matter from "gray-matter";
import { appendFile, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

interface TaskRequest {
  id: string;
  file: string;
  filePath: string;
  title: string;
  description: string;
  repo: string;
  numberOfSandboxes: number;
  status: string;
}

export class SandboxQueueProcessor {
  private daytona: Daytona;
  private queueDir: string;
  private logsDir: string;
  private config: {
    anthropicApiKey: string;
    githubToken: string;
    claudeModel: string;
  };

  constructor(daytonaApiKey: string) {
    this.daytona = new Daytona({ apiKey: daytonaApiKey });
    const root = join(import.meta.dirname, "..", "..");
    this.queueDir = join(root, "request_queue");
    this.logsDir = join(root, "logs");
    this.config = {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
      githubToken: process.env.GITHUB_TOKEN!,
      claudeModel: "claude-sonnet-4-5-20250929",
    };
  }

  async processQueue(): Promise<void> {
    const tasks = await this.loadTasksFromQueue();

    for (const task of tasks) {
      console.log(`Processing: ${task.title}`);
      await this.updateTaskStatus(task, "In Progress");

      const sandboxTasks = Array.from(
        { length: task.numberOfSandboxes },
        (_, i) => this.runInSandbox(task, i + 1)
      );
      await Promise.all(sandboxTasks);

      await this.updateTaskStatus(task, "Done");
      console.log(`Completed: ${task.title}`);
    }
  }

  private async loadTasksFromQueue(): Promise<TaskRequest[]> {
    const files = (await readdir(this.queueDir)).filter((f) =>
      f.endsWith(".md")
    );

    // Scan all queue files to find the highest existing AGI-{n} ID
    let maxId = 0;
    const allData: { file: string; filePath: string; data: Record<string, unknown>; raw: string }[] = [];
    for (const file of files) {
      const filePath = join(this.queueDir, file);
      const raw = await readFile(filePath, "utf-8");
      const { data } = matter(raw);
      allData.push({ file, filePath, data, raw });
      if (typeof data.id === "string") {
        const match = data.id.match(/^AGI-(\d+)$/);
        if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
      }
    }

    // Assign IDs to Backlog tasks missing one, and collect runnable tasks
    const tasks: TaskRequest[] = [];
    for (const { file, filePath, data } of allData) {
      if (data.status === "Backlog" && !data.id) {
        maxId++;
        data.id = `AGI-${maxId}`;
        await writeFile(filePath, matter.stringify("", data));
        console.log(`Assigned ${data.id} to ${file}`);
      }
      if (data.status === "Backlog") {
        tasks.push({
          id: data.id as string,
          file,
          filePath,
          title: data.title as string,
          description: data.description as string,
          repo: data.repo as string,
          numberOfSandboxes: data.number_of_sandboxes as number,
          status: data.status as string,
        });
      }
    }

    return tasks;
  }

  private async updateTaskStatus(
    task: TaskRequest,
    status: string
  ): Promise<void> {
    const raw = await readFile(task.filePath, "utf-8");
    const { data } = matter(raw);
    await writeFile(
      task.filePath,
      matter.stringify("", { ...data, status })
    );
  }

  private async runInSandbox(
    task: TaskRequest,
    sandboxIndex: number
  ): Promise<void> {
    const label = `${task.title}-${sandboxIndex}`;
    const logDir = join(this.logsDir, task.id);
    const logFile = join(logDir, `agent-${sandboxIndex}.log`);

    await mkdir(logDir, { recursive: true });
    const header = [
      "=== Agent Log ===",
      `Ticket: ${task.id}`,
      `Title: ${task.title}`,
      `Queue File: request_queue/${task.file}`,
      `Sandbox: agent-${sandboxIndex}`,
      `Started: ${new Date().toISOString()}`,
      "===\n\n",
    ].join("\n");
    await writeFile(logFile, header);

    const sandbox = await this.daytona.create({ language: "typescript" });
    console.log(`[${label}] Sandbox created`);

    try {
      const repoDir = await this.setupSandboxEnvironment(sandbox, task.repo, label);
      await this.installClaudeCLI(sandbox, label);
      await this.installGitHubCLI(sandbox, label);
      await this.configureGit(sandbox, label);
      await this.executeClaudeCommand(sandbox, task, repoDir, label, logFile);
    } finally {
      await sandbox.delete();
      const footer = `\n=== Finished: ${new Date().toISOString()} ===\n`;
      await appendFile(logFile, footer);
      console.log(`[${label}] Deleted`);
    }
  }

  private async setupSandboxEnvironment(
    sandbox: Sandbox,
    repo: string,
    label: string
  ): Promise<string> {
    const repoDir = "/home/daytona/repo";
    await sandbox.git.clone(repo, repoDir);
    console.log(`[${label}] Repo cloned`);
    return repoDir;
  }

  private async installClaudeCLI(
    sandbox: Sandbox,
    label: string
  ): Promise<void> {
    console.log(`[${label}] Installing Claude CLI...`);
    const claudeInstall = await sandbox.process.executeCommand(
      "mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global' && npm install -g @anthropic-ai/claude-code"
    );
    console.log(`[${label}] Claude CLI exit code: ${claudeInstall.exitCode}`);

    if (claudeInstall.exitCode !== 0) {
      console.error(
        `[${label}] Failed to install Claude CLI: ${claudeInstall.result}`
      );
      throw new Error("Failed to install Claude CLI");
    }

    const claudeVerify = await sandbox.process.executeCommand(
      "export PATH=~/.npm-global/bin:$PATH && which claude && claude --version"
    );
    console.log(`[${label}] Claude CLI location and version: ${claudeVerify.result}`);
  }

  private async installGitHubCLI(
    sandbox: Sandbox,
    label: string
  ): Promise<void> {
    console.log(`[${label}] Installing GitHub CLI from binary...`);
    const ghInstall = await sandbox.process.executeCommand(
      "GH_VERSION=2.86.0 && mkdir -p ~/bin && curl -fsSL https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz -o /tmp/gh.tar.gz && tar -xzf /tmp/gh.tar.gz -C /tmp && cp /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh ~/bin/gh && chmod +x ~/bin/gh && export PATH=~/bin:$PATH"
    );
    console.log(`[${label}] GitHub CLI install exit code: ${ghInstall.exitCode}`);

    if (ghInstall.exitCode !== 0) {
      console.error(
        `[${label}] Failed to install gh CLI: ${ghInstall.result}`
      );
      throw new Error("Failed to install gh CLI");
    }

    const ghVerify = await sandbox.process.executeCommand(
      "export PATH=~/bin:$PATH && gh --version"
    );
    console.log(`[${label}] GitHub CLI version: ${ghVerify.result}`);
  }

  private async configureGit(sandbox: Sandbox, label: string): Promise<void> {
    console.log(`[${label}] Configuring git...`);
    await sandbox.process.executeCommand(
      'git config --global user.email "claude@anthropic.com"'
    );
    await sandbox.process.executeCommand(
      'git config --global user.name "Claude Agent"'
    );
    console.log(`[${label}] Git configured`);
  }

  private async executeClaudeCommand(
    sandbox: Sandbox,
    task: TaskRequest,
    repoDir: string,
    label: string,
    logFile: string
  ): Promise<void> {
    const branchName = `feat/${task.id}`;
    const prTitle = `${task.id}: ${task.title}`;
    const fullPrompt = `You are working in a cloned git repo. Your task:

1. Create a new branch named "${branchName}"
2. Implement the following feature: ${task.description}
3. Commit your changes with a clear commit message
4. Push the branch to origin
5. Create a pull request using \`gh pr create\` with title "${prTitle}" and a clear description

IMPORTANT: Use \`gh\` CLI for creating the PR (GITHUB_TOKEN is already set in the environment). Do NOT use interactive flags.`;

    const escaped = fullPrompt.replace(/'/g, "'\\''");
    const claudeCmd = `claude -p '${escaped}' --dangerously-skip-permissions --output-format=stream-json --model ${this.config.claudeModel} --verbose`;

    console.log(`[${label}] Starting Claude via PTY...`);

    const decoder = new TextDecoder();
    let buffer = "";

    const pty = await sandbox.process.createPty({
      id: `claude-${label}-${Date.now()}`,
      cwd: repoDir,
      envs: {
        ANTHROPIC_API_KEY: this.config.anthropicApiKey,
        GITHUB_TOKEN: this.config.githubToken,
        PATH: "/home/daytona/.npm-global/bin:/home/daytona/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
      onData: (data: Uint8Array) => {
        const text = decoder.decode(data, { stream: true });
        process.stdout.write(`[${label}] ${text}`);

        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          this.handleStreamLine(line, label, logFile);
        }
      },
    });

    await pty.waitForConnection();
    pty.sendInput(`${claudeCmd}\n`);
    pty.sendInput("exit\n");

    const result = await pty.wait();

    // Flush remaining buffer
    if (buffer.trim()) {
      this.handleStreamLine(buffer, label, logFile);
    }

    console.log(`[${label}] PTY exited with code: ${result.exitCode}`);
    await appendFile(logFile, `\nPTY exited with code: ${result.exitCode}\n`);
  }

  private handleStreamLine(line: string, label: string, logFile: string): void {
    const stripped = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
    if (!stripped) return;

    if (!stripped.startsWith("{")) {
      appendFile(logFile, `[raw] ${stripped}\n`);
      return;
    }

    try {
      const event = JSON.parse(stripped);
      console.log(`[${label}:json] ${JSON.stringify(event)}`);
      appendFile(logFile, `[json] ${JSON.stringify(event)}\n`);

      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text") {
            console.log(`\n[${label}:assistant] ${block.text}`);
          }
        }
      } else if (event.type === "result") {
        console.log(`\n[${label}:result] ${event.result}`);
      }
    } catch {
      appendFile(logFile, `[raw] ${stripped}\n`);
    }
  }
}
