export enum TaskStatus {
  Backlog = "Backlog",
  NeedsResearch = "Needs Research",
  ResearchInProgress = "Research In Progress",
  NeedsSpec = "Needs Spec",
  SpecInProgress = "Spec In Progress",
  NeedsPlan = "Needs Plan",
  PlanInProgress = "Plan In Progress",
  NeedsImplement = "Needs Implement",
  ImplementInProgress = "Implement In Progress",
  NeedsValidate = "Needs Validate",
  ValidateInProgress = "Validate In Progress",
  OneshotInProgress = "Oneshot In Progress",
  Blocked = "Blocked",
  NeedsHumanReview = "Needs Human Review",
  NeedsHumanDecision = "Needs Human Decision",
  AwaitingMerge = "Awaiting Merge",
  Done = "Done",
  Canceled = "Canceled",
}

const actionableStatuses = new Set<TaskStatus>([
  TaskStatus.Backlog,
  TaskStatus.NeedsResearch,
  TaskStatus.NeedsSpec,
  TaskStatus.NeedsPlan,
  TaskStatus.NeedsImplement,
  TaskStatus.NeedsValidate,
]);

export function isActionable(status: TaskStatus): boolean {
  return actionableStatuses.has(status);
}

const inProgressMap = new Map<TaskStatus, TaskStatus>([
  [TaskStatus.Backlog, TaskStatus.OneshotInProgress],
  [TaskStatus.NeedsResearch, TaskStatus.ResearchInProgress],
  [TaskStatus.NeedsSpec, TaskStatus.SpecInProgress],
  [TaskStatus.NeedsPlan, TaskStatus.PlanInProgress],
  [TaskStatus.NeedsImplement, TaskStatus.ImplementInProgress],
  [TaskStatus.NeedsValidate, TaskStatus.ValidateInProgress],
]);

export function inProgressStatus(status: TaskStatus): TaskStatus {
  const mapped = inProgressMap.get(status);
  if (!mapped) throw new Error(`No in-progress status for: ${status}`);
  return mapped;
}

const nextStatusMap = new Map<TaskStatus, TaskStatus>([
  [TaskStatus.ResearchInProgress, TaskStatus.NeedsSpec],
  [TaskStatus.SpecInProgress, TaskStatus.NeedsPlan],
  [TaskStatus.PlanInProgress, TaskStatus.NeedsImplement],
  [TaskStatus.ImplementInProgress, TaskStatus.NeedsValidate],
  [TaskStatus.ValidateInProgress, TaskStatus.Done],
  [TaskStatus.OneshotInProgress, TaskStatus.Done],
]);

export function nextStatus(status: TaskStatus): TaskStatus {
  const mapped = nextStatusMap.get(status);
  if (!mapped) throw new Error(`No next status for: ${status}`);
  return mapped;
}

export const stagePromptMap: Record<string, string> = {
  [TaskStatus.Backlog]: "agent2-worker-oneshot",
  [TaskStatus.NeedsResearch]: "agent2-worker-research",
  [TaskStatus.NeedsSpec]: "agent2-worker-spec",
  [TaskStatus.NeedsPlan]: "agent2-worker-plan",
  [TaskStatus.NeedsImplement]: "agent2-worker-implement",
  [TaskStatus.NeedsValidate]: "agent2-worker-validate",
};

export function isTerminalStage(status: TaskStatus): boolean {
  return status === TaskStatus.NeedsValidate || status === TaskStatus.ValidateInProgress;
}

const interventionStatuses = new Set<TaskStatus>([
  TaskStatus.Blocked,
  TaskStatus.NeedsHumanReview,
  TaskStatus.NeedsHumanDecision,
]);

export function isIntervention(status: TaskStatus): boolean {
  return interventionStatuses.has(status);
}
