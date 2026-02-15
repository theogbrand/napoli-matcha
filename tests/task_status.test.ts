import { describe, it, expect } from "vitest";
import {
  TaskStatus,
  isActionable,
  inProgressStatus,
  stagePromptMap,
  codeProducingStages,
} from "../src/lib/TaskStatus.js";

describe("TaskStatus", () => {
  describe("isActionable", () => {
    it("returns true for all Needs* statuses", () => {
      const actionable = [
        TaskStatus.NeedsResearch,
        TaskStatus.NeedsSpecification,
        TaskStatus.NeedsPlan,
        TaskStatus.NeedsImplement,
        TaskStatus.NeedsValidate,
        TaskStatus.NeedsOneshot,
      ];
      for (const s of actionable) {
        expect(isActionable(s), `${s} should be actionable`).toBe(true);
      }
    });

    it("returns false for non-actionable statuses", () => {
      const nonActionable = [
        TaskStatus.ResearchInProgress,
        TaskStatus.Done,
        TaskStatus.AwaitingMerge,
        TaskStatus.Blocked,
        TaskStatus.NeedsHumanReview,
        TaskStatus.NeedsHumanDecision,
      ];
      for (const s of nonActionable) {
        expect(isActionable(s), `${s} should not be actionable`).toBe(false);
      }
    });
  });

  describe("inProgressStatus", () => {
    it("maps each Needs* to its In Progress counterpart", () => {
      expect(inProgressStatus(TaskStatus.NeedsResearch)).toBe(TaskStatus.ResearchInProgress);
      expect(inProgressStatus(TaskStatus.NeedsSpecification)).toBe(TaskStatus.SpecificationInProgress);
      expect(inProgressStatus(TaskStatus.NeedsPlan)).toBe(TaskStatus.PlanInProgress);
      expect(inProgressStatus(TaskStatus.NeedsImplement)).toBe(TaskStatus.ImplementInProgress);
      expect(inProgressStatus(TaskStatus.NeedsValidate)).toBe(TaskStatus.ValidateInProgress);
      expect(inProgressStatus(TaskStatus.NeedsOneshot)).toBe(TaskStatus.OneshotInProgress);
    });

    it("throws for non-actionable statuses", () => {
      expect(() => inProgressStatus(TaskStatus.Done)).toThrow();
      expect(() => inProgressStatus(TaskStatus.Blocked)).toThrow();
    });
  });

  describe("stagePromptMap", () => {
    it("maps all actionable statuses to prompt filenames", () => {
      expect(stagePromptMap.get(TaskStatus.NeedsResearch)).toBe("agent2-worker-research.md");
      expect(stagePromptMap.get(TaskStatus.NeedsImplement)).toBe("agent2-worker-implement.md");
      expect(stagePromptMap.get(TaskStatus.NeedsOneshot)).toBe("agent2-worker-oneshot.md");
    });

    it("has exactly 6 entries", () => {
      expect(stagePromptMap.size).toBe(6);
    });
  });

  describe("codeProducingStages", () => {
    it("contains implement, validate, and oneshot", () => {
      expect(codeProducingStages.has(TaskStatus.NeedsImplement)).toBe(true);
      expect(codeProducingStages.has(TaskStatus.NeedsValidate)).toBe(true);
      expect(codeProducingStages.has(TaskStatus.NeedsOneshot)).toBe(true);
    });

    it("does not contain research, specification, or plan", () => {
      expect(codeProducingStages.has(TaskStatus.NeedsResearch)).toBe(false);
      expect(codeProducingStages.has(TaskStatus.NeedsSpecification)).toBe(false);
      expect(codeProducingStages.has(TaskStatus.NeedsPlan)).toBe(false);
    });
  });
});
