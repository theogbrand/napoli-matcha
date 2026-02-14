import { describe, it, expect } from "vitest";
import {
  TaskStatus,
  isActionable,
  inProgressStatus,
  nextStatus,
  stagePromptMap,
  isTerminalStage,
  isIntervention,
} from "../src/lib/TaskStatus.js";

describe("TaskStatus", () => {
  it("has 18 enum values", () => {
    const values = Object.values(TaskStatus);
    expect(values).toHaveLength(18);
  });

  describe("isActionable", () => {
    const actionable = [
      TaskStatus.Backlog,
      TaskStatus.NeedsResearch,
      TaskStatus.NeedsSpec,
      TaskStatus.NeedsPlan,
      TaskStatus.NeedsImplement,
      TaskStatus.NeedsValidate,
    ];

    for (const status of actionable) {
      it(`returns true for ${status}`, () => {
        expect(isActionable(status)).toBe(true);
      });
    }

    const nonActionable = [
      TaskStatus.ResearchInProgress,
      TaskStatus.SpecInProgress,
      TaskStatus.PlanInProgress,
      TaskStatus.ImplementInProgress,
      TaskStatus.ValidateInProgress,
      TaskStatus.OneshotInProgress,
      TaskStatus.Blocked,
      TaskStatus.NeedsHumanReview,
      TaskStatus.NeedsHumanDecision,
      TaskStatus.AwaitingMerge,
      TaskStatus.Done,
      TaskStatus.Canceled,
    ];

    for (const status of nonActionable) {
      it(`returns false for ${status}`, () => {
        expect(isActionable(status)).toBe(false);
      });
    }
  });

  describe("inProgressStatus", () => {
    it("maps Backlog to OneshotInProgress", () => {
      expect(inProgressStatus(TaskStatus.Backlog)).toBe(
        TaskStatus.OneshotInProgress,
      );
    });

    it("maps NeedsResearch to ResearchInProgress", () => {
      expect(inProgressStatus(TaskStatus.NeedsResearch)).toBe(
        TaskStatus.ResearchInProgress,
      );
    });

    it("maps NeedsImplement to ImplementInProgress", () => {
      expect(inProgressStatus(TaskStatus.NeedsImplement)).toBe(
        TaskStatus.ImplementInProgress,
      );
    });

    it("maps NeedsValidate to ValidateInProgress", () => {
      expect(inProgressStatus(TaskStatus.NeedsValidate)).toBe(
        TaskStatus.ValidateInProgress,
      );
    });

    it("throws for non-actionable status", () => {
      expect(() => inProgressStatus(TaskStatus.Done)).toThrow(
        "No in-progress status for: Done",
      );
    });

    it("throws for in-progress status", () => {
      expect(() =>
        inProgressStatus(TaskStatus.ImplementInProgress),
      ).toThrow();
    });
  });

  describe("nextStatus", () => {
    it("maps ResearchInProgress to NeedsSpec", () => {
      expect(nextStatus(TaskStatus.ResearchInProgress)).toBe(
        TaskStatus.NeedsSpec,
      );
    });

    it("maps SpecInProgress to NeedsPlan", () => {
      expect(nextStatus(TaskStatus.SpecInProgress)).toBe(
        TaskStatus.NeedsPlan,
      );
    });

    it("maps PlanInProgress to NeedsImplement", () => {
      expect(nextStatus(TaskStatus.PlanInProgress)).toBe(
        TaskStatus.NeedsImplement,
      );
    });

    it("maps ImplementInProgress to NeedsValidate", () => {
      expect(nextStatus(TaskStatus.ImplementInProgress)).toBe(
        TaskStatus.NeedsValidate,
      );
    });

    it("maps ValidateInProgress to Done", () => {
      expect(nextStatus(TaskStatus.ValidateInProgress)).toBe(TaskStatus.Done);
    });

    it("maps OneshotInProgress to Done", () => {
      expect(nextStatus(TaskStatus.OneshotInProgress)).toBe(TaskStatus.Done);
    });

    it("throws for statuses without a next", () => {
      expect(() => nextStatus(TaskStatus.Done)).toThrow(
        "No next status for: Done",
      );
    });
  });

  describe("stagePromptMap", () => {
    it("has entries for all actionable statuses", () => {
      expect(stagePromptMap[TaskStatus.Backlog]).toBe(
        "agent2-worker-oneshot",
      );
      expect(stagePromptMap[TaskStatus.NeedsResearch]).toBe(
        "agent2-worker-research",
      );
      expect(stagePromptMap[TaskStatus.NeedsSpec]).toBe("agent2-worker-spec");
      expect(stagePromptMap[TaskStatus.NeedsPlan]).toBe("agent2-worker-plan");
      expect(stagePromptMap[TaskStatus.NeedsImplement]).toBe(
        "agent2-worker-implement",
      );
      expect(stagePromptMap[TaskStatus.NeedsValidate]).toBe(
        "agent2-worker-validate",
      );
    });

    it("does not have entries for non-actionable statuses", () => {
      expect(stagePromptMap[TaskStatus.Done]).toBeUndefined();
      expect(stagePromptMap[TaskStatus.Blocked]).toBeUndefined();
    });
  });

  describe("isTerminalStage", () => {
    it("returns true for NeedsValidate", () => {
      expect(isTerminalStage(TaskStatus.NeedsValidate)).toBe(true);
    });

    it("returns true for ValidateInProgress", () => {
      expect(isTerminalStage(TaskStatus.ValidateInProgress)).toBe(true);
    });

    it("returns false for NeedsImplement", () => {
      expect(isTerminalStage(TaskStatus.NeedsImplement)).toBe(false);
    });

    it("returns false for Done", () => {
      expect(isTerminalStage(TaskStatus.Done)).toBe(false);
    });
  });

  describe("isIntervention", () => {
    it("returns true for Blocked", () => {
      expect(isIntervention(TaskStatus.Blocked)).toBe(true);
    });

    it("returns true for NeedsHumanReview", () => {
      expect(isIntervention(TaskStatus.NeedsHumanReview)).toBe(true);
    });

    it("returns true for NeedsHumanDecision", () => {
      expect(isIntervention(TaskStatus.NeedsHumanDecision)).toBe(true);
    });

    it("returns false for Backlog", () => {
      expect(isIntervention(TaskStatus.Backlog)).toBe(false);
    });

    it("returns false for Done", () => {
      expect(isIntervention(TaskStatus.Done)).toBe(false);
    });
  });
});
