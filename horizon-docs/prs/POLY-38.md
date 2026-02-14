# PR: POLY-38 - POLY-36a: Foundations — TaskStatus, PromptLoader, ClaudeSpawner

**Branch**: `horizon/POLY-38`
**Linear Issue**: POLY-38
**Date**: 2026-02-14

## Summary

Adds the 3 foundation modules (TaskStatus, PromptLoader, ClaudeSpawner) that all subsequent agent pipeline work depends on. This is Sub-Issue 1 of the POLY-36 Agent Pipeline Enhancement, providing the core building blocks for stage-aware task processing, prompt template loading, and local Claude CLI invocation.

## Problem

The agent pipeline enhancement (POLY-36) requires shared infrastructure for task status management, prompt template loading, and Claude CLI spawning. Without these foundations, the SpecAgent, Orchestrator refactor, and test-writer sub-issues cannot proceed.

## Solution

Implemented 3 new modules following the project's OOP/file conventions, along with 5 prompt template files and comprehensive unit tests.

## Changes

### Source Files
- `src/lib/TaskStatus.ts` — Enum with 18 statuses + 6 helper functions (isActionable, inProgressStatus, nextStatus, stagePromptMap, isTerminalStage, isIntervention)
- `src/lib/PromptLoader.ts` — loadPrompt() and loadPromptFragment() with {{variable}} substitution
- `src/lib/ClaudeSpawner.ts` — spawnClaude() for local CLI spawning with streaming JSON parsing and extractFinalOutput

### Prompt Files
- `prompts/agent0-spec.md` — SpecAgent system prompt
- `prompts/agent2-worker-test.md` — Test-writer subagent prompt
- `prompts/fragments/merge-auto.md` — Auto merge mode instructions
- `prompts/fragments/merge-direct.md` — Direct push merge instructions
- `prompts/fragments/merge-pr.md` — PR creation merge instructions

### Test Files
- `tests/task_status.test.ts` — 43 tests covering all enum values and helpers
- `tests/prompt_loader.test.ts` — 7 tests for prompt loading and substitution
- `tests/claude_spawner.test.ts` — 8 tests for streaming JSON output extraction

### Documentation
- `horizon-docs/plans/2026-02-14-POLY-36-agent-pipeline-enhancement.md` — Full implementation plan
- `horizon-docs/research/2026-02-14-POLY-36-agent-pipeline-enhancement.md` — Codebase research analysis

## Testing

### Automated
- [x] Tests pass (`npm test`) — 72 unit tests pass, 2 pre-existing integration test failures (Daytona API key, unrelated)
- [x] TypeScript compiles (`npm run typecheck` / `npx tsc --noEmit`)
- [ ] Lint passes (`npm run lint`) — No lint script configured

### Manual Verification
- Verified all 18 TaskStatus enum values match the plan spec
- Verified all 6 helper functions have correct behavior
- Verified prompt files exist and are properly structured
- Validated extractFinalOutput handles all edge cases (empty, non-JSON, subagent, error results)

## Breaking Changes

None

## Migration Notes

None — all new files, purely additive.

## Screenshots

N/A — non-UI changes

---
Created by [Horizon](https://github.com/ob1-sg/horizon) with [Claude Code](https://claude.ai/claude-code)
