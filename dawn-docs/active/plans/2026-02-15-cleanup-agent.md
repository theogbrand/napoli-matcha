# Plan: Artifact Archival (active → completed)

## Context

Commit 5bafc23 restructured `dawn-docs/` into `active/` and `completed/` mirrored directories. The unstaged changes update all agent prompts and tests to write artifacts to `dawn-docs/active/{stage}/`. But there's no mechanism to move artifacts to `dawn-docs/completed/{stage}/` when a task finishes. Artifacts accumulate in `active/` forever.

## Recommended Approach: Merge Fragment Enhancement

Rather than a cleanup subagent (overkill - spinning up an LLM for `git mv`) or raw TypeScript shelling into the sandbox (fragile - second git actor after the merge agent), we extend the merge flow that already handles all git operations.

**How it works:**
1. The orchestrator reads the task's `artifacts` map from frontmatter and pre-computes exact `git mv` commands
2. These commands are injected into the merge prompt via a new `{{ARTIFACT_ARCHIVE_COMMANDS}}` template variable
3. The merge agent runs them as a step in its existing git workflow

**Why this wins:**
- ~70 lines total across prompts + TypeScript + tests
- The merge agent already does complex git operations (merge, conflict resolution, PR creation)
- For direct merge: archive commit happens on main before push
- For PR merge: archive is part of the feature branch, lands in `completed/` when PR merges. If PR is closed without merge, artifacts correctly stay in `active/` on main

## Implementation

### 1. Add `buildArchiveCommands()` helper to `SandboxQueueProcessor`

**File:** `src/lib/SandboxQueueProcessor.ts`

New private method (~7 lines):
```typescript
private buildArchiveCommands(artifacts: Record<string, string> | undefined): string {
  if (!artifacts || Object.keys(artifacts).length === 0) return "No artifacts to archive.";
  const moves = Object.values(artifacts)
    .filter(p => p.startsWith("dawn-docs/active/"))
    .map(p => `git mv "${p}" "${p.replace("dawn-docs/active/", "dawn-docs/completed/")}"`)
    .join("\n");
  return moves || "No artifacts to archive.";
}
```

### 2. Inject `ARTIFACT_ARCHIVE_COMMANDS` into both prompt builders

**`buildMergePrompt()`** (line 282): Read frontmatter, call helper, add to template vars.

**`buildStagePrompt()`** (line 227): Already reads frontmatter at line 250-252. Add `ARTIFACT_ARCHIVE_COMMANDS` to the `vars` map at line 239 so inline merge fragments also get filled.

### 3. Add archive step to merge fragments

**`merge-direct.md`**: Add step between successful merge and `git push`:
```markdown
### Step 8.5: Archive Artifacts
After merge, move task artifacts from active to completed:
```bash
{{ARTIFACT_ARCHIVE_COMMANDS}}
git add dawn-docs/
git commit -m "chore: archive artifacts to completed"
```
If any git mv fails (file not found), skip it and continue.
```

**`merge-pr.md`**: Add step before PR creation (Step 9). Commit + push to feature branch so the PR includes the archive.

**`merge-auto.md`**: Same pattern in both Option A (direct) and Option B (PR) sections.

### 4. Tests

**File:** `tests/orchestrator_logic.test.ts`

- `"buildArchiveCommands generates git mv for each artifact"` - pass artifacts map, assert output contains correct git mv commands
- `"buildArchiveCommands returns no-op for empty artifacts"` - no artifacts → "No artifacts to archive."
- `"buildMergePrompt includes archive commands"` - task with artifacts → merge prompt contains the git mv commands

## Files to Modify

| File | Change |
|---|---|
| `src/lib/SandboxQueueProcessor.ts` | Add `buildArchiveCommands()`, modify `buildMergePrompt()` + `buildStagePrompt()` |
| `prompts/fragments/merge-direct.md` | Add archive step (~8 lines) |
| `prompts/fragments/merge-pr.md` | Add archive step (~8 lines) |
| `prompts/fragments/merge-auto.md` | Add archive step in both options (~16 lines) |
| `tests/orchestrator_logic.test.ts` | Add tests for archive command generation |

## Verification

1. Run `npm test` - all existing + new tests pass
2. Run `npx tsc --noEmit` - TypeScript compiles
3. Manual: create a task with artifacts in frontmatter, verify `buildMergePrompt()` output contains the `git mv` commands with correct active→completed paths
