# Proposed Arch

## UIUX:
### Stage 0:
- Edit request_queue/joke_test.md with status 'Backlog' and run:
    - To add ENUM for status later

```bash
npm install
npx tsx src/index.ts 
```

### Stage 1:
run CLI with request and repo (SOON):
```bash
npx tsx src/index.ts https://github.com/scikit-learn/scikit-learn \
  -p "Investigate TODO comments across this repository. Spawn sub-agents to explore different modules. Find the easiest TODO and fix it."
```

### Stage 2:
Submit issues via some queue

## Agent Hierarchy:
RLM with 3-agent hierarchy:
1. Issue Reader Agent 
    - Filters open issues from markdown files in directory ./issues, and returns a list of issues that are ready to be worked on.
        - Use Issue statuses as FSM
2. Worker Agent
3. Issue Writer Agent

---

# How It Works

Dawn is an automated orchestration agent that takes software tasks from a markdown queue, runs them through a multi-stage AI pipeline in isolated cloud sandboxes, and delivers pull requests.

## Architecture

```
request_queue/*.md            Daytona Sandbox
┌──────────────┐         ┌─────────────────────────┐
│  Task (YAML  │         │  Node.js container       │
│  frontmatter │────────▶│  ├── cloned repo         │
│  + markdown) │         │  ├── claude CLI           │
└──────────────┘         │  └── gh CLI               │
       ▲                 └──────────┬────────────────┘
       │  status update             │  WORK_RESULT
       └────────────────────────────┘
```

## Core Loop

The `SandboxQueueProcessor` continuously polls for work:

```
                        ┌─────────────────────┐
                        │  Load all tasks from │
                        │  request_queue/*.md  │
                        └─────────┬───────────┘
                                  ▼
                        ┌─────────────────────┐
                        │  Filter eligible:    │
                        │  • actionable status │
                        │  • not already active│
                        │  • deps all Done     │
                        └─────────┬───────────┘
                                  ▼
                   ┌──────────────────────────────┐
                   │  Dispatch up to maxConcurrency│
                   │  tasks in parallel             │
                   └──────────────┬────────────────┘
                                  ▼
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
   ┌─────────────────────┐               ┌───────────────────┐
   │   FULL PIPELINE      │               │   ONE-SHOT        │
   │   (status: Needs     │               │   (status: Needs  │
   │    Research)          │               │    Oneshot)       │
   └─────────┬────────────┘               └─────────┬─────────┘
              │                                      │
              ▼                                      │
   Research ──▶ Specification                        │
       ──▶ Plan ──▶ Implement                        │
              ──▶ Validate                           │
              │                                      │
              ▼                                      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Terminal task + code-producing stage?                    │
   │  YES → inject merge instructions → Claude opens PR       │
   │  NO  → advance status, continue pipeline                 │
   └────────────────────────┬─────────────────────────────────┘
                            ▼
              ┌──────────────────────────┐
              │  Parse WORK_RESULT:      │
              │  • next_status           │
              │  • branch_name           │
              │  • pr_url                │
              │  • preview_url           │
              │  • artifacts             │
              └────────────┬─────────────┘
                           ▼
              ┌──────────────────────────┐
              │  Update task frontmatter │
              │  → loop back to top      │
              └──────────────────────────┘
```

### Pathway: Full Pipeline vs One-Shot

The pathway is determined by the task's initial `status:` in its YAML frontmatter:

| Pathway | Starting Status | Stages | Use Case |
|---------|----------------|--------|----------|
| **Full Pipeline** | `Needs Research` | Research → Specification → Plan → Implement → Validate → PR | Complex features requiring design |
| **One-Shot** | `Needs Oneshot` | Single Claude invocation → PR | Well-defined bug fixes, small changes |

Each stage transitions through an **In Progress** status while executing:
`Needs X` → `X In Progress` → `Needs Y` (next stage) or `Done` / `Blocked`

A task can also enter `Needs Human Review` or `Needs Human Decision` to pause for external input.

## Stage Pipeline

Each stage runs Claude with a stage-specific prompt in the same sandbox:

| Stage | What Claude Does |
|-------|-----------------|
| **Research** | Analyzes the repo and requirements |
| **Specification** | Designs the UX/interaction model |
| **Plan** | Creates a technical implementation plan |
| **Implement** | Writes code, runs tests locally |
| **Validate** | Verifies quality and test coverage |
| **PR/Merge** | Opens a pull request on GitHub |

Only **Implement**, **Validate**, and **Oneshot** are code-producing stages — these trigger auto-merge logic on terminal tasks.

## Sandbox Lifecycle & Preview URLs

For each dispatched task, a single Daytona sandbox handles all of its stages:

```
┌─ Sandbox Boot ───────────────────────────────────────────────┐
│  1. Create Daytona sandbox (Node.js + git + gh + claude)     │
│  2. Clone target repo, checkout/create feature branch        │
│  3. Generate signed preview URLs for ports 3000, 5173, 8080  │
│     (valid 72 hours)                                         │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌─ Stage Execution (repeats per stage) ────────────────────────┐
│  1. Build prompt with task context + prior stage artifacts    │
│  2. Inject {{PREVIEW_URL}} and {{PREVIEW_URLS}} into prompt  │
│  3. Run Claude via PTY, stream output in real-time           │
│  4. Parse WORK_RESULT block from output                      │
│  5. Resolve localhost URLs → signed Daytona preview URLs     │
│     (e.g. localhost:5173 → https://5173-xxx.proxy.daytona.io)│
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌─ Cleanup ────────────────────────────────────────────────────┐
│  preview_url in WORK_RESULT?                                 │
│  YES → keep sandbox alive (user deletes from Daytona dash)   │
│  NO  → delete sandbox immediately                            │
└──────────────────────────────────────────────────────────────┘
```

Preview URLs let reviewers interact with running apps (e.g. a Vite dev server) before merging — the sandbox stays alive so the URL keeps working.

## Known Issues

- **Daytona sandboxes can get stuck in "spawning" state** — Occasionally, sandbox creation fails to complete and hangs indefinitely. Restarting Dawn to rerun the task usually resolves this.