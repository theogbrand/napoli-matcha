# Validation Report: POLY-36a: Foundations — TaskStatus, PromptLoader, ClaudeSpawner

**Issue**: POLY-38
**Date**: 2026-02-14
**Plan**: `horizon-docs/plans/2026-02-14-POLY-36-agent-pipeline-enhancement.md` (Sub-Issue 1)
**Status**: PASSED

## Summary

All foundation modules are implemented correctly and match the plan specification. 72 unit tests pass, TypeScript compiles cleanly, and all 3 source files + 5 prompt files are present with the expected functionality.

## Automated Checks

### Tests
- Status: PASS
- Output: 72 passed, 2 failed (pre-existing integration tests requiring Daytona API key — unrelated to this change)
- New tests: 58 (43 TaskStatus + 7 PromptLoader + 8 ClaudeSpawner)

### TypeScript
- Status: PASS
- Errors: 0 (`npx tsc --noEmit` clean)

### Lint
- Status: N/A (no lint script configured in package.json)

## Success Criteria Verification

| Criterion | Status | Notes |
|-----------|--------|-------|
| TaskStatus enum has 18 statuses | PASS | All 18 values present: Backlog, NeedsResearch, ResearchInProgress, NeedsSpec, SpecInProgress, NeedsPlan, PlanInProgress, NeedsImplement, ImplementInProgress, NeedsValidate, ValidateInProgress, OneshotInProgress, Blocked, NeedsHumanReview, NeedsHumanDecision, AwaitingMerge, Done, Canceled |
| `isActionable()` helper | PASS | Returns true for Backlog + 5 Needs* statuses, false for all others. Tested with 18 exhaustive cases. |
| `inProgressStatus()` helper | PASS | Maps 6 actionable statuses to their in-progress equivalents. Throws for non-actionable. |
| `nextStatus()` helper | PASS | Maps 6 in-progress statuses to next stage. Throws for statuses without a next. |
| `stagePromptMap` | PASS | Maps all 6 actionable statuses to prompt file names. |
| `isTerminalStage()` helper | PASS | Returns true for NeedsValidate and ValidateInProgress only. |
| `isIntervention()` helper | PASS | Returns true for Blocked, NeedsHumanReview, NeedsHumanDecision only. |
| PromptLoader `loadPrompt()` | PASS | Reads from `prompts/{name}.md`, supports `{{VAR}}` substitution, throws on missing file. |
| PromptLoader `loadPromptFragment()` | PASS | Reads from `prompts/fragments/{name}.md`, throws on missing file. |
| ClaudeSpawner `spawnClaude()` | PASS | Spawns `claude` CLI with correct flags, pipes prompt via stdin, collects streaming JSON. |
| ClaudeSpawner `extractFinalOutput()` | PASS | Extracts last assistant text, prefers result text, ignores subagent messages, handles edge cases. |
| Prompt: `agent0-spec.md` | PASS | Present at `prompts/agent0-spec.md`. |
| Prompt: `agent2-worker-test.md` | PASS | Present at `prompts/agent2-worker-test.md`. |
| Prompt: `merge-auto.md` | PASS | Present at `prompts/fragments/merge-auto.md`. |
| Prompt: `merge-direct.md` | PASS | Present at `prompts/fragments/merge-direct.md`. |
| Prompt: `merge-pr.md` | PASS | Present at `prompts/fragments/merge-pr.md`. |
| Unit tests for TaskStatus | PASS | 43 tests covering all enum values, all 6 helpers, happy + error paths. |
| Unit tests for PromptLoader | PASS | 7 tests: load, missing, substitution, multi-occurrence, unmatched vars, fragments. |
| Unit tests for ClaudeSpawner | PASS | 8 tests: extractFinalOutput with various stream shapes, edge cases (empty, non-JSON, subagent, error results). |
| `npx tsc --noEmit` passes | PASS | No type errors. |

## Issues Found

None. Implementation is clean, complete, and matches the spec.

## Recommendation

APPROVE: Ready for production. All success criteria for Sub-Issue 1 (Foundations) are met. The implementation provides a solid foundation for Sub-Issues 2-4 (SpecAgent, Orchestrator Refactor, Test-Writer + Entry Point).
