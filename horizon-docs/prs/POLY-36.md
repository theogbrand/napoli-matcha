# PR: POLY-36 - Agent Pipeline Enhancement

**Branch**: `horizon/POLY-36`
**Linear Issue**: POLY-36
**Date**: 2026-02-14

## Summary

Transforms the napoli-matcha agent system from a single-class batch processor into a multi-phase pipeline: SpecAgent (clarification + ticket writing) → Orchestrator (stage-aware continuous dispatch loop) → Workers (6-stage pipeline in Daytona sandboxes). Adds a two-mode CLI entry point (`spec` vs default orchestrator).

## Problem

The previous system had a monolithic `SandboxQueueProcessor` that processed tasks as a simple batch with no stage awareness, dependency resolution, or clarification step. There was no way to evaluate user requests before creating tickets, and the orchestrator couldn't handle multi-stage pipelines or variant chains.

## Solution

Decomposed into 4 sub-issues (POLY-38 through POLY-41), this PR carries the final changes that bring together:

1. **Foundation modules** (merged via POLY-38): `TaskStatus` enum with helpers, `PromptLoader`, `ClaudeSpawner`
2. **SpecAgent** (merged via POLY-39): Quality gate with clarification loop, variant detection, ticket writing
3. **Orchestrator refactor** (merged via POLY-40): Stage-aware dispatch with dependency resolution, intervention handling, bounded concurrency
4. **Entry point + test-writer** (this branch): Two-mode CLI and test-writer subagent prompt

## Changes

### Files Changed
- `src/index.ts` - Refactored to two-mode CLI: `spec` command for SpecAgent, default for orchestrator
- `src/lib/SandboxQueueProcessor.ts` - Major refactor: stage-aware dispatch loop with `filterEligible()`, `isTerminal()`, `branchName()`, `dispatchStage()`, `loadAllTasks()`
- `tests/entry_point.test.ts` - New: 3 tests for CLI routing (spec mode, orchestrator mode, error handling)
- `tests/agent_logs.test.ts` - Updated for new `loadAllTasks()` interface with nested feature_requests directories
- `prompts/agent2-worker-test.md` - Refined test-writer subagent prompt
- `horizon-docs/plans/2026-02-14-POLY-36-agent-pipeline-enhancement.md` - Status updated

## Testing

### Automated
- [x] Tests pass (`npm test`) — 90/92 pass; 2 pre-existing failures from Daytona credential issues
- [x] TypeScript compiles (`npx tsc --noEmit`) — 0 errors
- [ ] Lint passes (`npm run lint`) — N/A (not configured)

### Manual Verification
- All 10 success criteria from the implementation plan verified
- Validation report: `horizon-docs/validation/2026-02-14-POLY-36-agent-pipeline-enhancement.md`

## Breaking Changes

- `SandboxQueueProcessor` interface changed: `loadTasksFromQueue()` replaced by `loadAllTasks()`, new `TaskRequest` interface with `dependsOn`, `group`, `variantHint` fields
- `feature_requests/` directory structure now uses nested `FR-{n}/AGI-{m}.md` format instead of flat queue

## Migration Notes

- Old `request_queue/` directory is left as-is; new tickets go to `feature_requests/`
- Environment variables: `NAPOLI_MAX_CONCURRENCY`, `NAPOLI_MAX_ITERATIONS`, `NAPOLI_POLL_INTERVAL`, `NAPOLI_MERGE_MODE` control orchestrator behavior

## Screenshots

N/A - non-UI changes

---
🤖 Created by [Horizon](https://github.com/ob1-sg/horizon) with [Claude Code](https://claude.ai/claude-code)
