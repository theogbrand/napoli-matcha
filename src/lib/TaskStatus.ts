export enum TaskStatus {
  NeedsResearch = "Needs Research",
  ResearchInProgress = "Research In Progress",
  NeedsSpecification = "Needs Specification",
  SpecificationInProgress = "Specification In Progress",
  NeedsPlan = "Needs Plan",
  PlanInProgress = "Plan In Progress",
  NeedsImplement = "Needs Implement",
  ImplementInProgress = "Implement In Progress",
  NeedsValidate = "Needs Validate",
  ValidateInProgress = "Validate In Progress",
  NeedsOneshot = "Needs Oneshot",
  OneshotInProgress = "Oneshot In Progress",
  Done = "Done",
  AwaitingMerge = "Awaiting Merge",
  Blocked = "Blocked",
  NeedsHumanReview = "Needs Human Review",
  NeedsHumanDecision = "Needs Human Decision",
}

const actionableStatuses = new Set<TaskStatus>([
  TaskStatus.NeedsResearch,
  TaskStatus.NeedsSpecification,
  TaskStatus.NeedsPlan,
  TaskStatus.NeedsImplement,
  TaskStatus.NeedsValidate,
  TaskStatus.NeedsOneshot,
]);

export function isActionable(status: TaskStatus): boolean {
  return actionableStatuses.has(status);
}

const inProgressMap = new Map<TaskStatus, TaskStatus>([
  [TaskStatus.NeedsResearch, TaskStatus.ResearchInProgress],
  [TaskStatus.NeedsSpecification, TaskStatus.SpecificationInProgress],
  [TaskStatus.NeedsPlan, TaskStatus.PlanInProgress],
  [TaskStatus.NeedsImplement, TaskStatus.ImplementInProgress],
  [TaskStatus.NeedsValidate, TaskStatus.ValidateInProgress],
  [TaskStatus.NeedsOneshot, TaskStatus.OneshotInProgress],
]);

export function inProgressStatus(status: TaskStatus): TaskStatus {
  const mapped = inProgressMap.get(status);
  if (!mapped) throw new Error(`No in-progress mapping for status: ${status}`);
  return mapped;
}

export const stagePromptMap = new Map<TaskStatus, string>([
  [TaskStatus.NeedsResearch, "agent2-worker-research.md"],
  [TaskStatus.NeedsSpecification, "agent2-worker-specification.md"],
  [TaskStatus.NeedsPlan, "agent2-worker-plan.md"],
  [TaskStatus.NeedsImplement, "agent2-worker-implement.md"],
  [TaskStatus.NeedsValidate, "agent2-worker-validate.md"],
  [TaskStatus.NeedsOneshot, "agent2-worker-oneshot.md"],
]);

export const codeProducingStages = new Set<TaskStatus>([
  TaskStatus.NeedsImplement,
  TaskStatus.NeedsValidate,
  TaskStatus.NeedsOneshot,
]);
