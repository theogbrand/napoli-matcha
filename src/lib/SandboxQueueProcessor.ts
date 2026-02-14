import { Daytona, Sandbox } from "@daytonaio/sdk";
import matter from "gray-matter";
import { appendFile, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join, basename, dirname } from "path";
import { glob } from "fs/promises";
import {
  TaskStatus,
  isActionable,
  inProgressStatus,
  nextStatus,
  stagePromptMap,
  isIntervention,
} from "./TaskStatus.js";
import { loadPrompt, loadPromptFragment } from "./PromptLoader.js";

export interface TaskRequest {
  id: string;
  file: string;
  filePath: string;
  featureRequest: string;
  title: string;
  description: string;
  repo: string;
  status: TaskStatus;
  dependsOn: string[];
  group?: string;
  variantHint?: string;
}

export class SandboxQueueProcessor {
  private daytona: Daytona;
  private featureRequestsDir: string;
  private logsDir: string;
  private running = true;
  private maxConcurrency: number;
  private maxIterations: number;
  private pollInterval: number;
  private mergeMode: string;
  private config: {
    anthropicApiKey: string;
    githubToken: string;
    claudeModel: string;
  };

  constructor(daytonaApiKey: string) {
    this.daytona = new Daytona({ apiKey: daytonaApiKey });
    const root = join(import.meta.dirname, "..", "..");
    this.featureRequestsDir = join(root, "feature_requests");
    this.logsDir = join(root, "logs");
    this.maxConcurrency = parseInt(process.env.NAPOLI_MAX_CONCURRENCY ?? "3", 10);
    this.maxIterations = parseInt(process.env.NAPOLI_MAX_ITERATIONS ?? "0", 10);
    this.pollInterval = parseInt(process.env.NAPOLI_POLL_INTERVAL ?? "30", 10);
    this.mergeMode = process.env.NAPOLI_MERGE_MODE ?? "auto";
    this.config = {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
      githubToken: process.env.GITHUB_TOKEN!,
      claudeModel: "claude-sonnet-4-5-20250929",
    };
  }

  async processQueue(): Promise<void> {
    let dispatches = 0;

    const shutdown = () => {
      console.log("[Orchestrator] Shutting down gracefully...");
      this.running = false;
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    try {
      while (this.running) {
        const allTasks = await this.loadAllTasks();
        const eligible = this.filterEligible(allTasks);

        if (eligible.length === 0) {
          console.log(`[Orchestrator] No eligible tasks, sleeping ${this.pollInterval}s...`);
          await this.sleep(this.pollInterval * 1000);
          continue;
        }

        console.log(`[Orchestrator] ${eligible.length} eligible task(s) found`);

        // Bounded concurrency via chunking
        for (let i = 0; i < eligible.length && this.running; i += this.maxConcurrency) {
          const batch = eligible.slice(i, i + this.maxConcurrency);
          const promises = batch.map((task) =>
            this.dispatchStage(task, allTasks).catch((err) => {
              console.error(`[Orchestrator] Error dispatching ${task.id}: ${err.message}`);
            })
          );
          await Promise.all(promises);

          dispatches += batch.length;
          if (this.maxIterations > 0 && dispatches >= this.maxIterations) {
            console.log(`[Orchestrator] Reached max iterations (${this.maxIterations}), exiting`);
            this.running = false;
            break;
          }
        }
      }
    } finally {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      console.log("[Orchestrator] Stopped");
    }
  }

  async loadAllTasks(): Promise<TaskRequest[]> {
    const pattern = join(this.featureRequestsDir, "FR-*", "AGI-*.md");
    const files: string[] = [];
    for await (const entry of glob(pattern)) {
      files.push(entry);
    }

    let maxId = 0;
    const entries: { filePath: string; data: Record<string, unknown> }[] = [];

    for (const filePath of files) {
      const raw = await readFile(filePath, "utf-8");
      const { data } = matter(raw);
      entries.push({ filePath, data });

      if (typeof data.id === "string") {
        const match = data.id.match(/^AGI-(\d+)$/);
        if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
      }
    }

    const tasks: TaskRequest[] = [];
    for (const { filePath, data } of entries) {
      // Assign ID to tasks missing one
      if (!data.id) {
        maxId++;
        data.id = `AGI-${maxId}`;
        await writeFile(filePath, matter.stringify("", data));
        console.log(`[Orchestrator] Assigned ${data.id} to ${basename(filePath)}`);
      }

      const statusStr = (data.status as string) || "Backlog";
      const status = Object.values(TaskStatus).includes(statusStr as TaskStatus)
        ? (statusStr as TaskStatus)
        : TaskStatus.Backlog;

      const frDir = basename(dirname(filePath));
      const deps = Array.isArray(data.dependsOn) ? data.dependsOn.map(String) : [];

      tasks.push({
        id: data.id as string,
        file: basename(filePath),
        filePath,
        featureRequest: frDir,
        title: (data.title as string) || "",
        description: (data.description as string) || "",
        repo: (data.repo as string) || "",
        status,
        dependsOn: deps,
        group: data.group as string | undefined,
        variantHint: data.variantHint as string | undefined,
      });
    }

    return tasks;
  }

  filterEligible(allTasks: TaskRequest[]): TaskRequest[] {
    return allTasks.filter((task) => {
      if (!isActionable(task.status)) return false;
      if (isIntervention(task.status)) return false;

      // Check dependency resolution
      for (const depId of task.dependsOn) {
        const dep = allTasks.find((t) => t.id === depId);
        if (!dep) continue; // Unknown dep — treat as satisfied
        if (dep.status !== TaskStatus.Done && dep.status !== TaskStatus.Canceled) {
          return false;
        }
      }

      return true;
    });
  }

  isTerminal(task: TaskRequest, allTasks: TaskRequest[]): boolean {
    return !allTasks.some(
      (t) => t.id !== task.id && t.dependsOn.includes(task.id)
    );
  }

  branchName(task: TaskRequest): string {
    return task.group ? `feat/${task.group}` : `feat/${task.id}`;
  }

  private async dispatchStage(
    task: TaskRequest,
    allTasks: TaskRequest[],
  ): Promise<void> {
    const promptName = stagePromptMap[task.status];
    if (!promptName) {
      console.error(`[Orchestrator] No prompt mapping for status: ${task.status}`);
      return;
    }

    const branch = this.branchName(task);
    const terminal = this.isTerminal(task, allTasks);
    const mergeFragment = this.loadMergeFragment(terminal);

    const fullPrompt = loadPrompt(promptName, {
      TASK_ID: task.id,
      TASK_TITLE: task.title,
      TASK_DESCRIPTION: task.description,
      BRANCH_NAME: branch,
      REPO: task.repo,
      MERGE_INSTRUCTIONS: mergeFragment,
    });

    const label = `${task.id}:${task.status}`;
    console.log(`[${label}] Dispatching stage...`);

    // Set in-progress status
    const ipStatus = inProgressStatus(task.status);
    await this.updateTaskStatus(task, ipStatus);

    const logDir = join(this.logsDir, task.id);
    const logFile = join(logDir, `${task.status.replace(/\s+/g, "-").toLowerCase()}.log`);
    await mkdir(logDir, { recursive: true });

    const header = [
      "=== Agent Log ===",
      `Ticket: ${task.id}`,
      `Title: ${task.title}`,
      `Stage: ${task.status}`,
      `Branch: ${branch}`,
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
      await this.executeClaudeCommand(sandbox, task, repoDir, label, logFile, fullPrompt);

      // Success — advance status
      const next = nextStatus(ipStatus);
      await this.updateTaskStatus(task, next);
      console.log(`[${label}] Stage complete -> ${next}`);

      // Post-implement test-writer (conditional)
      if (task.status === TaskStatus.NeedsImplement) {
        try {
          const testPrompt = loadPrompt("agent2-worker-test", {
            TASK_ID: task.id,
            TASK_TITLE: task.title,
            BRANCH_NAME: branch,
          });
          console.log(`[${label}] Running test-writer...`);
          await this.executeClaudeCommand(sandbox, task, repoDir, label, logFile, testPrompt);
          console.log(`[${label}] Test-writer complete`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${label}] Test-writer failed (non-fatal): ${msg}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${label}] Stage failed: ${msg}`);
      await this.updateTaskStatus(task, TaskStatus.Blocked);
    } finally {
      await sandbox.delete();
      const footer = `\n=== Finished: ${new Date().toISOString()} ===\n`;
      await appendFile(logFile, footer);
      console.log(`[${label}] Sandbox deleted`);
    }
  }

  private loadMergeFragment(isTerminal: boolean): string {
    if (this.mergeMode === "merge") return loadPromptFragment("merge-direct");
    if (this.mergeMode === "pr") return loadPromptFragment("merge-pr");
    // auto mode
    return isTerminal
      ? loadPromptFragment("merge-pr")
      : loadPromptFragment("merge-direct");
  }

  private async updateTaskStatus(
    task: TaskRequest,
    status: TaskStatus,
  ): Promise<void> {
    const raw = await readFile(task.filePath, "utf-8");
    const { data } = matter(raw);
    await writeFile(task.filePath, matter.stringify("", { ...data, status }));
    task.status = status;
  }

  private async setupSandboxEnvironment(
    sandbox: Sandbox,
    repo: string,
    label: string,
  ): Promise<string> {
    const repoDir = "/home/daytona/repo";
    await sandbox.git.clone(repo, repoDir);
    console.log(`[${label}] Repo cloned`);
    return repoDir;
  }

  private async installClaudeCLI(
    sandbox: Sandbox,
    label: string,
  ): Promise<void> {
    console.log(`[${label}] Installing Claude CLI...`);
    const claudeInstall = await sandbox.process.executeCommand(
      "mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global' && npm install -g @anthropic-ai/claude-code",
    );
    console.log(`[${label}] Claude CLI exit code: ${claudeInstall.exitCode}`);

    if (claudeInstall.exitCode !== 0) {
      console.error(`[${label}] Failed to install Claude CLI: ${claudeInstall.result}`);
      throw new Error("Failed to install Claude CLI");
    }

    const claudeVerify = await sandbox.process.executeCommand(
      "export PATH=~/.npm-global/bin:$PATH && which claude && claude --version",
    );
    console.log(`[${label}] Claude CLI location and version: ${claudeVerify.result}`);
  }

  private async installGitHubCLI(
    sandbox: Sandbox,
    label: string,
  ): Promise<void> {
    console.log(`[${label}] Installing GitHub CLI from binary...`);
    const ghInstall = await sandbox.process.executeCommand(
      "GH_VERSION=2.86.0 && mkdir -p ~/bin && curl -fsSL https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz -o /tmp/gh.tar.gz && tar -xzf /tmp/gh.tar.gz -C /tmp && cp /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh ~/bin/gh && chmod +x ~/bin/gh && export PATH=~/bin:$PATH",
    );
    console.log(`[${label}] GitHub CLI install exit code: ${ghInstall.exitCode}`);

    if (ghInstall.exitCode !== 0) {
      console.error(`[${label}] Failed to install gh CLI: ${ghInstall.result}`);
      throw new Error("Failed to install gh CLI");
    }

    const ghVerify = await sandbox.process.executeCommand(
      "export PATH=~/bin:$PATH && gh --version",
    );
    console.log(`[${label}] GitHub CLI version: ${ghVerify.result}`);
  }

  private async configureGit(sandbox: Sandbox, label: string): Promise<void> {
    console.log(`[${label}] Configuring git...`);
    await sandbox.process.executeCommand(
      'git config --global user.email "claude@anthropic.com"',
    );
    await sandbox.process.executeCommand(
      'git config --global user.name "Claude Agent"',
    );

    // Configure gh as git credential helper so GITHUB_TOKEN is used for HTTPS push
    const authSetup = await sandbox.process.executeCommand(
      "export PATH=/home/daytona/bin:/home/daytona/.npm-global/bin:$PATH && gh auth setup-git",
    );
    console.log(`[${label}] gh auth setup-git exit code: ${authSetup.exitCode}`);
    if (authSetup.exitCode !== 0) {
      console.error(`[${label}] gh auth setup-git failed: ${authSetup.result}`);
    }

    console.log(`[${label}] Git configured`);
  }

  private async executeClaudeCommand(
    sandbox: Sandbox,
    task: TaskRequest,
    repoDir: string,
    label: string,
    logFile: string,
    prompt?: string,
  ): Promise<void> {
    const fullPrompt = prompt ?? this.buildLegacyPrompt(task);
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

    if (buffer.trim()) {
      this.handleStreamLine(buffer, label, logFile);
    }

    console.log(`[${label}] PTY exited with code: ${result.exitCode}`);
    await appendFile(logFile, `\nPTY exited with code: ${result.exitCode}\n`);

    if (result.exitCode !== 0) {
      throw new Error(`PTY exited with code ${result.exitCode}`);
    }
  }

  private buildLegacyPrompt(task: TaskRequest): string {
    const branch = this.branchName(task);
    const prTitle = `${task.id}: ${task.title}`;
    return `You are working in a cloned git repo. Your task:

1. Create a new branch named "${branch}"
2. Implement the following feature: ${task.description}
3. Commit your changes with a clear commit message
4. Push the branch to origin
5. Create a pull request using \`gh pr create\` with title "${prTitle}" and a clear description

IMPORTANT: Use \`gh\` CLI for creating the PR (GITHUB_TOKEN is already set in the environment). Do NOT use interactive flags.`;
  }

  handleStreamLine(line: string, label: string, logFile: string): void {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
