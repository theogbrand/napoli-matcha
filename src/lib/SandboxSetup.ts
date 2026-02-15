import { Sandbox } from "@daytonaio/sdk";
import { readdir } from "fs/promises";
import { join } from "path";

export async function setupSandboxEnvironment(
  sandbox: Sandbox,
  repo: string,
  label: string
): Promise<string> {
  const repoDir = "/home/daytona/repo";
  await sandbox.git.clone(repo, repoDir);
  console.log(`[${label}] Repo cloned`);

  await uploadPromptFiles(sandbox, repoDir, label);

  return repoDir;
}

async function uploadPromptFiles(
  sandbox: Sandbox,
  repoDir: string,
  label: string
): Promise<void> {
  const promptsDir = join(import.meta.dirname, "..", "..", "prompts");
  const files: { source: string; destination: string }[] = [];

  for (const entry of await readdir(promptsDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      files.push({
        source: join(promptsDir, entry.name),
        destination: `${repoDir}/.dawn/prompts/${entry.name}`,
      });
    } else if (entry.isDirectory()) {
      const subDir = join(promptsDir, entry.name);
      for (const sub of await readdir(subDir)) {
        files.push({
          source: join(subDir, sub),
          destination: `${repoDir}/.dawn/prompts/${entry.name}/${sub}`,
        });
      }
    }
  }

  await sandbox.fs.uploadFiles(files);
  console.log(`[${label}] Uploaded ${files.length} prompt files to .dawn/`);
}

export async function installClaudeCLI(
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
  console.log(
    `[${label}] Claude CLI location and version: ${claudeVerify.result}`
  );
}

export async function installGitHubCLI(
  sandbox: Sandbox,
  label: string
): Promise<void> {
  console.log(`[${label}] Installing GitHub CLI from binary...`);
  const ghInstall = await sandbox.process.executeCommand(
    "GH_VERSION=2.86.0 && mkdir -p ~/bin && curl -fsSL https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz -o /tmp/gh.tar.gz && tar -xzf /tmp/gh.tar.gz -C /tmp && cp /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh ~/bin/gh && chmod +x ~/bin/gh && export PATH=~/bin:$PATH"
  );
  console.log(
    `[${label}] GitHub CLI install exit code: ${ghInstall.exitCode}`
  );

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

export async function configureGit(
  sandbox: Sandbox,
  label: string,
  githubToken: string
): Promise<void> {
  console.log(`[${label}] Configuring git...`);
  await sandbox.process.executeCommand(
    'git config --global user.email "dawn-agent@anthropic.com"'
  );
  await sandbox.process.executeCommand(
    'git config --global user.name "Dawn Agent"'
  );
  // Enable gh as git credential helper for push/PR operations
  await sandbox.process.executeCommand(
    `GITHUB_TOKEN=${githubToken} PATH=~/bin:$PATH gh auth setup-git`
  );
  console.log(`[${label}] Git configured`);
}

export async function setupBranch(
  sandbox: Sandbox,
  repoDir: string,
  branch: string,
  label: string
): Promise<void> {
  console.log(`[${label}] Setting up branch ${branch}...`);
  // Try to check out existing remote branch, or create a new one
  const checkout = await sandbox.process.executeCommand(
    `cd ${repoDir} && git fetch origin && git checkout ${branch} 2>/dev/null || git checkout -b ${branch}`
  );
  if (checkout.exitCode !== 0) {
    throw new Error(`Failed to setup branch ${branch}: ${checkout.result}`);
  }
  console.log(`[${label}] On branch ${branch}`);
}
