<!--
HORIZON AGENT INSTRUCTIONS:
This plan contains 5 major phases with significant new components and core refactoring.
Please decompose this into sub-issues for judicious parallel execution where possible.

Sub-issues with explicit dependencies:
1. ClaudeSpawner (Phase 2)           — depends_on: []
2. PromptLoader                      — depends_on: []
3. TaskStatus enum + helpers         — depends_on: []
4. SpecAgent (Phase 1)               — depends_on: [1, 2]
5. Orchestrator refactor (Phase 3)   — depends_on: [2, 3]
6. Test-Writer (Phase 5)             — depends_on: [5]
7. Entry Point (Phase 4)             — depends_on: [4, 5]
8. Prompt adaptations (agent2-worker*.md) — depends_on: []

Execution waves:
  Wave 1: #1 (ClaudeSpawner), #2 (PromptLoader), #3 (TaskStatus), #8 (Prompt adaptations)
  Wave 2: #4 (SpecAgent), #5 (Orchestrator)  — #4 needs #1+#2, #5 needs #2+#3
  Wave 3: #6 (Test-Writer), #7 (Entry Point) — #6 needs #5, #7 needs #4+#5

Notes:
- Phase 3 (Orchestrator) is the most complex and touches many files
- #8 is pure markdown edits with no code dependencies — safe for wave 1
- #4 cannot be tested without #1 (SpecAgent uses ClaudeSpawner)
- Merge agent is part of #5 (Orchestrator) — uses merge-auto.md fragment via PromptLoader
-->

# Plan: Agent Pipeline Enhancement in Napoli-Matcha project

---

## Reference Architecture: Horizon CLI Agent

> **Horizon CLI Agent repo**: `/Users/ob1/projects/startup/horizon-cli-agent`
>
> Horizon has a **working implementation** of the 3-agent pipeline (Linear Reader → Worker → Linear Writer) that napoli-matcha is adapting. Use it as a reference for:
>
> - **Claude spawning** — `src/lib/claude.ts`: streaming JSON parsing, `claude -p --output-format=stream-json --verbose` invocation. Napoli's `ClaudeSpawner` (Phase 2) is a simplified version of this.
> - **Prompt loading** — `src/lib/prompts.ts`: loads from `.horizon/prompts/` with fallback to package `prompts/`. Napoli should follow the same pattern but load from `prompts/`.
> - **6-stage worker pipeline** — `prompts/agent2-worker-*.md`: research → specification → plan → implement → validate (+ oneshot fast-track). These stages are directly portable.
> - **Orchestrator loop** — `src/lib/claude.ts` + main loop: how agents are dispatched, results collected, and state transitions managed.
>
> ### Key Difference: Linear vs Local Queue
>
> | Concern | Horizon | Napoli-Matcha |
> |---------|---------|---------------|
> | **Ticket storage** | Linear (via MCP tools: `mcp__linear__list_issues`, `mcp__linear__get_issue`, etc.) | Local MD files in `feature_requests/` with YAML frontmatter |
> | **Status updates** | Linear API (`mcp__linear__update_issue`) | Update YAML `status:` field in the MD file |
> | **Result posting** | Linear comments (`mcp__linear__create_comment`) | Append results section to the MD file body |
> | **Sub-issue creation** | Linear API (`mcp__linear__create_issue`) | Write new MD files to `feature_requests/` |
> | **Agent 1 (Reader)** | Claude agent queries Linear for issues in specific statuses | **Absorbed into TypeScript orchestrator** — `loadAllTasks()` reads `feature_requests/**/AGI-*.md`, `filterEligible()` selects dispatch candidates |
> | **Agent 3 (Writer)** | Claude agent posts comments + updates Linear issue status | **Absorbed into TypeScript orchestrator** — `writeResults()` updates MD frontmatter + appends result sections, `updateTaskStatus()` sets status |
>
> When implementing, **always check the Horizon equivalent first** for patterns, then adapt to local file I/O.

---

## Prompts Directory (`prompts/`)

The `prompts/` directory contains agent prompts **ported from Horizon**. They follow Horizon's 3-agent architecture but need adaptation for napoli-matcha's local queue system.

### Prompt Mapping & Adaptation Status

| File | Horizon Role | Napoli Role | Adaptation Needed |
|------|-------------|-------------|-------------------|
| `agent1-linear-reader.md` | Reads tickets from Linear via MCP | **Removed** — logic absorbed into TypeScript orchestrator (`loadAllTasks()`, `filterEligible()`) | **N/A** — No longer a Claude agent. Deterministic queue reading doesn't need LLM reasoning. |
| `agent2-worker.md` | Stage router (dispatches to stage-specific prompts) | **Worker Router** — same role | **LOW** — Update file path references from `.horizon/prompts/` to `prompts/` |
| `agent2-worker-oneshot.md` | Fast-track for simple tasks (~100 LOC) | Same | **NONE** — Direct port, fill `{{MERGE_INSTRUCTIONS}}` placeholder |
| `agent2-worker-research.md` | Assess complexity, decide oneshot vs staged | Same | **NONE** — Direct port |
| `agent2-worker-specification.md` | PM/designer perspective, write spec | Same | **NONE** — Direct port |
| `agent2-worker-plan.md` | Break into implementation phases | Same | **NONE** — Direct port |
| `agent2-worker-implement.md` | Execute phases, commit, push | Same | **NONE** — Direct port |
| `agent2-worker-validate.md` | Run tests, verify success criteria | Same | **NONE** — Direct port, fill `{{MERGE_INSTRUCTIONS}}` placeholder |
| `agent3-linear-writer.md` | Posts results to Linear, updates status | **Removed** — logic absorbed into TypeScript orchestrator (`writeResults()`, `updateTaskStatus()`) | **N/A** — No longer a Claude agent. WORK_RESULT parsing and MD file updates are deterministic. |
| `fragments/merge-auto.md` | Decision rubric for merge strategy | Same | **NONE** — Pure git operations, no Linear deps |
| `fragments/merge-direct.md` | Direct merge path | Same | **NONE** |
| `fragments/merge-pr.md` | PR creation path | Same | **NONE** |

### New Prompts Needed

| File | Purpose | Phase |
|------|---------|-------|
| `agent0-spec.md` | **Spec Agent prompt** — evaluates request against 5 quality criteria, asks clarifying questions or produces structured tickets. See Phase 1 below. | Phase 1: Spec Agent |
| `agent2-worker-test.md` | **Test-Writer Agent prompt** — reads git diff + ticket context, writes unit tests (all tickets) + integration tests (terminal only). See Phase 5 below. | Phase 5: Test-Writer |

### How Prompts Are Used in the Pipeline

```
User request
  │
  ▼
agent0-spec.md (Spec Agent — LOCAL, via ClaudeSpawner)
  │ Clarification loop until spec meets 5 quality criteria
  │ Writes tickets to feature_requests/FR-{n}/
  ▼
Orchestrator (TypeScript — replaces agent1/agent3)
  │ loadAllTasks() reads feature_requests/**/AGI-*.md
  │ filterEligible() selects dispatch candidates
  │ Dispatches one stage per worker invocation
  ▼
agent2-worker.md → agent2-worker-{stage}.md (Worker — IN SANDBOX)
  │ 6-stage pipeline: research → spec → plan → implement → validate
  │ (or oneshot fast-track)
  ▼
agent2-worker-test.md (Test Writer — IN SAME SANDBOX, after implement/validate/oneshot)
  │ Writes tests for the implementation, commits to same branch
  ▼
Orchestrator (TypeScript)
  │ Parses WORK_RESULT, updates MD file with results + status
  │ terminal? → PR + merge. Non-terminal? → push, next ticket.
```

### Adaptation Guidelines for Horizon → Napoli Prompts

When editing prompts that reference Horizon/Linear:

1. **Remove `mcp__linear__*` tool call references** — queue reading and result writing are now handled by the TypeScript orchestrator, not by Claude agents
2. **Replace Linear status names** — drop the `∞` prefix but **keep the granular stage statuses**. See the **Task Status Model** section below for the full list.
3. **Keep the WORK_RESULT format** — it's the interface between agents and is Linear-agnostic
4. **Keep multi-agent conflict handling** — still relevant when multiple orchestrator instances run
5. **Replace "Linear issue" language** with "ticket" or "task" language
6. **Keep branch naming conventions** but adapt from `horizon/{issue-id}` to `feat/{task-id}` or `feat/{group}`

---

## Full Pipeline

```
User submits request (CLI arg, stdin, or file)
  │
  ▼
Spec Agent (local Claude CLI, interactive clarification loop)
  ├─ Evaluates request against 5 spec quality criteria
  ├─ If gaps: asks human targeted questions (loop until clear)
  ├─ Detects variant requests ("give me 2 versions")
  ├─ Decomposes into structured tickets with dependency graph
  ├─ If variants: duplicates full dependency chain per variant with independent IDs
  └─ Writes tickets to feature_requests/FR-{n}/ as MD files (status per start_status judgment)
  │
  ▼
Orchestrator (pure TypeScript, continuous loop)
  ├─ Reads feature_requests/**/AGI-*.md, topological sort on depends_on
  ├─ Dispatches eligible tasks to Workers (up to N parallel)
  ├─ On completion: parses WORK_RESULT, writes to MD
  ├─ Merge: only for terminal tickets (no downstream group deps)
  └─ When queue empty: sleep, poll, retry
  │
  ▼
Workers (Claude in Daytona sandbox, parallel)
  ├─ Receives structured ticket in prompt
  ├─ Branch: feat/{group} if grouped, feat/{id} if standalone
  ├─ Checks out existing group branch (has prior chain commits) or creates new
  ├─ Implements, commits, pushes
  ├─ Creates PR only if terminal ticket
  └─ Outputs structured WORK_RESULT block
```

---

## Phase 1: Spec Agent (`src/lib/SpecAgent.ts` — NEW)

### Purpose

Front-door quality gate. Takes a vague user request and produces structured, dependency-ordered tickets. Uses the 5 spec quality criteria from the hookify rule as a hard gate — won't generate tickets until the spec is clear.

### Clarification Loop

The Spec Agent runs as a **stateless retry loop** using `ClaudeSpawner`:

```
clarify(userRequest: string): Promise<TaskRequest[]>
  context = userRequest
  while true:
    result = ClaudeSpawner.spawn(buildPrompt(context))
    parsed = parseOutput(result.finalOutput)

    if parsed.type === "QUESTIONS":
      answers = await promptHuman(parsed.questions)
      context = userRequest + "\n\n## Clarifications\n" + answers
      continue

    if parsed.type === "TICKETS":
      writeTicketsToQueue(parsed.tickets)
      return parsed.tickets
```

Each spawn is stateless — all prior context (original request + accumulated answers) is passed in the prompt. Simple, no session management.

### Spec Agent Prompt (`prompts/agent0-spec.md` — NEW)

```
You are a Specification Agent. Your job is to evaluate a user's feature request
and either ask clarifying questions or produce structured tickets.

## Spec Quality Criteria

Evaluate the request against ALL 5 of these standards:

1. **Problem Statement** — Is there a clear description of what's broken, missing, or needed?
   (not just "improve X")
2. **Success Criteria** — Are there concrete, verifiable conditions for "done"?
3. **User-Facing Behavior** — Is it clear what users will see or experience?
4. **Boundaries & Constraints** — Is scope defined? What's in/out? Any technical constraints?
5. **Context & Background** — Is there enough context for why this matters and what exists today?

## Red Flags (require clarification)
- Vague language ("improve performance", "make it better", "clean up")
- Implementation details without a problem statement
- No acceptance criteria
- Assumes shared context without explaining it
- Multiple unrelated features in one request

## Variant Requests

If the user asks for multiple versions/variants (e.g., "give me 2 versions",
"compare approaches", "try it two different ways"):

- Produce the FULL ticket dependency chain once, then DUPLICATE it N times
- Each variant gets its own independent IDs and dependency chain
- Assign a shared `group` name per variant (e.g., "dashboard-v1", "dashboard-v2")
- Add a `variant_hint` to each ticket describing the design direction for that variant
- Variants must have ZERO cross-dependencies — they are fully independent pipelines

## Your Output (EXACTLY one of these two formats)

### If ANY criteria are missing or vague:

QUESTIONS
---
1. [Targeted question addressing specific missing criterion]
2. [Another question if needed]
---

### If ALL 5 criteria are adequately covered:

TICKETS
---
- id: AGI-{n}
  title: {short imperative title}
  description: {detailed description with acceptance criteria}
  repo: {repo URL}
  depends_on: [{list of AGI-IDs this depends on, or empty}]
  start_status: {starting stage — see Stage-Skipping Rules below}
  group: {group name, omit if standalone ticket}
  variant_hint: {design direction hint, omit if not a variant}
- id: AGI-{n+1}
  ...
---

Stage-Skipping Rules (for start_status):
- "Needs Research" — vague scope, unclear requirements, needs codebase exploration
- "Needs Specification" — clear problem/requirements, but UX/design decisions not made
- "Needs Plan" — clear problem + design + acceptance criteria, needs implementation planning
- "Needs Implement" — fully specified with exact files, methods, and implementation steps

Rules for ticket decomposition:
- Each ticket should be a single, independently testable unit of work
- Order tickets by dependency (foundations first)
- Use depends_on to encode the execution order
- Include acceptance criteria in each ticket description
- For variants: each chain must be fully self-contained
```

### Human Interaction

Uses Node `readline` to prompt the human:

```typescript
private async promptHuman(questions: string[]): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answers: string[] = [];
  for (const q of questions) {
    const answer = await new Promise<string>(resolve =>
      rl.question(`\n${q}\n> `, resolve)
    );
    answers.push(`Q: ${q}\nA: ${answer}`);
  }
  rl.close();
  return answers.join("\n\n");
}
```

### Writing Tickets

The Spec Agent uses two ID schemes:

- **`FR-{n}`** — Feature Request ID. Tracks the original user request. One per `spec` invocation.
- **`AGI-{n}`** — Ticket ID. Individual implementation units decomposed from the feature request.

After the spec is complete, the Spec Agent creates a directory structure under `feature_requests/`:

```
feature_requests/
  FR-1/
    request.md              # Original user request + clarification Q&A
    dashboard-v1/           # Variant group subdirectory
      AGI-5.md
      AGI-6.md
      AGI-7.md
    dashboard-v2/           # Variant group subdirectory
      AGI-8.md
      AGI-9.md
      AGI-10.md
  FR-2/
    request.md
    AGI-11.md               # No group → lives directly in FR dir
```

**`request.md`** stores the original request and clarification history:

```markdown
---
id: FR-1
created: 2026-02-14T12:00:00Z
---

## Original Request
Build a dashboard with auth, give me 2 versions to compare

## Clarifications
Q: What auth provider should be used?
A: JWT with our existing user table
```

**Ticket MD files** use YAML frontmatter:

```markdown
---
id: AGI-8
feature_request: FR-1
title: Add auth middleware
description: >-
  Create Express middleware that validates JWT tokens on protected routes.
  Success criteria: unauthorized requests return 401, valid tokens pass through.
repo: 'https://github.com/user/repo'
depends_on: []
group: dashboard-v2
variant_hint: >-
  Use a data-dense table layout. Prioritize information density over whitespace.
status: Needs Plan
---
```

The `status` field is set by the Spec Agent based on its `start_status` judgment. In this example, the auth middleware ticket has clear requirements and acceptance criteria but no implementation plan yet, so it starts at `Needs Plan`.

### Integration with Existing ID Scheme

Reads existing `feature_requests/` to find the current max `FR-{n}` and `AGI-{n}` IDs. New IDs start from `max + 1`. The orchestrator globs `feature_requests/**/AGI-*.md` to discover all tickets.

---

## Phase 2: ClaudeSpawner (`src/lib/ClaudeSpawner.ts` — NEW)

Simplified local Claude CLI spawner, shared by the Spec Agent and any future local agent needs.

```typescript
interface SpawnResult {
  finalOutput: string;
  cost: number;
  duration: number;
  exitCode: number;
}

class ClaudeSpawner {
  spawn(prompt: string, model?: string): Promise<SpawnResult>
}
```

- Spawns `claude -p --dangerously-skip-permissions --output-format=stream-json --model <model> --verbose`
- Writes prompt to stdin, closes stdin
- Parses streaming JSON from stdout
- Extracts final output from `result` event
- Logs streaming output to console
- Returns `SpawnResult`

Based on horizon's `claude.ts` pattern but stripped down (no MCP config, no rate limit retry, no terminal formatting).

---

## Phase 3: Orchestrator (refactor `src/lib/SandboxQueueProcessor.ts`)

### Continuous Loop with Stage-Aware Dispatch

Replace the batch `processQueue()` with a concurrent worker pool that dispatches **one stage per invocation**. A ticket cycles through `Needs Research → Research In Progress → Needs Plan → Plan In Progress → ...` with the orchestrator re-dispatching after each stage completes.

```typescript
async processQueue(): Promise<void> {
  let iteration = 0;
  const active = new Map<string, Promise<void>>();

  while (this.maxIterations === 0 || iteration < this.maxIterations) {
    const allTasks = await this.loadAllTasks();  // every status
    const eligible = this.filterEligible(allTasks, active);

    if (eligible.length === 0 && active.size === 0) {
      console.log(`No tasks. Sleeping ${this.pollIntervalSeconds}s...`);
      await sleep(this.pollIntervalSeconds * 1000);
      continue;
    }

    for (const task of eligible) {
      if (active.size >= this.maxConcurrency) break;
      const stagePrompt = this.stagePromptMap[task.status];
      if (!stagePrompt) continue;

      const promise = this.dispatchStage(task, stagePrompt).then(async (result) => {
        // dispatchStage handles: stage → test-writer → merge agent (if terminal)
        // merge_status in result determines final status:
        //   success → Done, pr_created → Awaiting Merge, blocked → Blocked
        await this.writeResults(task, result);
        await this.updateTaskStatus(task, result.nextStatus);
        active.delete(task.id);
      });
      active.set(task.id, promise);
      iteration++;
    }

    if (active.size > 0) {
      await Promise.race(active.values());
    }
  }
}
```

### Independent Worker Per Stage (Horizon Pattern)

Each stage is a **completely independent worker invocation**. There is no session affinity — any available worker can pick up any actionable ticket. The handoff mechanism is the ticket's `status` field in the MD file:

1. Worker A picks up ticket `AGI-5` in `Needs Research`, sets it to `Research In Progress`
2. Worker A completes research, outputs `WORK_RESULT` with `next_status: "Needs Plan"`
3. Orchestrator updates MD file: `status: Needs Plan`
4. Worker A is released (sandbox torn down if applicable)
5. Next loop iteration: Worker B (completely independent) picks up `AGI-5` in `Needs Plan`
6. Worker B gets a fresh sandbox, reads the ticket context, runs the Plan stage prompt
7. Repeat until terminal status

This means:
- Workers are **stateless** — all context comes from the ticket MD file + repo state
- Multiple tickets in different stages can run in parallel across different workers
- A worker crash doesn't lose progress — the ticket stays at its last `In Progress` status

**Crash recovery**: If a worker fails (exit code != 0 or no parseable WORK_RESULT), the orchestrator **retries once** by re-dispatching the same stage. If the retry also fails, the ticket is set to `Blocked` and logged for human attention. The human can investigate, fix the issue, and manually reset the status to the `Needs *` state to retry. No timeout is enforced — Daytona sandbox lifetime limits apply.

### Spec Agent Sets Initial Stage

The Spec Agent judges which stage each ticket should **start at** based on how well-specified it is. Not all tickets need to go through every stage:

```typescript
// In the Spec Agent prompt output, each ticket includes a start_status:
- id: AGI-{n}
  title: {title}
  description: {description}
  start_status: {one of: "Needs Research", "Needs Specification", "Needs Plan", "Needs Implement"}
```

Stage-skipping rules for the Spec Agent:

| Ticket Characteristics | Start Status | Rationale |
|----------------------|--------------|-----------|
| Vague request, unclear scope, needs codebase exploration | `Needs Research` | Worker must assess complexity and codebase before anything else |
| Clear problem + requirements, but no UX/design decisions made | `Needs Specification` | Skip research — go straight to design |
| Clear problem + clear UX + clear acceptance criteria, but no implementation plan | `Needs Plan` | Skip research + spec — go straight to planning |
| Fully specified with exact files/methods to change, clear implementation steps | `Needs Implement` | Skip directly to implementation |

The Spec Agent is in the best position to judge this because it has already done thorough quality assessment (5 criteria, clarification loop with the human). If the human provided a detailed spec with exact implementation steps, forcing it through Research is wasteful.

> **Note**: Tickets never start at `Needs Validate` — validation only makes sense after implementation has occurred.

### `filterEligible(allTasks, active)` — Dependency + Stage Resolution

Takes **all tasks** (every status) as a single list. The `isActionable()` guard inside handles narrowing to dispatch candidates. Dependency checks naturally see all statuses — including `* In Progress` and intervention statuses — preventing premature dispatch after process restart.

```typescript
private filterEligible(
  allTasks: TaskRequest[],
  active: Map<string, Promise<void>>
): TaskRequest[] {
  return allTasks.filter(task => {
    if (active.has(task.id)) return false;
    if (!this.isActionable(task)) return false;
    return task.dependsOn.every(depId => {
      if (active.has(depId)) return false;       // dep running in this process → wait
      const dep = allTasks.find(t => t.id === depId);
      if (!dep) return true;                      // dep not found at all = satisfied (or deleted)
      return dep.status === TaskStatus.Done;       // only Done = satisfied
    });
  });
}
```

The `processQueue` loop calls this as:

```typescript
const allTasks = await this.loadAllTasks();  // every status
const eligible = this.filterEligible(allTasks, active);
```

Four states a dependency can be in:
- **`Done`** — satisfied, proceed
- **`* In Progress` (any stage)** — found in `allTasks` with status != Done → `false` (wait)
- **`Needs *` (any stage)** — found in `allTasks` with status != Done → `false` (wait)
- **Intervention** (`Blocked`, `Needs Human *`) — found in `allTasks` with status != Done → `false` (wait, human must unblock)
- **Not found** — task deleted or never existed → `true` (treat as satisfied)

No variant-specific logic needed — dependencies already keep chains ordered, and independent variant chains naturally parallelize.

### `isTerminal(task)` — Detect Chain-End Tickets (NEW)

A ticket is terminal if no other **non-Done** ticket depends on it. With the stage-aware model, "non-Done" means any status that isn't `Done` — including all `Needs *`, all `* In Progress`, and all intervention statuses:

```typescript
private async isTerminal(task: TaskRequest): Promise<boolean> {
  const allTasks = await this.loadAllTasks();  // all statuses
  return !allTasks.some(t =>
    t.id !== task.id &&
    t.dependsOn.includes(task.id) &&
    t.status !== TaskStatus.Done
  );
}
```

> **Why `!== Done` instead of a whitelist**: With 16+ statuses in the `TaskStatus` enum, checking against a whitelist is fragile. The only status that means "this ticket no longer needs its dependency's branch" is `Done`. Everything else — `Needs Research`, `Plan In Progress`, `Blocked`, `Needs Human Decision`, etc. — means the dependency chain is still active.

This determines:
- **Terminal**: Create PR, attempt merge to main
- **Non-terminal**: Just push to group branch, no PR, no merge

### `branchName(task)` — Group-Aware Branch Naming (NEW)

```typescript
private branchName(task: TaskRequest): string {
  return task.group ? `feat/${task.group}` : `feat/${task.id}`;
}
```

### Agent Runner Pattern

`runWorkerAgent()`, `runTestWriterAgent()`, and `runMergeAgent()` all follow the same pattern inherited from the existing `executeClaudeCommand()`:

1. Open a PTY session in the Daytona sandbox via the SDK
2. Invoke `claude -p '<prompt>' --dangerously-skip-permissions --output-format=stream-json --model <model> --verbose`
3. Stream stdout line-by-line, parse JSON events, log to file
4. Extract structured output (WORK_RESULT / TEST_RESULT) from the `result` event
5. Return parsed result

The only difference between the three is which prompt they receive and which output block they parse.

### `dispatchStage(task, stagePrompt)` — Stage-Aware Sandbox Logic (renamed from `executeWorker`)

Each invocation handles **one stage**. The orchestrator re-dispatches the ticket for subsequent stages based on `next_status` in the WORK_RESULT.

Key behaviors:
1. **Stage prompt** selected from `stagePromptMap` based on current `task.status`
2. **Branch name** passed to worker prompt uses `branchName(task)`
3. **Sandbox setup is orchestrator-driven** (programmatic, before worker starts):
   - `createSandbox(task)` clones the repo via Daytona SDK
   - Checks out `branchName(task)` if it exists on remote (grouped non-first tickets inherit prior chain commits), otherwise creates the branch
   - Runs `gh auth setup-git` for push access
   - Worker sees a ready-to-go working directory on the correct branch
4. **`variant_hint`** included in worker prompt when present
5. Returns parsed WORK_RESULT including `nextStatus` field
6. **Research stage** decides the workflow: returns `next_status: "Needs Specification"` or `"Needs Plan"` (staged) or `"Needs Oneshot"` (fast-track)
7. **Sandboxes**: All worker stages run in Daytona sandboxes. This keeps the orchestrator lightweight (pure polling/dispatch) and avoids local resource contention. Only the Spec Agent (Phase 1, separate entry point) runs locally via ClaudeSpawner.
8. **Post-stage subagents** (same sandbox, before teardown):
   - **Test-writer**: Runs after code-producing stages (Implement, Oneshot, Validate). Writes and commits tests.
   - **Merge agent**: Runs after test-writer for **terminal tickets only**. Uses `merge-auto.md` rubric to decide direct merge vs PR. Outputs `merge_status`.

### `writeResults(task, result)` — Update MD File

Parses WORK_RESULT from agent output, **appends** a Results section to the MD body. Does **not** modify frontmatter — status updates are handled exclusively by `updateTaskStatus()`.

```markdown
## Results

**Completed**: 2026-02-14T12:00:00Z
**Branch**: feat/dashboard-v2

### Summary
{parsed from WORK_RESULT}

### Artifacts
- Commit: abc1234
- PR: https://github.com/user/repo/pull/43  (only if terminal)
```

### Merge Agent — Terminal Tickets Only (CHANGED)

Merging is handled by a **dedicated merge subagent** that runs in the same sandbox as the worker, after the test-writer, for terminal tickets only. The orchestrator does **not** run git commands — the merge agent does.

The merge agent:
1. Runs in the same sandbox (has full repo state, branch, test results)
2. Uses the `merge-auto.md` rubric to decide: direct merge vs PR
3. Executes `git merge --no-ff` or `gh pr create` accordingly
4. Outputs `merge_status` in WORK_RESULT: `success`, `pr_created`, or `blocked`

The orchestrator maps `merge_status` to the final ticket status:
- `success` → `Done`
- `pr_created` → `Awaiting Merge`
- `blocked` → `Blocked` (merge conflict, orchestrator logs for human attention)

For non-terminal grouped tickets: the worker just pushes to the shared group branch. No merge agent runs. The next ticket in the chain picks up where it left off.

---

## Phase 4: Entry Point (`src/index.ts`)

Two modes of operation:

```typescript
async function main() {
  const command = process.argv[2];

  if (command === "spec") {
    const request = process.argv.slice(3).join(" ") || await readStdin();
    const specAgent = new SpecAgent(queueDir);
    await specAgent.clarify(request);
  } else {
    const orchestrator = new SandboxQueueProcessor(process.env.DAYTONA_API_KEY!);
    await orchestrator.processQueue();
  }
}
```

Usage:
- `npx tsx src/index.ts spec "Add user authentication"` → Spec Agent
- `npx tsx src/index.ts spec "Build dashboard, give me 2 versions"` → Spec Agent with variants
- `npx tsx src/index.ts` → Orchestrator loop

---

## Phase 5: Test-Writer Subagent (deterministic pipeline step)

### Purpose

Worker stages that produce code (Implement, Oneshot, Validate) are followed by a **test-writer step** in the same sandbox. This is not optional — it is a deterministic part of the pipeline that produces tests scoped to the work just completed. Research, Specification, and Plan stages do not trigger the test-writer since they produce analysis and plans, not code.

### Two-Tier Testing Strategy

| Ticket type | Unit tests | Integration tests |
|-------------|-----------|-------------------|
| **Non-terminal** (has downstream dependents) | Yes — cover all new/changed public methods and non-trivial private logic | No |
| **Terminal** (end of chain) | Yes | Yes — cover the full variant/dependency chain's interactions with each other and with pre-existing repo code |

### Execution Flow

The test-writer runs **inside `dispatchStage()`** (see Phase 3) for code-producing stages, after the worker agent finishes but before the merge agent and sandbox teardown:

```
dispatchStage(task, stagePrompt):
  1. Create Daytona sandbox, checkout branch
  2. Worker agent runs stage prompt, commits, pushes
  3. If stage is Implement, Oneshot, or Validate:
     a. Test-writer agent runs in same sandbox
     b. Reads the git diff (all commits on this branch vs main)
     c. Reads the ticket description + acceptance criteria
     d. If terminal: also reads all tickets in the group chain for integration context
     e. Writes test files to tests/
     f. Runs `npm test` to verify all tests pass
     g. Commits test files, pushes to same branch
  4. If terminal: merge agent runs (see Merge Agent section in Phase 3)
  5. Return combined result (stage + test summary + merge status)
```

### Test-Writer Prompt (`prompts/agent2-worker-test.md` — NEW)

```
You are a Test-Writer Agent. You have just received a completed implementation in this
sandbox. Your job is to write tests for the code that was changed.

## Context

**Ticket**: {{TICKET_CONTEXT}}
**Branch diff vs main**: {{BRANCH_DIFF}}
**Is terminal ticket**: {{IS_TERMINAL}}
{{CHAIN_TICKETS}}

## Rules

1. Use `vitest` as the test framework. Place tests in `tests/<feature>.test.ts`.
2. Follow existing test patterns in the repo (see tests/ for examples).
3. Write **unit tests** for:
   - Every new public method on any class
   - Non-trivial private logic (parsing, state transitions, validation)
   - Both happy path and at least one meaningful failure case per method
   - Use descriptive test names: "returns 401 for expired JWT tokens"
4. If this is a **terminal ticket**, also write **integration tests** that:
   - Exercise the full chain of features built across this variant group
   - Test interactions between the new code and pre-existing repo code
   - Cover end-to-end flows from the user's perspective where applicable
5. Mock external dependencies (network, sandboxes, Claude CLI) — never call real services.
6. Run `npm test` after writing. If tests fail, fix them before committing.
7. Commit all test files with message: "test: add tests for {ticket title}"

## Output

TEST_RESULT
---
files_created: [list of test file paths]
unit_tests: {count}
integration_tests: {count}
all_passing: {true/false}
---
```

---

## `TaskRequest` Interface Update

```typescript
interface TaskRequest {
  id: string;
  featureRequest: string;    // "FR-1" — parent feature request
  file: string;
  filePath: string;
  title: string;
  description: string;
  repo: string;
  dependsOn: string[];       // ["AGI-1", "AGI-2"]
  group?: string;            // "dashboard-v1" — shared branch for variant chain
  variantHint?: string;      // design direction for this variant
  status: TaskStatus;
}
```

---

## Task Status Model

The worker pipeline uses **granular per-stage statuses** so the orchestrator knows exactly which stage prompt to dispatch. This replaces Horizon's `∞`-prefixed Linear statuses with plain strings stored in the MD frontmatter `status:` field.

### Status Enum

```typescript
enum TaskStatus {
  // Stage: Research
  NeedsResearch        = "Needs Research",
  ResearchInProgress   = "Research In Progress",

  // Stage: Specification (optional — research decides if needed)
  NeedsSpecification   = "Needs Specification",
  SpecificationInProgress = "Specification In Progress",

  // Stage: Plan
  NeedsPlan            = "Needs Plan",
  PlanInProgress       = "Plan In Progress",

  // Stage: Implement
  NeedsImplement       = "Needs Implement",
  ImplementInProgress  = "Implement In Progress",

  // Stage: Validate
  NeedsValidate        = "Needs Validate",
  ValidateInProgress   = "Validate In Progress",

  // Stage: Oneshot (fast-track, decided during research)
  NeedsOneshot         = "Needs Oneshot",
  OneshotInProgress    = "Oneshot In Progress",

  // Terminal
  Done                 = "Done",
  AwaitingMerge        = "Awaiting Merge",

  // Intervention (requires human action)
  Blocked              = "Blocked",
  NeedsHumanReview     = "Needs Human Review",
  NeedsHumanDecision   = "Needs Human Decision",
}
```

### Stage Transition Diagram

```
Needs Research ──→ Research In Progress
  │
  ├─ SIMPLE ──→ Needs Oneshot ──→ Oneshot In Progress ──→ Done / Awaiting Merge
  │
  └─ COMPLEX ──┬──→ Needs Specification ──→ Specification In Progress ──→ Needs Plan
               │
               └──→ Needs Plan (skip spec if pure backend / no UX)
                      │
                      ▼
                    Plan In Progress ──→ Needs Implement
                      │
                      ▼
                    Implement In Progress ──→ Needs Validate
                      │
                      ▼
                    Validate In Progress ──→ Done / Awaiting Merge

ANY STAGE ──→ Blocked / Needs Human Review / Needs Human Decision
```

### How the Orchestrator Uses Statuses

The orchestrator dispatches workers based on the current status:

```typescript
private stagePromptMap: Record<string, string> = {
  "Needs Research":        "agent2-worker-research.md",
  "Needs Specification":   "agent2-worker-specification.md",
  "Needs Plan":            "agent2-worker-plan.md",
  "Needs Implement":       "agent2-worker-implement.md",
  "Needs Validate":        "agent2-worker-validate.md",
  "Needs Oneshot":         "agent2-worker-oneshot.md",
};

async dispatchStage(task: TaskRequest, stagePrompt: string): Promise<StageResult> {
  const sandbox = await this.createSandbox(task);
  const originalStatus = task.status;  // capture before mutation

  await this.updateTaskStatus(task, this.inProgressStatus(task.status));
  const stageResult = await this.runWorkerAgent(sandbox, task, stagePrompt);

  // Conditionally run test-writer for code-producing stages
  let testResult: TestResult | undefined;
  if (this.codeProducingStages.has(originalStatus)) {
    const isTerminal = await this.isTerminal(task);
    testResult = await this.runTestWriterAgent(sandbox, this.buildTestWriterPrompt(task, isTerminal));
  }

  // Step 3: Merge agent (same sandbox, only for terminal code-producing stages)
  let mergeResult: MergeResult | undefined;
  if (this.codeProducingStages.has(originalStatus) && await this.isTerminal(task)) {
    const mergePrompt = this.buildMergePrompt(task);  // loads merge-auto.md fragment
    mergeResult = await this.runMergeAgent(sandbox, mergePrompt);
  }

  return { stage: stageResult, tests: testResult, merge: mergeResult };
}
```

Key change from the previous plan: **each worker invocation handles one stage**, not the entire pipeline. The orchestrator re-dispatches the same ticket through successive stages based on the `nextStatus` returned in WORK_RESULT.

For terminal tickets, the `merge` field in the result determines final status: `success` → `Done`, `pr_created` → `Awaiting Merge`, `blocked` → `Blocked`.

### WORK_RESULT Stage Output

Each stage's worker outputs a `next_status` field that the orchestrator uses to advance the ticket:

```yaml
WORK_RESULT
---
success: true
stage_completed: research
workflow: staged          # or "oneshot"
next_status: "Needs Specification"  # or "Needs Plan" if spec not needed, or "Needs Oneshot" for fast-track
---
```

### Intervention Statuses

When a worker cannot proceed, it sets one of three intervention statuses:

| Status | Meaning | Example |
|--------|---------|---------|
| `Blocked` | External blocker preventing progress | Merge conflict, missing dependency, CI failure |
| `Needs Human Review` | Work is done but needs human sign-off before advancing | Risky refactor, security-sensitive change, ambiguous acceptance criteria |
| `Needs Human Decision` | Multiple valid paths forward, human must choose | Architectural choice, conflicting requirements, scope ambiguity |

Intervention output includes structured context for the human:

```yaml
WORK_RESULT
---
success: false
stage_completed: research
next_status: "Needs Human Decision"
intervention:
  summary: "Two valid auth approaches — need human to choose"
  options:
    - "JWT with refresh tokens — simpler, stateless"
    - "Session-based with Redis — better revocation"
  questions:
    - "Which approach aligns with your scaling plans?"
---
```

### Orchestrator Handling of Intervention Statuses

```typescript
private isActionable(task: TaskRequest): boolean {
  return task.status.startsWith("Needs ") &&
    !["Needs Human Review", "Needs Human Decision"].includes(task.status);
}
```

Tickets in intervention statuses are **skipped by the orchestrator** until a human manually updates the status (e.g., back to `Needs Plan` after making a decision). The orchestrator logs them as requiring attention.

### Single Task Loader

**`loadAllTasks()`** — Returns tasks in **every** status by globbing `feature_requests/**/AGI-*.md`. Used by `filterEligible()` (with `isActionable()` guard for narrowing), `isTerminal()`, and dependency checks. A single loader keeps the code simple — `isActionable()` handles the dispatch-candidate filtering internally.

## Changes Required for Variant Support (vs. previous plan)

Summary of what the variant group feature specifically adds or changes:

| Component | Previous Plan | Change for Variants |
|-----------|--------------|-------------------|
| **Spec Agent prompt** | Produces flat ticket list | Detects "N versions" requests, duplicates full dependency chain N times with independent IDs, assigns `group` + `variant_hint` per chain |
| **TaskRequest interface** | `dependsOn` field added | Also add `group?: string` and `variantHint?: string` |
| **Worker branch name** | Always `feat/${task.id}` | `feat/${task.group}` if grouped, `feat/${task.id}` if standalone |
| **Worker sandbox setup** | Clone repo, create new branch | If group branch exists on remote (prior chain ticket pushed to it), check it out instead of creating fresh |
| **Worker PR creation** | Every ticket creates a PR | Only terminal tickets create PRs. Worker prompt includes `isTerminal` flag. |
| **Worker prompt** | Task description only | Also includes `variant_hint` when present for design direction |
| **Orchestrator `filterEligible`** | No change | No change — deps already handle cross-chain isolation |
| **Orchestrator merge** | Merge after every completed ticket | Only merge terminal tickets (`isTerminal` check). Non-terminal grouped tickets just push to shared branch. |
| **New method: `isTerminal()`** | Did not exist | Checks if any pending/active ticket depends on this one |
| **New method: `branchName()`** | Did not exist | Returns `feat/${group}` or `feat/${id}` |
| **MD result writing** | Branch was `feat/${id}` | Branch field uses `branchName(task)`, PR field only for terminal |
| **`loadAllTasks()`** | Only loaded Backlog tasks | Reads all statuses from `feature_requests/**/AGI-*.md` — single loader for `filterEligible()`, `isTerminal()`, and dependency checks |
| **`TaskStatus` enum** | Simple 4-status model | Full stage-aware statuses: `Needs Research` → `Research In Progress` → ... → `Done`, plus intervention statuses |
| **Orchestrator dispatch** | Single-shot: one worker call per ticket | Stage-aware: one stage per dispatch, re-dispatches based on `nextStatus` from WORK_RESULT |

---

## Variant Example: End-to-End

User: `npx tsx src/index.ts spec "Build a dashboard with auth, give me 2 versions to compare"`

Spec Agent creates `feature_requests/FR-1/` with variant subdirs and produces after clarification:

```
# Variant 1: Minimal card layout
AGI-5: Auth middleware        (depends_on: [], group: dashboard-v1)
AGI-6: Dashboard API          (depends_on: [AGI-5], group: dashboard-v1)
AGI-7: Dashboard UI           (depends_on: [AGI-6], group: dashboard-v1,
                                variant_hint: "Minimal card layout, whitespace-heavy")

# Variant 2: Data-dense table layout
AGI-8: Auth middleware         (depends_on: [], group: dashboard-v2)
AGI-9: Dashboard API           (depends_on: [AGI-8], group: dashboard-v2)
AGI-10: Dashboard UI           (depends_on: [AGI-9], group: dashboard-v2,
                                variant_hint: "Dense table layout, information-rich")
```

Orchestrator execution (assuming all tickets start at `Needs Plan` — Spec Agent judged them well-specified):

```
t=0   AGI-5 (Needs Plan) + AGI-8 (Needs Plan) eligible (no deps)
        → dispatch both in parallel, each gets Plan stage prompt
        → Worker A: AGI-5 Plan In Progress → outputs next_status: "Needs Implement"
        → Worker B: AGI-8 Plan In Progress → outputs next_status: "Needs Implement"

t=1   AGI-5 (Needs Implement) + AGI-8 (Needs Implement) eligible again
        → dispatch both in parallel, each gets Implement stage prompt
        → Worker C: AGI-5 creates feat/dashboard-v1 branch, commits auth, pushes
           → outputs next_status: "Needs Validate"
        → Worker D: AGI-8 creates feat/dashboard-v2 branch, commits auth, pushes
           → outputs next_status: "Needs Validate"

t=2   AGI-5 (Needs Validate) + AGI-8 (Needs Validate) eligible
        → dispatch both, Validate stage prompt
        → Worker E: AGI-5 validates → next_status: "Done"
           → isTerminal? No (AGI-6 depends on AGI-5, status != Done) → no PR, no merge
        → Worker F: AGI-8 validates → next_status: "Done"
           → isTerminal? No (AGI-9 depends on AGI-8) → no PR, no merge

t=3   AGI-5 Done → AGI-6 (Needs Plan) eligible. AGI-8 Done → AGI-9 (Needs Plan) eligible.
        → dispatch both for Plan stage
        ... (same cycle: Plan → Implement → Validate)

t=4   AGI-6 (Needs Implement): checks out feat/dashboard-v1 (has auth commits), adds API, pushes
      AGI-9 (Needs Implement): checks out feat/dashboard-v2 (has auth commits), adds API, pushes

t=5   AGI-6 validates → Done. AGI-9 validates → Done.
        → isTerminal? No (AGI-7 depends on AGI-6, AGI-10 depends on AGI-9)

t=6   AGI-7 (Needs Plan) + AGI-10 (Needs Plan) eligible
        ... Plan → Implement → Validate cycle

t=7   AGI-7 Implement: checks out feat/dashboard-v1, adds UI (card layout), pushes
      AGI-10 Implement: checks out feat/dashboard-v2, adds UI (table layout), pushes

t=8   AGI-7 validates → Done. AGI-10 validates → Done.
        → isTerminal? YES (nothing depends on AGI-7 or AGI-10 with status != Done)
        → AGI-7 creates PR for feat/dashboard-v1
        → AGI-10 creates PR for feat/dashboard-v2
        → Orchestrator merges whichever the user approves
```

Key observations:
- **Dependencies block on `Done`, not on stage completion** — AGI-6 waits until AGI-5 reaches `Done`, not just until AGI-5 finishes one stage
- **Group branch accumulates across tickets** — AGI-6's Implement stage checks out `feat/dashboard-v1` which already has AGI-5's commits
- **Variant chains are fully independent** — dashboard-v1 and dashboard-v2 never interact
- **`isTerminal` uses `!== Done`** — correctly handles all 16+ statuses without a fragile whitelist

User gets 2 PRs to compare side-by-side.

---

## Prompt Loading (`src/lib/PromptLoader.ts` — NEW)

A simple `loadPrompt(name)` function reads `.md` files from `prompts/` and fills `{{variable}}` placeholders via string replacement:

```typescript
function loadPrompt(name: string): string {
  return fs.readFileSync(path.join("prompts", name), "utf-8");
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [key, val]) => s.replaceAll(`{{${key}}}`, val), template
  );
}
```

Each `build*Prompt()` method calls `loadPrompt()` then `fillTemplate()` with the relevant context:

```typescript
// Example: buildTestWriterPrompt
const template = loadPrompt("agent2-worker-test.md");
return fillTemplate(template, {
  TICKET_CONTEXT: `${task.title}\n${task.description}`,
  BRANCH_DIFF: execSync(`git diff main...HEAD`).toString(),
  IS_TERMINAL: String(isTerminal),
  CHAIN_TICKETS: isTerminal ? this.loadChainTickets(task) : "",
});
```

For the merge agent, `buildMergePrompt()` loads the appropriate merge fragment (`merge-auto.md` by default) and fills in the branch name, ticket context, and test results.

---

## Files

| File | Change |
|------|--------|
| `src/lib/TaskStatus.ts` | **New** — `TaskStatus` enum + helper functions (`isActionable()`, `inProgressStatus()`, `stagePromptMap`) |
| `src/lib/PromptLoader.ts` | **New** — `loadPrompt()` + `fillTemplate()` for `{{variable}}` replacement in prompt `.md` files |
| `src/lib/SpecAgent.ts` | **New** — Spec quality gate + clarification loop + variant chain duplication + ticket writer |
| `src/lib/ClaudeSpawner.ts` | **New** — Local Claude CLI spawner (simplified from Horizon's `claude.ts`) |
| `src/lib/SandboxQueueProcessor.ts` | Refactor to continuous loop, **stage-aware dispatch** (one stage per invocation), `stagePromptMap` routing, parallel dispatch, group-aware branching, `isTerminal()`, `branchName()`, `loadAllTasks()`, `filterEligible()` with `isActionable()` guard, `dispatchStage()` with conditional test-writer + merge agent, `buildMergePrompt()`, `runMergeAgent()`, result writing with `nextStatus` + `merge_status` parsing |
| `src/index.ts` | Two-mode entry: `spec` command vs orchestrator loop |
| `prompts/agent0-spec.md` | **New** — Spec Agent prompt (5 quality criteria, clarification loop, variant detection) |
| `prompts/agent2-worker-test.md` | **New** — Test-Writer Agent prompt (unit + integration test generation) |
| `prompts/agent1-linear-reader.md` | **Removed** — Queue reading logic absorbed into TypeScript orchestrator (`loadAllTasks()`, `filterEligible()`) |
| `prompts/agent3-linear-writer.md` | **Removed** — Result writing logic absorbed into TypeScript orchestrator (`writeResults()`, `updateTaskStatus()`) |
| `prompts/agent2-worker.md` | **Minor** — Update file path references from `.horizon/prompts/` to `prompts/`, update status references to use `TaskStatus` enum values |
| `prompts/fragments/merge-auto.md` | **Existing** — Used by merge agent as the decision rubric (auto mode). Already ported from Horizon. |
| `prompts/fragments/merge-direct.md` | **Existing** — Direct merge instructions. Available if merge mode is overridden to `merge`. |
| `prompts/fragments/merge-pr.md` | **Existing** — PR-only instructions. Available if merge mode is overridden to `pr`. |

---

## Verification

1. **Spec Agent (no variants)**: `npx tsx src/index.ts spec "make it better"` → asks clarifying questions. Detailed spec → produces tickets with appropriate `start_status` per ticket.
2. **Spec Agent (with variants)**: `npx tsx src/index.ts spec "Build dashboard, 2 versions"` → produces 2 independent ticket chains with groups.
3. **Spec Agent (stage-skipping)**: Well-specified request with exact implementation steps → tickets start at `Needs Implement`, not `Needs Research`.
4. **Orchestrator (stage progression)**: Add a `Needs Research` ticket, verify it progresses through: `Research In Progress` → `Needs Plan` → `Plan In Progress` → `Needs Implement` → `Implement In Progress` → `Needs Validate` → `Validate In Progress` → `Done`.
5. **Orchestrator (independent workers)**: Verify that after Worker A completes Research and sets `Needs Plan`, a fresh Worker B (new sandbox) picks up the ticket and runs the Plan stage.
6. **Orchestrator (oneshot fast-track)**: Add a simple ticket, verify research stage routes to `Needs Oneshot` → `Oneshot In Progress` → `Done`.
7. **Orchestrator (intervention statuses)**: Verify that tickets set to `Blocked`, `Needs Human Review`, or `Needs Human Decision` are skipped by the orchestrator and logged as requiring attention. Verify manual status update resumes processing.
8. **Orchestrator (variant groups)**: Add 2 variant chains, verify:
   - Chains execute in parallel (AGI-5 and AGI-8 at same time)
   - Within each chain, tickets execute sequentially (AGI-6 waits for AGI-5)
   - Non-terminal tickets push to shared branch, no PR
   - Terminal tickets create PR and attempt merge
   - Group branch accumulates commits across chain
9. **Existing tests**: `npm test` passes

