# Implementation Plan: Agent Pipeline Enhancement

**Issue**: POLY-36
**Date**: 2026-02-14
**Research**: `horizon-docs/research/2026-02-14-POLY-36-agent-pipeline-enhancement.md`
**Specification**: N/A (pure backend/infrastructure)
**Status**: Implementation Complete — All 4 Sub-Issues Done

## Overview

Transform the napoli-matcha agent system from a single-class batch processor (`SandboxQueueProcessor`, 310 LOC) into a 3-phase pipeline: **SpecAgent** (clarification + ticket writing) -> **Orchestrator** (stage-aware continuous dispatch loop) -> **Workers** (6-stage pipeline in Daytona sandboxes). The work is decomposed into 4 sequential sub-issues that must be merged in order.

## Design Decisions

These defaults resolve the 4 non-blocking questions from research:

1. **Queue migration**: Clean break — `feature_requests/` replaces `request_queue/`. Old queue is left as-is (all tasks are Done). `loadAllTasks()` reads only from `feature_requests/`.
2. **Prompt directory**: New top-level `prompts/` directory at project root. This separates napoli-matcha agent prompts from Horizon system prompts in `.horizon/prompts/`.
3. **Merge fragments**: Written fresh for napoli-matcha's needs (simpler than Horizon's). Three modes: `auto` (PR for terminal, push for non-terminal), `merge` (always direct push), `pr` (always PR).
4. **Backwards compatibility**: None required. Clean break from old `request_queue/` format.

## Success Criteria

- [ ] `npx tsx src/index.ts spec "Build a REST API"` runs SpecAgent with clarification loop, writes tickets to `feature_requests/`
- [ ] `npx tsx src/index.ts` runs orchestrator continuous loop, picks up eligible tasks
- [ ] Tickets progress through stages: Research -> Spec -> Plan -> Implement -> Validate -> Done
- [ ] `filterEligible()` resolves `dependsOn` — blocked tickets are skipped
- [ ] `isTerminal()` detects chain-end tickets — terminal gets PR, non-terminal just pushes
- [ ] Variant chains share group branches (`feat/{group}`), standalone get `feat/{id}`
- [ ] Intervention statuses (`Blocked`, `Needs Human Review`, `Needs Human Decision`) are skipped
- [ ] All existing tests pass (updated for new interfaces)
- [ ] All new modules have unit tests
- [ ] Type check passes: `npx tsc --noEmit`
- [ ] Lint passes (if configured)

---

## Sub-Issue 1: Foundations

**Goal**: Create the 3 foundation modules that all subsequent work depends on — `TaskStatus`, `PromptLoader`, `ClaudeSpawner`.

### Phase 1.1: TaskStatus Enum + Helpers (`src/lib/TaskStatus.ts`)

**Changes**:
- `src/lib/TaskStatus.ts`: New file (~80 LOC)

**Implementation**:

```typescript
// src/lib/TaskStatus.ts

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
```

Helper functions to define in the same file:

- `isActionable(status: TaskStatus): boolean` — Returns `true` for `Needs*` statuses and `Backlog`. These are the statuses the orchestrator can pick up.
- `inProgressStatus(status: TaskStatus): TaskStatus` — Maps `Needs Research` -> `Research In Progress`, `Needs Implement` -> `Implement In Progress`, etc. Throws for non-actionable statuses.
- `nextStatus(status: TaskStatus): TaskStatus` — Maps `Research In Progress` -> `Needs Spec`, `Implement In Progress` -> `Needs Validate`, etc. Used after successful stage completion.
- `stagePromptMap: Record<string, string>` — Maps actionable statuses to prompt file names: `"Needs Research" -> "agent2-worker-research"`, `"Needs Implement" -> "agent2-worker-implement"`, etc.
- `isTerminalStage(status: TaskStatus): boolean` — Returns `true` only for `Needs Validate` and `Validate In Progress` (last stage before Done).
- `isIntervention(status: TaskStatus): boolean` — Returns `true` for `Blocked`, `Needs Human Review`, `Needs Human Decision`.

### Phase 1.2: PromptLoader (`src/lib/PromptLoader.ts`)

**Changes**:
- `src/lib/PromptLoader.ts`: New file (~40 LOC)

**Implementation**:

Simplified version of Horizon's `prompts.ts`. Single-directory lookup from `prompts/` at project root (no two-tier fallback needed).

```typescript
// src/lib/PromptLoader.ts

export function loadPrompt(name: string, variables?: Record<string, string>): string
export function loadPromptFragment(name: string): string
```

- `loadPrompt(name, variables?)`: Reads `prompts/{name}.md`, substitutes `{{KEY}}` placeholders with values from `variables` map. Throws if file not found.
- `loadPromptFragment(name)`: Reads `prompts/fragments/{name}.md`. Throws if not found.
- Uses `readFileSync` for simplicity (prompts are small, loaded once).

### Phase 1.3: ClaudeSpawner (`src/lib/ClaudeSpawner.ts`)

**Changes**:
- `src/lib/ClaudeSpawner.ts`: New file (~100 LOC)

**Implementation**:

Stripped-down version of Horizon's `claude.ts`. Spawns `claude` CLI locally via `child_process.spawn`, parses streaming JSON, returns structured result.

```typescript
// src/lib/ClaudeSpawner.ts

export interface SpawnResult {
  output: string;          // Raw streaming JSON output
  finalOutput: string;     // Last assistant text or result text
  cost: number;            // total_cost_usd from result event
  duration: number;        // duration_ms from result event
  exitCode: number;
}

export interface SpawnOptions {
  prompt: string;
  model?: string;          // Default: claude-sonnet-4-5-20250929
  workingDirectory?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
}

export async function spawnClaude(options: SpawnOptions): Promise<SpawnResult>
```

Key behaviors:
- Spawns `claude -p --dangerously-skip-permissions --output-format=stream-json --model {model} --verbose`
- Pipes prompt via stdin, closes stdin
- Collects stdout line-by-line, parses JSON events
- Extracts `finalOutput` from last assistant text block or result event (same logic as Horizon's `extractFinalOutput`)
- Captures `cost` and `duration` from `result` event
- Resolves when process exits

### Phase 1.4: Prompt Files

**Changes**:
- `prompts/agent0-spec.md`: New file — SpecAgent system prompt (clarification criteria, output format)
- `prompts/agent2-worker-test.md`: New file — Test-writer subagent prompt
- `prompts/fragments/merge-auto.md`: New file — Auto merge instructions (PR for terminal, push for non-terminal)
- `prompts/fragments/merge-direct.md`: New file — Always push directly
- `prompts/fragments/merge-pr.md`: New file — Always create PR

The `agent0-spec.md` prompt should instruct Claude to:
1. Evaluate the user request against 5 spec criteria (clarity, scope, testability, completeness, no ambiguity)
2. Output either `QUESTIONS:` (list of clarification questions) or `TICKETS:` (structured ticket YAML)
3. For variant requests, output multiple tickets with `group` and `variantHint` fields

The `agent2-worker-test.md` prompt should instruct Claude to:
1. Read the git diff of recent changes
2. Write unit tests for all new/modified public methods
3. Follow vitest patterns from existing tests
4. Run tests and fix failures

### Phase 1.5: Tests

**Changes**:
- `tests/task_status.test.ts`: New file (~100 LOC)
- `tests/prompt_loader.test.ts`: New file (~60 LOC)
- `tests/claude_spawner.test.ts`: New file (~80 LOC)

**Tests for TaskStatus**:
- `isActionable()` returns true for all `Needs*` + `Backlog`, false for `*InProgress`, `Done`, `Canceled`, intervention statuses
- `inProgressStatus()` maps correctly for each actionable status, throws for non-actionable
- `nextStatus()` maps correctly for each in-progress status
- `stagePromptMap` has entries for all actionable statuses
- `isIntervention()` returns true only for the 3 intervention statuses

**Tests for PromptLoader**:
- `loadPrompt()` returns content for existing prompt
- `loadPrompt()` throws for missing prompt
- `loadPrompt()` substitutes `{{VAR}}` correctly
- `loadPrompt()` leaves unmatched `{{VAR}}` as-is
- `loadPromptFragment()` loads from `prompts/fragments/`

**Tests for ClaudeSpawner**:
- Mock `child_process.spawn` to verify correct args are passed
- Verify streaming JSON parsing extracts `finalOutput`, `cost`, `duration`
- Verify non-zero exit code is captured

**Verification**:
```bash
npm test
npx tsc --noEmit
```

**Estimated scope**: ~350 LOC (3 source files) + ~240 LOC (3 test files) + prompt files

---

## Sub-Issue 2: SpecAgent

**Goal**: Build the front-door quality gate that evaluates user requests, runs a clarification loop, detects variants, and writes structured tickets to `feature_requests/`.

**Depends on**: Sub-issue 1 (ClaudeSpawner, PromptLoader)

### Phase 2.1: SpecAgent Class (`src/lib/SpecAgent.ts`)

**Changes**:
- `src/lib/SpecAgent.ts`: New file (~180 LOC)

**Implementation**:

```typescript
// src/lib/SpecAgent.ts

export interface SpecAgentOptions {
  model?: string;
}

export class SpecAgent {
  constructor(options?: SpecAgentOptions)

  // Main entry: evaluates request, runs clarification loop, writes tickets
  async run(userRequest: string): Promise<string[]>  // Returns paths to created ticket files
}
```

**Internal flow**:
1. Load `agent0-spec.md` prompt via `PromptLoader.loadPrompt("agent0-spec", { USER_REQUEST: userRequest })`
2. Call `spawnClaude()` with the prompt
3. Parse `finalOutput`:
   - If starts with `QUESTIONS:` — print questions to console, read user answers via `readline`, append to context, re-run Claude (clarification loop, max 3 rounds)
   - If starts with `TICKETS:` — parse the YAML ticket definitions
4. For each ticket definition, call `writeTicket()`:
   - Scan `feature_requests/` for highest `FR-{n}` directory number, increment
   - Create `feature_requests/FR-{n}/` directory
   - Scan all existing tickets for highest `AGI-{n}`, increment
   - Write `AGI-{m}.md` with frontmatter: `id`, `title`, `description`, `repo`, `status: Backlog`, `dependsOn`, `group`, `variantHint`
5. Return list of created file paths

**ID continuation logic**:
- `nextFeatureRequestId()`: Glob `feature_requests/FR-*/`, extract max N, return `FR-{N+1}`
- `nextTicketId()`: Glob `feature_requests/FR-*/AGI-*.md`, extract max N, return `AGI-{N+1}`

**Variant chain handling**:
- When the spec agent detects a variant request (e.g., "Build a login page with OAuth AND email options"), it outputs multiple tickets with:
  - Same `group` field (e.g., `login-auth`)
  - Sequential `dependsOn` chains or parallel independence
  - `variantHint: "Variant 1 of 2: OAuth"`, `variantHint: "Variant 2 of 2: Email"`

### Phase 2.2: Tests

**Changes**:
- `tests/spec_agent.test.ts`: New file (~120 LOC)

**Tests**:
- Parse `TICKETS:` output correctly (single ticket, multiple tickets)
- Parse `QUESTIONS:` output correctly
- `nextFeatureRequestId()` returns `FR-1` for empty dir, `FR-6` when `FR-5` exists
- `nextTicketId()` returns `AGI-1` for empty dir, continues from max existing
- Ticket writing creates correct directory structure and frontmatter
- Variant chain tickets share `group` field and have `variantHint`

**Note**: Tests mock `spawnClaude` — no real Claude calls.

**Verification**:
```bash
npm test
npx tsc --noEmit
```

**Estimated scope**: ~180 LOC (1 source file) + ~120 LOC (1 test file)

---

## Sub-Issue 3: Orchestrator Refactor

**Goal**: Transform `SandboxQueueProcessor` from a batch processor into a continuous stage-aware dispatch loop with dependency resolution, parallel worker pool, and group branching. This is the highest-risk sub-issue — it modifies the existing 310 LOC monolith.

**Depends on**: Sub-issue 1 (TaskStatus, PromptLoader)

### Phase 3.1: Update TaskRequest Interface

**Changes**:
- `src/lib/SandboxQueueProcessor.ts`: Lines 6-15 (interface definition)

**Updated interface**:
```typescript
interface TaskRequest {
  id: string;                    // AGI-{n}
  file: string;                  // AGI-{n}.md
  filePath: string;              // feature_requests/FR-{m}/AGI-{n}.md
  featureRequest: string;        // FR-{m} (parent directory name)
  title: string;
  description: string;
  repo: string;
  status: TaskStatus;            // Enum instead of string
  dependsOn: string[];           // AGI-{n} IDs this ticket depends on
  group?: string;                // Group identifier for variant chains
  variantHint?: string;          // "Variant {n} of {m}" description
}
```

Removed: `numberOfSandboxes` (no longer needed — one sandbox per stage invocation).

### Phase 3.2: Replace `loadTasksFromQueue()` with `loadAllTasks()`

**Changes**:
- `src/lib/SandboxQueueProcessor.ts`: Replace lines 57-100

**Implementation**:
```typescript
private async loadAllTasks(): Promise<TaskRequest[]>
```

- Globs `feature_requests/FR-*/AGI-*.md`
- For each file: parse frontmatter, extract `featureRequest` from parent dir name
- Maps `status` string to `TaskStatus` enum (with fallback to `Backlog` for unknown)
- Returns ALL tasks (not just Backlog) — filtering happens in `filterEligible()`
- ID assignment logic moves here for new tickets without IDs

### Phase 3.3: Add `filterEligible()` and Dependency Resolution

**Changes**:
- `src/lib/SandboxQueueProcessor.ts`: New private method (~30 LOC)

**Implementation**:
```typescript
private filterEligible(tasks: TaskRequest[]): TaskRequest[]
```

- Filter to tasks where `isActionable(task.status)` is true
- For each candidate, check `task.dependsOn`:
  - Look up each dependency ID in the full task list
  - Dependency is satisfied if its status is `Done` or `Canceled`
  - If any dependency is NOT satisfied, skip this task
- Return the filtered list of immediately actionable tasks

### Phase 3.4: Add `isTerminal()` and `branchName()`

**Changes**:
- `src/lib/SandboxQueueProcessor.ts`: New private methods (~20 LOC each)

**`isTerminal(task, allTasks)`**:
- A task is terminal if NO other task has this task's ID in its `dependsOn` list
- Terminal tasks get PRs; non-terminal tasks just push

**`branchName(task)`**:
- If `task.group` exists: return `feat/{task.group}`
- Otherwise: return `feat/{task.id}`

### Phase 3.5: Add `dispatchStage()` — Stage-Aware Worker Dispatch

**Changes**:
- `src/lib/SandboxQueueProcessor.ts`: New private method (~60 LOC), replaces the inline prompt logic in `executeClaudeCommand()`

**Implementation**:
```typescript
private async dispatchStage(task: TaskRequest, allTasks: TaskRequest[]): Promise<void>
```

1. Get the prompt name from `stagePromptMap[task.status]`
2. Load the prompt via `PromptLoader.loadPrompt(promptName, { ...templateVars })`
3. Determine merge mode: load the appropriate fragment (`merge-auto`, `merge-direct`, `merge-pr`) based on `MERGE_MODE` env var (default: `auto`)
4. Build the full prompt with task context + merge instructions
5. Set status to `inProgressStatus(task.status)` via `updateTaskStatus()`
6. Create sandbox, run setup, execute Claude with the prompt via PTY
7. On success: set status to `nextStatus(inProgressStatus)` via `updateTaskStatus()`
8. On failure: set status to `Blocked` with error context
9. If the completed stage was `Validate` and task is terminal: set status to `Awaiting Merge` or `Done`

**Post-validate test-writer** (conditional):
- After `Implement` stage succeeds, if test-writer is enabled, dispatch a second Claude invocation in the same sandbox with `agent2-worker-test.md` prompt before proceeding to `Needs Validate`

### Phase 3.6: Refactor `processQueue()` into Continuous Loop

**Changes**:
- `src/lib/SandboxQueueProcessor.ts`: Replace lines 39-55

**Implementation**:
```typescript
async processQueue(): Promise<void>
```

New loop:
1. `const allTasks = await this.loadAllTasks()`
2. `const eligible = this.filterEligible(allTasks)`
3. If no eligible tasks: log "No eligible tasks", sleep 30s, continue loop
4. Process eligible tasks with bounded concurrency (max 3 parallel, configurable via `MAX_WORKERS` env var):
   - For each task: `await this.dispatchStage(task, allTasks)`
5. After processing batch, immediately re-scan (no sleep between batches)
6. Loop exits on SIGINT/SIGTERM (graceful shutdown)

### Phase 3.7: Update Existing Tests

**Changes**:
- `tests/agent_logs.test.ts`: Update `loadTasksFromQueue` tests for new interface and `loadAllTasks` method

**Key updates**:
- Change test helper `writeFrontmatter()` to write to `feature_requests/FR-{n}/AGI-{m}.md` nested structure
- Update `TaskRequest` assertions to include new fields (`featureRequest`, `dependsOn`, `status` as enum)
- Remove `numberOfSandboxes` from test data
- Add tests for `filterEligible()`, `isTerminal()`, `branchName()`
- `handleStreamLine` tests remain unchanged (that method doesn't change)

### Phase 3.8: New Orchestrator Tests

**Changes**:
- `tests/orchestrator.test.ts`: New file (~150 LOC)

**Tests**:
- `filterEligible()`: Returns only actionable tasks with satisfied dependencies
- `filterEligible()`: Skips tasks with unmet dependencies
- `filterEligible()`: Treats `Done` and `Canceled` dependencies as satisfied
- `isTerminal()`: Returns true for tasks with no downstream dependents
- `isTerminal()`: Returns false for tasks that others depend on
- `branchName()`: Returns `feat/{group}` for grouped tasks, `feat/{id}` for standalone
- `loadAllTasks()`: Discovers tasks in nested `feature_requests/FR-*/AGI-*.md` structure
- `loadAllTasks()`: Maps status strings to `TaskStatus` enum correctly

**Verification**:
```bash
npm test
npx tsc --noEmit
```

**Estimated scope**: ~400 LOC refactor + ~200 LOC test updates/additions

---

## Sub-Issue 4: Test-Writer + Entry Point

**Goal**: Add the test-writer subagent prompt and refactor `src/index.ts` for two-mode CLI entry.

**Depends on**: Sub-issues 2 (SpecAgent) and 3 (Orchestrator)

### Phase 4.1: Entry Point Refactor (`src/index.ts`)

**Changes**:
- `src/index.ts`: Expand from 15 LOC to ~40 LOC

**Implementation**:
```typescript
// src/index.ts
import dotenv from "dotenv";
import { SandboxQueueProcessor } from "./lib/SandboxQueueProcessor.js";
import { SpecAgent } from "./lib/SpecAgent.js";

dotenv.config();

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "spec") {
    const userRequest = args.join(" ");
    if (!userRequest) {
      console.error("Usage: npx tsx src/index.ts spec \"<your request>\"");
      process.exit(1);
    }
    const agent = new SpecAgent();
    const tickets = await agent.run(userRequest);
    console.log(`Created ${tickets.length} ticket(s):`);
    for (const t of tickets) console.log(`  - ${t}`);
  } else {
    const processor = new SandboxQueueProcessor(process.env.DAYTONA_API_KEY!);
    await processor.processQueue();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### Phase 4.2: Test-Writer Prompt Refinement

**Changes**:
- `prompts/agent2-worker-test.md`: Refine the prompt created in Sub-issue 1

The test-writer prompt should be refined based on the actual patterns established during Sub-issues 1-3. At this point we'll have real test examples to reference.

### Phase 4.3: Tests

**Changes**:
- `tests/entry_point.test.ts`: New file (~40 LOC)

**Tests**:
- Verify `spec` command invocation path
- Verify default orchestrator path (no command)
- Verify error on `spec` without request text

**Verification**:
```bash
npm test
npx tsc --noEmit
# Manual integration test:
npx tsx src/index.ts spec "Build a hello world API"
npx tsx src/index.ts  # starts orchestrator loop (ctrl-c to stop)
```

**Estimated scope**: ~40 LOC (entry point) + ~40 LOC (tests) + prompt refinement

---

## Testing Strategy

### Unit Tests (per sub-issue)
Each sub-issue includes its own unit tests. Run `npm test` after each sub-issue to confirm no regressions.

### Integration Testing
After all sub-issues are merged:
1. **Spec Agent E2E**: `npx tsx src/index.ts spec "Build a REST API for user management"` — verify tickets are created in `feature_requests/`
2. **Orchestrator E2E**: Create a test ticket manually in `feature_requests/FR-1/AGI-1.md` with `status: Backlog`, run `npx tsx src/index.ts`, verify it progresses through stages (requires live Daytona sandbox + `ANTHROPIC_API_KEY`)

### Test Coverage Targets
- TaskStatus helpers: 100% branch coverage
- PromptLoader: Happy path + error paths
- ClaudeSpawner: Mocked spawn, JSON parsing
- SpecAgent: Mocked Claude, ticket writing
- Orchestrator: filterEligible, isTerminal, branchName, loadAllTasks

## Rollback Plan

Each sub-issue is on a separate branch merged via PR. To rollback:
1. Revert the specific PR that introduced the problem
2. Sub-issues 1-2 are purely additive (new files) — safe to revert independently
3. Sub-issue 3 modifies existing code — revert restores original `SandboxQueueProcessor`
4. Sub-issue 4 is small and depends on 2+3

If the full pipeline is problematic, the old `processQueue()` behavior can be restored by reverting sub-issue 3's PR.

## Notes

### For the Implementer

1. **Sequential execution is mandatory**: Each sub-issue depends on the previous one being merged. Do not start sub-issue 2 until sub-issue 1 is merged.

2. **Reference implementation**: The Horizon CLI Agent at `/Users/ob1/projects/startup/horizon-cli-agent` has working patterns for `prompts.ts` (PromptLoader), `claude.ts` (ClaudeSpawner). Adapt, don't copy — napoli-matcha's versions are simpler.

3. **Existing patterns to follow**:
   - Gray-matter for frontmatter: `matter(raw)` to parse, `matter.stringify("", data)` to write
   - PTY execution: Use `sandbox.process.createPty()` with `onData` callback, ANSI stripping
   - Test style: Vitest `describe`/`it`, temp dirs, `(p as any)` for private method access
   - One class per file in `src/lib/`

4. **The `feature_requests/` directory structure**:
   ```
   feature_requests/
   ├── FR-1/
   │   ├── AGI-1.md    (main ticket)
   │   ├── AGI-2.md    (variant ticket, depends on AGI-1)
   │   └── AGI-3.md    (variant ticket, depends on AGI-1)
   └── FR-2/
       └── AGI-4.md    (standalone ticket)
   ```

5. **Crash recovery (v1)**: If the orchestrator crashes, tickets stuck in `*InProgress` statuses need manual reset to corresponding `Needs*` status. Acceptable for initial implementation.

6. **Environment variables**:
   - `DAYTONA_API_KEY` — Required for sandbox creation
   - `ANTHROPIC_API_KEY` — Required for Claude CLI (both local SpecAgent and sandbox workers)
   - `GITHUB_TOKEN` — Required for PR creation in sandboxes
   - `MERGE_MODE` — Optional: `auto` (default), `merge`, `pr`
   - `MAX_WORKERS` — Optional: max concurrent sandboxes (default: 3)
