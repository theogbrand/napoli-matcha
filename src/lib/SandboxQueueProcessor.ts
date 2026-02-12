import { Daytona, Sandbox } from "@daytonaio/sdk";
import matter from "gray-matter";
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

interface TaskRequest {
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
  private config: {
    anthropicApiKey: string;
    githubToken: string;
    claudeModel: string;
  };

  constructor(daytonaApiKey: string) {
    this.daytona = new Daytona({ apiKey: daytonaApiKey });
    this.queueDir = join(import.meta.dirname, "..", "..", "request_queue");
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
        (_, i) =>
          this.runInSandbox(
            task.description,
            `${task.title}-${i + 1}`,
            task.repo
          )
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
    const tasks: TaskRequest[] = [];

    for (const file of files) {
      const task = await this.parseTaskFile(file, join(this.queueDir, file));
      if (task) {
        tasks.push(task);
      }
    }

    return tasks;
  }

  private async parseTaskFile(
    file: string,
    filePath: string
  ): Promise<TaskRequest | null> {
    const raw = await readFile(filePath, "utf-8");
    const { data } = matter(raw);

    if (data.status !== "Backlog") {
      return null;
    }

    return {
      file,
      filePath,
      title: data.title,
      description: data.description,
      repo: data.repo,
      numberOfSandboxes: data.number_of_sandboxes,
      status: data.status,
    };
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
    prompt: string,
    label: string,
    repo: string
  ): Promise<void> {
    const sandbox = await this.daytona.create({ language: "typescript" });
    console.log(`[${label}] Sandbox created`);

    try {
      const repoDir = await this.setupSandboxEnvironment(sandbox, repo, label);
      await this.installClaudeCLI(sandbox, label);
      await this.installGitHubCLI(sandbox, label);
      await this.configureGit(sandbox, label);
      await this.executeClaudeCommand(sandbox, prompt, repoDir, label);
    } finally {
      await sandbox.delete();
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
    prompt: string,
    repoDir: string,
    label: string
  ): Promise<void> {
    const fullPrompt = `You are working in a cloned git repo. Your task:

1. Create a new branch with a descriptive name for this feature
2. Implement the following feature: ${prompt}
3. Commit your changes with a clear commit message
4. Push the branch to origin
5. Create a pull request using \`gh pr create\` with a clear title and description

IMPORTANT: Use \`gh\` CLI for creating the PR (GITHUB_TOKEN is already set in the environment). Do NOT use interactive flags.`;

    const escaped = fullPrompt.replace(/'/g, "'\\''");
    const cmd = `export PATH=~/.npm-global/bin:~/bin:$PATH && claude -p '${escaped}' --dangerously-skip-permissions --output-format=stream-json --model ${this.config.claudeModel} --verbose`;
    const env = {
      ANTHROPIC_API_KEY: this.config.anthropicApiKey,
      GITHUB_TOKEN: this.config.githubToken,
      PATH: `/home/daytona/.npm-global/bin:/home/daytona/bin:${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}`,
    };

    console.log(`[${label}] Executing command: ${cmd}`);
    const response = await sandbox.process.executeCommand(cmd, repoDir, env);
    this.parseStreamingOutput(response.result, label);
  }

  private parseStreamingOutput(output: string, label: string): void {
    const lines = output.split("\n").filter(Boolean);

    for (const line of lines) {
      const event = this.parseLine(line);
      if (!event) continue;

      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text") {
            console.log(`[${label}] ${block.text}`);
          }
        }
      } else if (event.type === "result") {
        console.log(`[${label}] Result: ${event.result}`);
      }
    }
  }

  private parseLine(line: string): any | null {
    const trimmed = line.trim();

    // Skip empty lines or lines that don't start with '{'
    if (!trimmed || !trimmed.startsWith("{")) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      // Malformed JSON - log but don't crash
      return null;
    }
  }
}
