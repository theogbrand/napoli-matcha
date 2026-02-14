# PR: POLY-40 - Orchestrator Refactor — Stage-Aware Dispatch Loop

**Branch**: `horizon/POLY-40`
**Linear Issue**: POLY-40
**Date**: 2026-02-14

## Summary

Transforms `SandboxQueueProcessor` from a batch processor into a continuous stage-aware dispatch loop with dependency resolution, bounded concurrency, and group-aware branching. This is the highest-risk sub-issue in the Agent Pipeline Enhancement (POLY-36) — it refactors the core 310 LOC orchestrator monolith.

## Problem

The existing orchestrator operated in batch mode: load all Backlog tasks, process them all in parallel, exit. It had no concept of multi-stage pipelines, dependency chains between tickets, or continuous operation. This prevented implementing the 6-stage agent pipeline (Research → Spec → Plan → Implement → Validate → Done).

## Solution

Refactored `SandboxQueueProcessor` into a continuous loop that:
1. Discovers tasks via nested `feature_requests/FR-*/AGI-*.md` glob patterns
2. Filters eligible tasks using dependency resolution (`filterEligible`)
3. Dispatches the correct stage prompt via `stagePromptMap` + `PromptLoader`
4. Manages bounded concurrency with configurable worker pool
5. Supports graceful shutdown via SIGINT/SIGTERM

## Changes

### Phase 3.1: Updated TaskRequest Interface
- Added `featureRequest`, `dependsOn`, `group`, `variantHint` fields
- Changed `status` from string to `TaskStatus` enum
- Removed `numberOfSandboxes` (one sandbox per stage now)

### Phase 3.2: Task Loading Refactor
- Replaced `loadTasksFromQueue()` with `loadAllTasks()`
- Globs `feature_requests/FR-*/AGI-*.md` for nested discovery
- Auto-assigns AGI IDs to tasks missing them

### Phase 3.3: Dependency Resolution
- `filterEligible()` checks `isActionable()`, `isIntervention()`, and dependency satisfaction
- Done/Canceled dependencies are treated as satisfied

### Phase 3.4: Terminal Detection & Branching
- `isTerminal()` detects chain-end tickets (no downstream dependents)
- `branchName()` returns `feat/{group}` for grouped tasks, `feat/{id}` for standalone

### Phase 3.5: Stage Dispatch
- `dispatchStage()` loads prompts via PromptLoader, selects merge fragment, sets in-progress status
- Conditional test-writer runs after implement stage

### Phase 3.6: Continuous Loop
- `processQueue()` is now a continuous while loop with bounded concurrency
- Configurable via env vars: `NAPOLI_MAX_CONCURRENCY`, `NAPOLI_MAX_ITERATIONS`, `NAPOLI_POLL_INTERVAL`, `NAPOLI_MERGE_MODE`

### Phase 3.7-3.8: Tests
- Updated `agent_logs.test.ts` (15 tests: 7 handleStreamLine + 8 new loadAllTasks)
- New `orchestrator.test.ts` (13 tests: filterEligible, isTerminal, branchName, loadAllTasks)

### Files Changed
- `src/lib/SandboxQueueProcessor.ts` — Core refactor (+340 LOC changes)
- `tests/agent_logs.test.ts` — Updated tests for new interface
- `tests/orchestrator.test.ts` — New test file (234 LOC)
- `horizon-docs/plans/2026-02-14-POLY-36-agent-pipeline-enhancement.md` — Status update

## Testing

### Automated
- [x] Tests pass (`npm test`) — 101 unit tests pass
- [x] TypeScript compiles (`npx tsc --noEmit`) — zero errors
- [ ] Lint passes (`npm run lint`) — N/A (no lint script configured)

### Manual Verification
- Reviewed all 8 implementation phases against plan specification
- Verified dependency resolution logic, terminal detection, and branch naming
- Confirmed 4 failing tests are pre-existing integration tests (network/sandbox-dependent)

## Breaking Changes

- `TaskRequest` interface changed: `status` is now `TaskStatus` enum instead of string; `numberOfSandboxes` removed; new required fields added
- `loadTasksFromQueue()` replaced by `loadAllTasks()` — reads from `feature_requests/` instead of `request_queue/`
- `processQueue()` is now a continuous loop instead of one-shot batch

## Migration Notes

- Tasks must be in `feature_requests/FR-{n}/AGI-{m}.md` nested structure (old `request_queue/` format no longer read)
- New env vars available: `NAPOLI_MAX_CONCURRENCY` (default: 3), `NAPOLI_MAX_ITERATIONS` (default: 0/unlimited), `NAPOLI_POLL_INTERVAL` (default: 30s), `NAPOLI_MERGE_MODE` (default: auto)

## Screenshots

N/A — non-UI changes

---
🤖 Created by [Horizon](https://github.com/ob1-sg/horizon) with [Claude Code](https://claude.ai/claude-code)
