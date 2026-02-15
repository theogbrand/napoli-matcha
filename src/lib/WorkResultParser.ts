import { TaskStatus } from "./TaskStatus.js";

export interface WorkResult {
  success: boolean;
  stageCompleted?: string;
  nextStatus?: TaskStatus;
  branchName?: string;
  commitHash?: string;
  mergeStatus?: string;
  prUrl?: string;
  summary?: string;
  error?: string;
}

const statusLookup = new Map<string, TaskStatus>(
  Object.values(TaskStatus).map((v) => [v.toLowerCase(), v as TaskStatus])
);

export function resolveNextStatus(raw: string): TaskStatus | null {
  const cleaned = raw.replace(/^["']|["']$/g, "").replace(/^∞\s*/, "").trim();
  return statusLookup.get(cleaned.toLowerCase()) ?? null;
}

export function parseWorkResult(output: string): WorkResult | null {
  const marker = "WORK_RESULT:";
  const lastIdx = output.lastIndexOf(marker);
  if (lastIdx === -1) return null;

  const block = output.slice(lastIdx + marker.length);
  const lines = block.split("\n");

  const kv = new Map<string, string>();
  let currentKey = "";
  let multilineValue = "";

  for (const line of lines) {
    // Stop at obvious non-WORK_RESULT content (e.g. code fences, new sections)
    if (line.startsWith("```")) break;

    const match = line.match(/^\s{2}(\w[\w_]*):\s*(.*)/);
    if (match) {
      if (currentKey) kv.set(currentKey, multilineValue.trim());
      currentKey = match[1];
      multilineValue = match[2];
    } else if (currentKey && (line.startsWith("    ") || line.trim() === "")) {
      multilineValue += "\n" + line.trimStart();
    } else if (currentKey && line.trim() === "") {
      // blank line continues multiline
    } else if (!line.trim()) {
      continue;
    } else {
      // non-indented, non-matching line ends the block
      break;
    }
  }
  if (currentKey) kv.set(currentKey, multilineValue.trim());

  if (kv.size === 0) return null;

  const result: WorkResult = {
    success: kv.get("success") === "true",
  };

  if (kv.has("stage_completed")) result.stageCompleted = kv.get("stage_completed");
  if (kv.has("branch_name")) result.branchName = kv.get("branch_name");
  if (kv.has("commit_hash")) result.commitHash = kv.get("commit_hash");
  if (kv.has("merge_status")) result.mergeStatus = kv.get("merge_status");
  if (kv.has("pr_url")) result.prUrl = kv.get("pr_url");
  if (kv.has("summary")) result.summary = kv.get("summary");
  if (kv.has("error")) result.error = kv.get("error");

  if (kv.has("next_status")) {
    const resolved = resolveNextStatus(kv.get("next_status")!);
    if (resolved) {
      result.nextStatus = resolved;
    } else {
      console.warn(`[Dawn] Unknown next_status "${kv.get("next_status")}", ignoring`);
    }
  }

  return result;
}
