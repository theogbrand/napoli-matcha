# Horizon's Dawn Agents

Horizon's Dawn Agents work in parallel to turn feature requests into PRs with velocity and confidence.

Dawn Agents are self-documenting, self-improving, and understand your team's tooling, tribal knowledge, and preferences.

Dawn Agents focus on building systems and procedures that give engineers high confidence in PR quality without manual code review. These systems include robust testing suites, comprehensive success criteria, and human-in-the-loop when clarity is needed.

## Quick Start

### 1. Install

```bash
npm install -g dawn-cli-agent
```

### 2. Configure environment

Create a `.env` file in your project root:

```env
# Required
DAYTONA_API_KEY=...
ANTHROPIC_API_KEY=...
GITHUB_TOKEN=...

# Optional
DAWN_CLAUDE_MODEL=claude-opus-4-6     # Model to use
DAWN_MAX_CONCURRENCY=1                # Parallel tasks
DAWN_MERGE_MODE=pr                    # "pr" | "auto" | "direct"
DAWN_POLL_INTERVAL=5000               # Poll interval (ms)
DAWN_MAX_ITERATIONS=Infinity          # Max loop iterations
```

### 3. Add tasks

Create a `request_queue/` directory and add markdown files — one per task:

```markdown
---
title: Fix the login bug
description: The login form crashes when email contains a +
repo: https://github.com/your-org/your-repo
status: Needs Oneshot
---

Additional context for the agent goes here in the markdown body.
```

### 4. Run

```bash
dawn
```

Dawn picks up every actionable task in `request_queue/`, spins up isolated Daytona sandboxes, runs Claude, and opens PRs on the target repos.

---

## Task File Reference

Task files live in `request_queue/*.md`. Each file has YAML frontmatter that drives the pipeline.

### Required Fields

| Field         | Type   | Description |
|---------------|--------|-------------|
| `title`       | string | Short task name |
| `description` | string | What the agent should do |
| `repo`        | string | Target GitHub repo URL |
| `status`      | string | Pipeline entry point (see statuses below) |

### Optional Fields

| Field                | Type             | Description |
|----------------------|------------------|-------------|
| `id`                 | string           | Unique task ID (auto-generated as `AGI-N` if omitted) |
| `number_of_sandboxes`| number          | Sandbox instances to create (default `1`) |
| `depends_on`         | string or array  | Task ID(s) that must reach `Done` before this task runs |
| `group`              | string           | Branch naming group (`dawn/{group}`) |
| `variant_hint`       | string           | Execution variant hint (`"pty"` or `"exec"`) |

### Generated Fields (written by Dawn at runtime)

| Field          | Type   | Set when |
|----------------|--------|----------|
| `branch_name`  | string | Sandbox starts |
| `commit_hash`  | string | Work completes |
| `pr_url`       | string | PR is created |
| `preview_url`  | string | Live preview available |
| `last_summary` | string | Each stage completes |
| `last_error`   | string | A stage fails |
| `artifacts`    | object | Stage produces output (`{ "Research": "path" }`) |

### Status Values

**Starting statuses** — set one of these to queue a task:

| Status             | Pipeline |
|--------------------|----------|
| `Needs Research`   | Full pipeline: Research → Specification → Plan → Implement → Validate → PR |
| `Needs Oneshot`    | Single-shot: one Claude invocation → PR |

You can also enter the full pipeline at any stage: `Needs Specification`, `Needs Plan`, `Needs Implement`, `Needs Validate`.

**Runtime statuses** (set automatically by Dawn):

| Status                  | Meaning |
|-------------------------|---------|
| `* In Progress`         | Stage currently executing |
| `Done`                  | Task completed |
| `Awaiting Merge`        | PR created, awaiting merge |
| `Blocked`               | Stage failed |
| `Needs Human Review`    | Paused for human review |
| `Needs Human Decision`  | Paused for human decision |

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