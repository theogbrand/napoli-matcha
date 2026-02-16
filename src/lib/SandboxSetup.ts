import { Sandbox } from "@daytonaio/sdk";
import { readdir } from "fs/promises";
import { join } from "path";

export async function setupSandboxEnvironment(
  sandbox: Sandbox,
  repo: string,
  label: string
): Promise<string> {
  const repoDir = "/root/repo";
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
    `GITHUB_TOKEN=${githubToken} gh auth setup-git`
  );
  console.log(`[${label}] Git configured`);
}

export async function generatePreviewUrls(
  sandbox: Sandbox,
  ports: number[] = [3000, 5173, 8080],
  expiresInSeconds: number = 7200
): Promise<Record<number, string>> {
  const urls: Record<number, string> = {};
  for (const port of ports) {
    const signed = await sandbox.getSignedPreviewUrl(port, expiresInSeconds);
    urls[port] = signed.url;
  }
  return urls;
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
