# Research: Agent Pipeline Enhancement

**Issue**: POLY-36
**Date**: 2026-02-14
**Status**: Complete

## Summary

POLY-36 is a large-scale enhancement to the napoli-matcha agent pipeline, transforming it from a simple batch queue processor into a full 3-phase pipeline: Spec Agent (clarification + ticket writing) -> Orchestrator (stage-aware dispatch loop) -> Workers (6-stage pipeline in Daytona sandboxes). The work is decomposed into 4 sequential sub-issues covering foundations, spec agent, orchestrator refactor, and test-writer + entry point.

## Requirements Analysis

### What's Being Built

The ticket specifies 5 major phases that map to 4 sub-issues:

1. **Foundations** (Sub-issue 1): New modules — `ClaudeSpawner` (local Claude CLI spawner), `PromptLoader` (template loading + variable substitution), `TaskStatus` (enum with 16+ statuses + helper functions)
2. **SpecAgent** (Sub-issue 2): Front-door quality gate that evaluates user requests against 5 spec criteria, runs a clarification loop, detects variant requests, and writes structured tickets to `feature_requests/`
3. **Orchestrator Refactor** (Sub-issue 3): Transform `SandboxQueueProcessor` from batch mode to continuous stage-aware dispatch loop with dependency resolution, parallel worker pool, group branching, terminal detection, and conditional test-writer + merge agent
4. **Test-Writer + Entry Point** (Sub-issue 4): New test-writer subagent prompt, two-mode CLI entry (`spec` vs orchestrator), post-validate escalation

### Key Architectural Decisions Already Made

- **Queue source**: Local MD files in `feature_requests/` (not Linear)
- **Agent 1 (reader) and Agent 3 (writer)** are absorbed into TypeScript orchestrator — no LLM needed for deterministic queue reading and result writing
- **Workers run in Daytona sandboxes**, Spec Agent runs locally via `ClaudeSpawner`
- **Stateless workers**: Each stage invocation is independent — all context comes from the ticket MD file + repo state
- **Group branching**: Variant chains share a branch (`feat/{group}`), standalone tickets get `feat/{id}`
- **Merge modes**: `auto` (default), `merge` (direct), `pr` (always PR) — configured via env var

### Success Criteria

1. `npx tsx src/index.ts spec "..."` runs Spec Agent with clarification loop
2. `npx tsx src/index.ts` runs orchestrator continuous loop
3. Tickets progress through stage pipeline: Research -> Spec -> Plan -> Implement -> Validate -> Done
4. Variant chains execute in parallel with shared group branches
5. Terminal tickets get PRs; non-terminal just push
6. Intervention statuses (`Blocked`, `Needs Human Review`, `Needs Human Decision`) are skipped by orchestrator
7. All existing tests continue passing

## Codebase Analysis

### Relevant Files

| File | Current State | Change Scope |
|------|--------------|-------------|
| `src/lib/SandboxQueueProcessor.ts` (310 LOC) | Monolithic batch processor with inline prompts | **Heavy refactor** — continuous loop, stage dispatch, dependency resolution, parallel pool |
| `src/index.ts` (15 LOC) | Simple instantiate + run | Two-mode entry: `spec` command vs orchestrator |
| `src/lib/TaskStatus.ts` | Does not exist | **New** — TaskStatus enum + `isActionable()`, `inProgressStatus()`, `stagePromptMap` |
| `src/lib/PromptLoader.ts` | Does not exist | **New** — `loadPrompt()` + `fillTemplate()` |
| `src/lib/ClaudeSpawner.ts` | Does not exist | **New** — Local Claude CLI spawner via `child_process.spawn` |
| `src/lib/SpecAgent.ts` | Does not exist | **New** — Clarification loop, ticket writer, variant chain handling |
| `prompts/` directory | Does not exist (prompts are in `.horizon/prompts/`) | **New directory** — `agent0-spec.md`, `agent2-worker-test.md`, adapted `agent2-worker.md` |
| `prompts/fragments/` | Does not exist | **New** — `merge-auto.md`, `merge-direct.md`, `merge-pr.md` |
| `feature_requests/` directory | Does not exist (`request_queue/` is current) | **New directory** — FR-{n} subdirs with AGI-{n}.md ticket files |
| `request_queue/` | 3 sample MD files (all Done) | Superseded by `feature_requests/` |
| `tests/agent_logs.test.ts` (273 LOC) | Tests handleStreamLine + loadTasksFromQueue | Will need updates for new TaskRequest interface and loadAllTasks |

### Existing Patterns

1. **Gray-matter for frontmatter**: Both reading and writing use `gray-matter` — `matter(raw)` to parse, `matter.stringify("", data)` to write. This pattern continues for `feature_requests/` tickets.
2. **PTY-based execution**: Current `executeClaudeCommand()` uses Daytona's `createPty()` with `onData` callback, line-by-line JSON parsing, ANSI stripping. Workers will continue this pattern.
3. **Daytona SDK**: `this.daytona.create()` for sandbox creation, `sandbox.git.clone()`, `sandbox.process.executeCommand()`, `sandbox.process.createPty()`, `sandbox.delete()`.
4. **Test style**: Vitest with `describe`/`it`, temp dirs via `tmpdir()`, `flush()` helper for async appendFile, private method access via `(p as any)`.
5. **Single class per file**: `SandboxQueueProcessor` is the only class. New modules follow this convention.

### Dependencies

- `@daytonaio/sdk` — Sandbox management (stays)
- `gray-matter` — YAML frontmatter (stays)
- `dotenv` — Environment loading (stays)
- **No new dependencies needed** — `ClaudeSpawner` uses Node's built-in `child_process.spawn`, `PromptLoader` uses `fs`, `readline` is built-in for Spec Agent

### Reference Implementation

The Horizon CLI Agent at `/Users/ob1/projects/startup/horizon-cli-agent` provides reference patterns:

- **`src/lib/prompts.ts`** (72 LOC): Two-tier prompt loading (project-local `.horizon/prompts/` -> package `prompts/`) with `{{VARIABLE}}` substitution. Napoli's `PromptLoader` is a simplified version loading from `prompts/` only.
- **`src/lib/claude.ts`** (518 LOC): Claude CLI spawner with streaming JSON parsing, rate limit handling, terminal formatting. Napoli's `ClaudeSpawner` strips this down to core: spawn, parse, return result.
- **`src/lib/provider.ts`**: Provider abstraction with factory registration. Napoli does NOT need this level of abstraction — single provider (Claude CLI).
- **`src/index.ts`** (841 LOC): Main orchestration loop with agent dispatch, result collection, state transitions. Napoli adapts the loop pattern but replaces Linear API calls with local MD file operations.

## Implementation Considerations

### Approach: 4 Sequential Sub-Issues

The ticket explicitly mandates sequential execution. This is correct — each sub-issue builds on tested, merged code from the previous one.

**Sub-issue 1 (Foundations)** is the safest starting point:
- 3 new files with zero existing code dependencies
- Pure utility modules (enum, file loader, CLI spawner)
- Easy to test in isolation
- Estimated scope: ~200-250 LOC across 3 files + tests

**Sub-issue 2 (SpecAgent)** depends only on foundations:
- New file with clear interface
- Self-contained clarification loop
- Ticket writing to `feature_requests/` is new directory creation
- Estimated scope: ~150-200 LOC + prompt file + tests

**Sub-issue 3 (Orchestrator Refactor)** is the highest-risk change:
- Heavy modification of `SandboxQueueProcessor.ts` (310 LOC currently)
- Changes the `TaskRequest` interface (breaking existing tests)
- New `loadAllTasks()` replaces `loadTasksFromQueue()` with glob-based discovery
- New `filterEligible()`, `isTerminal()`, `branchName()`, `dispatchStage()`
- Continuous loop with concurrent worker pool
- Existing tests will break and need updating
- Estimated scope: ~400-500 LOC refactor + test updates

**Sub-issue 4 (Test-Writer + Entry)** is integrative:
- New prompt file + small changes to `dispatchStage()` and `index.ts`
- Estimated scope: ~100 LOC + prompt file

### Risks

1. **Breaking existing tests** (Sub-issue 3): The `TaskRequest` interface changes significantly (adds `dependsOn`, `group`, `variantHint`, `featureRequest`, `status` becomes `TaskStatus` enum; removes `numberOfSandboxes`). All tests in `agent_logs.test.ts` that use the old interface will break.

2. **Queue migration**: Moving from `request_queue/` (flat dir, simple status) to `feature_requests/` (nested FR-{n} dirs, complex status). Need to decide if old queue format is maintained for backwards compatibility or cleanly replaced.

3. **ClaudeSpawner local execution**: Requires `claude` CLI installed locally on the host machine (not in a sandbox). Need `ANTHROPIC_API_KEY` set.

4. **Orchestrator crash recovery**: As noted in the ticket, orphaned `In Progress` tickets require manual reset in v1. Acceptable for initial implementation.

5. **Test-writer in sandbox**: The test-writer agent runs in the same sandbox as the worker, after implementation. If the sandbox has state issues from the worker's execution, the test-writer could be affected. Mitigation: test-writer reads git diff rather than relying on sandbox state.

6. **Merge fragment prompts**: The ticket references `prompts/fragments/merge-auto.md`, `merge-direct.md`, `merge-pr.md` — these files need to be created (or ported from Horizon if they exist there).

### Testing Strategy

**Sub-issue 1 (Foundations)**:
- Unit tests for `TaskStatus`: `isActionable()`, `inProgressStatus()`, enum completeness
- Unit tests for `PromptLoader`: `loadPrompt()` with missing files, `fillTemplate()` with variables
- Unit tests for `ClaudeSpawner`: Mock `child_process.spawn`, verify streaming JSON parsing, verify `SpawnResult` shape

**Sub-issue 2 (SpecAgent)**:
- Unit tests for output parsing (QUESTIONS vs TICKETS format)
- Unit tests for ticket writing (MD file creation, frontmatter shape)
- Unit tests for ID continuation (max AGI-{n} scan, max FR-{n} scan)
- Mock `ClaudeSpawner` to test clarification loop without real Claude calls

**Sub-issue 3 (Orchestrator)**:
- Unit tests for `filterEligible()` with various dependency graphs
- Unit tests for `isTerminal()` with downstream dependents
- Unit tests for `isActionable()` with all 16+ statuses
- Unit tests for `inProgressStatus()` mapping
- Unit tests for `loadAllTasks()` with nested `feature_requests/` structure
- Update existing `agent_logs.test.ts` for new `TaskRequest` interface

**Sub-issue 4 (Test-Writer + Entry)**:
- Unit tests for entry point mode selection
- Integration test for post-validate escalation logic

## Specification Assessment

This feature does **NOT** need a UX specification:
- It is purely backend/infrastructure — no user-facing UI changes
- The "user interface" is CLI commands (`npx tsx src/index.ts spec "..."` and `npx tsx src/index.ts`)
- The Spec Agent's clarification loop is a text-based readline interaction — no UX design decisions needed
- All architectural and design decisions are already made in the ticket description
- The ticket includes exact code snippets, enum definitions, interface shapes, and pipeline diagrams

**Needs Specification**: No

## Questions for Human Review

1. **Queue migration strategy**: Should `request_queue/` be kept alongside `feature_requests/`, or should it be removed? The ticket implies `feature_requests/` replaces `request_queue/`, but existing tests reference `request_queue/` files.

2. **Prompt directory location**: The ticket says prompts should live in `prompts/` (project root), but current Horizon prompts are in `.horizon/prompts/`. Should we create a new top-level `prompts/` directory, or adapt the existing `.horizon/prompts/` structure?

3. **Merge fragment source**: Do the merge fragment prompts (`merge-auto.md`, `merge-direct.md`, `merge-pr.md`) need to be ported from the Horizon reference implementation, or written fresh?

4. **Backwards compatibility with existing queue**: The 3 existing task files in `request_queue/` (all status: Done) — should the new `loadAllTasks()` also check `request_queue/` for backwards compatibility, or is a clean break acceptable?

These questions are non-blocking — reasonable defaults exist for each (clean break, new `prompts/` dir, port from Horizon, ignore old queue). They can be resolved during implementation.

## Next Steps

Ready for planning phase. The research confirms this is a well-specified, staged implementation that should proceed directly to planning without a specification phase. The ticket description itself serves as a detailed specification with exact code, interfaces, and architecture.

Sub-issues should be created as Linear issues blocking each other in sequence:
1. Foundations (ClaudeSpawner, PromptLoader, TaskStatus)
2. SpecAgent (quality gate, clarification loop, ticket writer)
3. Orchestrator Refactor (stage-aware dispatch, continuous loop)
4. Test-Writer + Entry Point (test agent, two-mode CLI)
