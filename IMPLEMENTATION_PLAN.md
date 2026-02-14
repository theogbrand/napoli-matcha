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
> | **Ticket storage** | Linear (via MCP tools: `mcp__linear__list_issues`, `mcp__linear__get_issue`, etc.) | Local MD files in `request_queue/` with YAML frontmatter |
> | **Status updates** | Linear API (`mcp__linear__update_issue`) | Update YAML `status:` field in the MD file |
> | **Result posting** | Linear comments (`mcp__linear__create_comment`) | Append results section to the MD file body |
> | **Sub-issue creation** | Linear API (`mcp__linear__create_issue`) | Write new MD files to `request_queue/` |
> | **Agent 1 (Reader)** | Queries Linear for issues in specific statuses | Reads `request_queue/*.md`, filters by `status: Needs Research` |
> | **Agent 3 (Writer)** | Posts comments + updates Linear issue status | Updates MD frontmatter status + appends result sections |
>
> When implementing, **always check the Horizon equivalent first** for patterns, then adapt to local file I/O.

---

## Prompts Directory (`prompts/`)

The `prompts/` directory contains agent prompts **ported from Horizon**. They follow Horizon's 3-agent architecture but need adaptation for napoli-matcha's local queue system.

### Prompt Mapping & Adaptation Status

| File | Horizon Role | Napoli Role | Adaptation Needed |
|------|-------------|-------------|-------------------|
| `agent1-linear-reader.md` | Reads tickets from Linear via MCP | **Queue Reader** — reads from `request_queue/*.md` | **HIGH** — Replace all `mcp__linear__*` calls with local file I/O. Keep multi-agent conflict/claim logic. |
| `agent2-worker.md` | Stage router (dispatches to stage-specific prompts) | **Worker Router** — same role | **LOW** — Update file path references from `.horizon/prompts/` to `prompts/` |
| `agent2-worker-oneshot.md` | Fast-track for simple tasks (~100 LOC) | Same | **NONE** — Direct port, fill `{{MERGE_INSTRUCTIONS}}` placeholder |
| `agent2-worker-research.md` | Assess complexity, decide oneshot vs staged | Same | **NONE** — Direct port |
| `agent2-worker-specification.md` | PM/designer perspective, write spec | Same | **NONE** — Direct port |
| `agent2-worker-plan.md` | Break into implementation phases | Same | **NONE** — Direct port |
| `agent2-worker-implement.md` | Execute phases, commit, push | Same | **NONE** — Direct port |
| `agent2-worker-validate.md` | Run tests, verify success criteria | Same | **NONE** — Direct port, fill `{{MERGE_INSTRUCTIONS}}` placeholder |
| `agent3-linear-writer.md` | Posts results to Linear, updates status | **Queue Writer** — updates MD files with results | **HIGH** — Remove all MCP calls, write results to MD files, handle sub-issue creation as new queue files |
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
  │ Writes tickets to request_queue/
  ▼
agent1-linear-reader.md (Queue Reader — IN SANDBOX, adapted for local queue)
  │ Reads ticket from queue, claims it, outputs context for worker
  ▼
agent2-worker.md → agent2-worker-{stage}.md (Worker — IN SANDBOX)
  │ 6-stage pipeline: research → spec → plan → implement → validate
  │ (or oneshot fast-track)
  ▼
agent2-worker-test.md (Test Writer — IN SAME SANDBOX, after worker)
  │ Writes tests for the implementation, commits to same branch
  ▼
agent3-linear-writer.md (Queue Writer — IN SANDBOX, adapted for local queue)
  │ Parses WORK_RESULT, updates MD file with results + status
  ▼
Orchestrator decides: terminal? → PR + merge. Non-terminal? → push, next ticket.
```

### Adaptation Guidelines for Horizon → Napoli Prompts

When editing prompts that reference Horizon/Linear:

1. **Replace `mcp__linear__*` tool calls** with instructions to read/write local MD files
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
  └─ Writes tickets to request_queue/ as MD files (status: Needs Research)
  │
  ▼
Orchestrator (pure TypeScript, continuous loop)
  ├─ Reads request_queue/, topological sort on depends_on
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

<!-- I need 2 IDs here, one to track the feature requests from the user, the other to track the tickets for the implementation; for ease of implementation, also create a dir "feature_requests_id" to store the feature request. If a feature request has variants requsted by the user, create a separate directory to store each "group" of tickets per variant -->
After the spec is complete, writes each ticket as an MD file to `request_queue/`:

```markdown
---
id: AGI-8
title: Add auth middleware
description: >-
  Create Express middleware that validates JWT tokens on protected routes.
  Success criteria: unauthorized requests return 401, valid tokens pass through.
repo: 'https://github.com/user/repo'
depends_on: []
group: dashboard-v2
variant_hint: >-
  Use a data-dense table layout. Prioritize information density over whitespace.
number_of_sandboxes: 1
status: Needs Plan
---
```

The `status` field is set by the Spec Agent based on its `start_status` judgment. In this example, the auth middleware ticket has clear requirements and acceptance criteria but no implementation plan yet, so it starts at `Needs Plan`.

### Integration with Existing ID Scheme

Reads existing `request_queue/` files to find the current max `AGI-{n}` ID (reuses logic from `SandboxQueueProcessor.loadTasksFromQueue()`). New tickets start from `max + 1`.

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
    const tasks = await this.loadActionableTasks();  // all "Needs *" stage statuses
    const eligible = this.filterEligible(tasks, active);

    if (eligible.length === 0 && active.size === 0) {
      console.log(`No tasks. Sleeping ${this.pollIntervalSeconds}s...`);
      await sleep(this.pollIntervalSeconds * 1000);
      continue;
    }

    for (const task of eligible) {
      if (active.size >= this.maxConcurrency) break;
      const stagePrompt = this.stagePromptMap[task.status];
      if (!stagePrompt) continue;

      // Transition to "In Progress" for this stage
      await this.updateTaskStatus(task, this.inProgressStatus(task.status));
      const promise = this.dispatchStage(task, stagePrompt).then(async (result) => {
        // Worker returns next_status in WORK_RESULT
        await this.writeResults(task, result);
        await this.updateTaskStatus(task, result.nextStatus);
        if (result.nextStatus === "Done" || result.nextStatus === "Awaiting Merge") {
          if (await this.isTerminal(task)) {
            await this.tryMerge(task);
          }
        }
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
- A worker crash doesn't lose progress — the ticket stays at its last `In Progress` status and can be retried

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

### `filterEligible(tasks, active)` — Dependency + Stage Resolution

```typescript
private filterEligible(
  tasks: TaskRequest[],
  active: Map<string, Promise<void>>
): TaskRequest[] {
  return tasks.filter(task => {
    if (active.has(task.id)) return false;
    if (!this.isActionable(task)) return false;  // skip intervention statuses
    return task.dependsOn.every(depId => {
      if (active.has(depId)) return false;   // dep still running → wait
      const dep = tasks.find(t => t.id === depId);
      return !dep || dep.status === "Done";  // Done or not in list = satisfied
    });
  });
}
```

Four states a dependency can be in:
- **`Done`** — satisfied, proceed
- **`In Progress` (any stage)** — in `active` map → `false` (wait)
- **`Needs *` (any stage)** — still in task list, not yet Done → `false` (wait)
- **Intervention** (`Blocked`, `Needs Human *`) — not in active, not Done → `false` (wait, human must unblock)

No variant-specific logic needed — dependencies already keep chains ordered, and independent variant chains naturally parallelize.

### `isTerminal(task)` — Detect Chain-End Tickets (NEW)

A ticket is terminal if no other **Backlog or In Progress** ticket depends on it:

```typescript
private async isTerminal(task: TaskRequest): Promise<boolean> {
  const allTasks = await this.loadAllTasks();  // all statuses
  return !allTasks.some(t =>
    t.id !== task.id &&
    t.dependsOn.includes(task.id) &&
    ["Backlog", "In Progress"].includes(t.status)
  );
}
```

This determines:
- **Terminal**: Create PR, attempt merge to main
- **Non-terminal**: Just push to group branch, no PR, no merge

### `branchName(task)` — Group-Aware Branch Naming (NEW)

```typescript
private branchName(task: TaskRequest): string {
  return task.group ? `feat/${task.group}` : `feat/${task.id}`;
}
```

### `dispatchStage(task, stagePrompt)` — Stage-Aware Sandbox Logic (renamed from `executeWorker`)

Each invocation handles **one stage**. The orchestrator re-dispatches the ticket for subsequent stages based on `next_status` in the WORK_RESULT.

Key behaviors:
1. **Stage prompt** selected from `stagePromptMap` based on current `task.status`
2. **Branch name** passed to worker prompt uses `branchName(task)`
3. **Worker prompt includes `isTerminal` flag** so the worker knows whether to create a PR (only relevant for validate/oneshot stages)
4. **For grouped non-first tickets**: The sandbox clones the repo, then checks out the existing group branch (which has prior chain commits from upstream dependencies)
5. **`variant_hint`** included in worker prompt when present
6. Returns parsed WORK_RESULT including `nextStatus` field
7. **Research stage** decides the workflow: returns `next_status: "Needs Specification"` or `"Needs Plan"` (staged) or transitions to oneshot
8. **Sandboxes**: Research/Spec/Plan stages can run without a sandbox (local Claude). Implement/Validate/Oneshot stages require a Daytona sandbox.

### `writeResults(task, result)` — Update MD File

Parses WORK_RESULT from agent output, writes structured summary to MD body:

```markdown
---
id: AGI-8
title: Add auth middleware
status: Done
group: dashboard-v2
...
---

## Results

**Completed**: 2026-02-14T12:00:00Z
**Branch**: feat/dashboard-v2

### Summary
{parsed from WORK_RESULT}

### Artifacts
- Commit: abc1234
- PR: https://github.com/user/repo/pull/43  (only if terminal)
```

### Sequential Merge Step — Terminal Tickets Only (CHANGED)

Previous plan merged after every ticket. Now merge only when `isTerminal(task)`:

```typescript
private async tryMerge(task: TaskRequest): Promise<boolean> {
  const branch = this.branchName(task);
  try {
    execSync(
      `git fetch origin && git checkout ${branch} && git rebase main` +
      ` && git checkout main && git merge ${branch}`
    );
    return true;
  } catch {
    await this.updateTaskStatus(task, "Blocked");
    return false;
  }
}
```

For non-terminal grouped tickets: the worker just pushes to the shared group branch. The next ticket in the chain picks up where it left off.

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

## `TaskRequest` Interface Update

```typescript
interface TaskRequest {
  id: string;
  file: string;
  filePath: string;
  title: string;
  description: string;
  repo: string;
  numberOfSandboxes: number;
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
  // Entry
  Backlog              = "Backlog",

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
Backlog
  │
  ▼
Needs Research ──→ Research In Progress
  │
  ├─ SIMPLE ──→ Oneshot In Progress ──→ Done / Awaiting Merge
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
};

async dispatchWorker(task: TaskRequest): Promise<void> {
  const prompt = this.stagePromptMap[task.status];
  if (!prompt) return; // not in a "Needs *" status — skip

  await this.updateTaskStatus(task, task.status.replace("Needs", "").trim() + " In Progress");
  const result = await this.runWorkerAgent(sandbox, task, prompt);
  await this.updateTaskStatus(task, result.nextStatus);
}
```

Key change from the previous plan: **each worker invocation handles one stage**, not the entire pipeline. The orchestrator re-dispatches the same ticket through successive stages based on the `nextStatus` returned in WORK_RESULT.

### WORK_RESULT Stage Output

Each stage's worker outputs a `next_status` field that the orchestrator uses to advance the ticket:

```yaml
WORK_RESULT
---
success: true
stage_completed: research
workflow: staged          # or "oneshot"
next_status: "Needs Specification"  # or "Needs Plan" if spec not needed
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

### `filterEligible` Update

The previous `filterEligible` only looked for `Backlog` tasks. Now it looks for any `Needs *` status (excluding intervention statuses) where dependencies are satisfied:

```typescript
private filterEligible(
  tasks: TaskRequest[],
  active: Map<string, Promise<void>>
): TaskRequest[] {
  return tasks.filter(task => {
    if (active.has(task.id)) return false;
    if (!this.isActionable(task)) return false;
    return task.dependsOn.every(depId => {
      if (active.has(depId)) return false;
      const dep = tasks.find(t => t.id === depId);
      return !dep || dep.status === "Done";
    });
  });
}
```

### `loadBacklogTasks` → `loadActionableTasks`

Rename and broaden: instead of loading only `status: Needs Research`, load all tasks in any `Needs *` stage status (excluding intervention statuses). This lets the orchestrator pick up tickets that have advanced through stages.

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
| **`loadAllTasks()`** | Only loaded Backlog tasks | Also needs to read all statuses for `isTerminal()` check |
| **`TaskStatus` enum** | Simple 4-status model | Full stage-aware statuses: `Needs Research` → `Research In Progress` → ... → `Done`, plus intervention statuses |
| **Orchestrator dispatch** | Single-shot: one worker call per ticket | Stage-aware: one stage per dispatch, re-dispatches based on `nextStatus` from WORK_RESULT |

---

## Variant Example: End-to-End

User: `npx tsx src/index.ts spec "Build a dashboard with auth, give me 2 versions to compare"`

Spec Agent produces after clarification:

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

Orchestrator execution:

```
t=0   AGI-5 + AGI-8 eligible (no deps) → dispatch both in parallel
        AGI-5 → creates feat/dashboard-v1 branch, commits auth, pushes
        AGI-8 → creates feat/dashboard-v2 branch, commits auth, pushes
      Both are non-terminal (AGI-6 depends on AGI-5, AGI-9 depends on AGI-8)
      → no PR, no merge

t=1   AGI-5 Done → AGI-6 eligible. AGI-8 Done → AGI-9 eligible.
        AGI-6 → checks out feat/dashboard-v1 (has auth commits), adds API, pushes
        AGI-9 → checks out feat/dashboard-v2 (has auth commits), adds API, pushes
      Both non-terminal → no PR, no merge

t=2   AGI-6 Done → AGI-7 eligible. AGI-9 Done → AGI-10 eligible.
        AGI-7 → checks out feat/dashboard-v1, adds UI (card layout), pushes
        AGI-10 → checks out feat/dashboard-v2, adds UI (table layout), pushes
      Both are TERMINAL (nothing depends on them)
      → AGI-7 creates PR for feat/dashboard-v1
      → AGI-10 creates PR for feat/dashboard-v2
      → Orchestrator merges whichever the user approves
```

User gets 2 PRs to compare side-by-side.

---

## Files

| File | Change |
|------|--------|
| `src/lib/TaskStatus.ts` | **New** — `TaskStatus` enum + helper functions (`isActionable()`, `inProgressStatus()`, `stagePromptMap`) |
| `src/lib/SpecAgent.ts` | **New** — Spec quality gate + clarification loop + variant chain duplication + ticket writer |
| `src/lib/ClaudeSpawner.ts` | **New** — Local Claude CLI spawner (simplified from Horizon's `claude.ts`) |
| `src/lib/SandboxQueueProcessor.ts` | Refactor to continuous loop, **stage-aware dispatch** (one stage per invocation), `stagePromptMap` routing, parallel dispatch, group-aware branching, terminal-only merge, `isTerminal()`, `branchName()`, `loadActionableTasks()`, result writing with `nextStatus` parsing |
| `src/index.ts` | Two-mode entry: `spec` command vs orchestrator loop |
| `prompts/agent0-spec.md` | **New** — Spec Agent prompt (5 quality criteria, clarification loop, variant detection) |
| `prompts/agent2-worker-test.md` | **New** — Test-Writer Agent prompt (unit + integration test generation) |
| `prompts/agent1-linear-reader.md` | **Adapt** — Replace Linear MCP calls with local `request_queue/` file reads |
| `prompts/agent3-linear-writer.md` | **Adapt** — Replace Linear MCP calls with local MD file updates |
| `prompts/agent2-worker.md` | **Minor** — Update file path references from `.horizon/prompts/` to `prompts/`, update status references to use `TaskStatus` enum values |

---

## Verification

1. **Spec Agent (no variants)**: `npx tsx src/index.ts spec "make it better"` → asks clarifying questions. Detailed spec → produces tickets with appropriate `start_status` per ticket.
2. **Spec Agent (with variants)**: `npx tsx src/index.ts spec "Build dashboard, 2 versions"` → produces 2 independent ticket chains with groups.
3. **Spec Agent (stage-skipping)**: Well-specified request with exact implementation steps → tickets start at `Needs Implement`, not `Needs Research`.
4. **Orchestrator (stage progression)**: Add a `Needs Research` ticket, verify it progresses through: `Research In Progress` → `Needs Plan` → `Plan In Progress` → `Needs Implement` → `Implement In Progress` → `Needs Validate` → `Validate In Progress` → `Done`.
5. **Orchestrator (independent workers)**: Verify that after Worker A completes Research and sets `Needs Plan`, a fresh Worker B (new sandbox) picks up the ticket and runs the Plan stage.
6. **Orchestrator (oneshot fast-track)**: Add a simple ticket, verify research stage routes to `Oneshot In Progress` → `Done`.
7. **Orchestrator (intervention statuses)**: Verify that tickets set to `Blocked`, `Needs Human Review`, or `Needs Human Decision` are skipped by the orchestrator and logged as requiring attention. Verify manual status update resumes processing.
8. **Orchestrator (variant groups)**: Add 2 variant chains, verify:
   - Chains execute in parallel (AGI-5 and AGI-8 at same time)
   - Within each chain, tickets execute sequentially (AGI-6 waits for AGI-5)
   - Non-terminal tickets push to shared branch, no PR
   - Terminal tickets create PR and attempt merge
   - Group branch accumulates commits across chain
9. **Existing tests**: `npm test` passes

---

## Phase 5: Test-Writer Subagent (deterministic pipeline step)

### Purpose

Every worker execution is followed by a **test-writer step** in the same sandbox. This is not optional — it is a deterministic part of the pipeline that produces tests scoped to the work just completed.

### Two-Tier Testing Strategy

| Ticket type | Unit tests | Integration tests |
|-------------|-----------|-------------------|
| **Non-terminal** (has downstream dependents) | Yes — cover all new/changed public methods and non-trivial private logic | No |
| **Terminal** (end of chain) | Yes | Yes — cover the full variant/dependency chain's interactions with each other and with pre-existing repo code |

### Execution Flow

The test-writer runs **inside `executeWorker()`**, after the worker agent finishes but before the sandbox is torn down:

```
executeWorker(task):
  1. Worker agent implements feature, commits, pushes
  2. Test-writer agent runs in same sandbox:
     a. Reads the git diff (all commits on this branch vs main)
     b. Reads the ticket description + acceptance criteria
     c. If terminal: also reads all tickets in the group chain for integration context
     d. Writes test files to tests/
     e. Runs `npm test` to verify all tests pass
     f. Commits test files, pushes to same branch
  3. Return combined WORK_RESULT (implementation + test summary)
```

### Test-Writer Prompt (`prompts/agent2-worker-test.md` — NEW)

```
You are a Test-Writer Agent. You have just received a completed implementation in this
sandbox. Your job is to write tests for the code that was changed.

## Context

**Ticket**: {ticket title + description + acceptance criteria}
**Branch diff vs main**: {git diff main...HEAD}
**Is terminal ticket**: {true/false}
{If terminal and grouped: **Full chain tickets**: {all ticket descriptions in this group}}

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

### Orchestrator Integration

Modify `executeWorker()` to include the test-writer step:

```typescript
private async executeWorker(task: TaskRequest): Promise<WorkerResult> {
  const sandbox = await this.createSandbox(task);

  // Step 1: Implementation worker
  const implResult = await this.runWorkerAgent(sandbox, task);

  // Step 2: Test-writer (same sandbox, deterministic)
  const isTerminal = await this.isTerminal(task);
  const testPrompt = this.buildTestWriterPrompt(task, isTerminal);
  const testResult = await this.runTestWriterAgent(sandbox, testPrompt);

  return { impl: implResult, tests: testResult };
}
```

### `writeResults` Update

The result block now includes test metadata:

```markdown
## Results

**Completed**: 2026-02-14T12:00:00Z
**Branch**: feat/dashboard-v2

### Summary
{parsed from WORK_RESULT}

### Tests
- Unit tests: 8
- Integration tests: 3 (terminal only)
- Files: tests/auth_middleware.test.ts, tests/dashboard_api.test.ts
- All passing: true

### Artifacts
- Commit: abc1234 (implementation)
- Commit: def5678 (tests)
- PR: https://github.com/user/repo/pull/43 (only if terminal)
```

### Files Update

| File | Change |
|------|--------|
| `src/lib/SandboxQueueProcessor.ts` | Add `buildTestWriterPrompt()`, `runTestWriterAgent()`, update `executeWorker()` to include test-writer step, update `writeResults()` to include test metadata |
| `prompts/agent2-worker-test.md` | **New** — Test-Writer prompt with template variables for ticket context, diff, and terminal flag |
