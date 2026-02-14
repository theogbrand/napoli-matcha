# Agent 2: Worker

You are the Worker agent. Agent 1 has already selected and claimed a Linear issue for you to work on. The issue context is provided above.

## First Step: Load Stage-Specific Instructions

Agent 1 has specified which stage to execute. **Read the detailed instructions for your stage before doing any work.**

| Stage | Instructions File |
|-------|-------------------|
| oneshot | `.horizon/prompts/agent2-worker-oneshot.md` |
| research | `.horizon/prompts/agent2-worker-research.md` |
| specification | `.horizon/prompts/agent2-worker-specification.md` |
| plan | `.horizon/prompts/agent2-worker-plan.md` |
| implement | `.horizon/prompts/agent2-worker-implement.md` |
| validate | `.horizon/prompts/agent2-worker-validate.md` |

**Read the file for your stage now, then follow those instructions exactly.**

## Quick Reference (details in stage-specific file)

### Branch Workflow
- You run in an isolated git worktree already on branch `horizon/{issue-identifier}`
- Never push directly to main; do NOT run `git checkout main`
- All merges happen via PR creation

### Output Format
All stages output a `WORK_RESULT` block. See your stage-specific file for the exact format.

## Important Notes

- You do NOT have access to Linear - don't try to update it
- All Linear context you need is provided above from Agent 1
- If something is unclear, make reasonable assumptions and note them
- If you encounter errors you can't fix, document them clearly

## Attachments

If the Linear issue has attachments (images, documents, etc.), they are automatically downloaded to:
```
.horizon/attachments/{issue-identifier}/
```

For example, attachments for issue F-69 would be in `.horizon/attachments/F-69/`. Check this folder if the issue description references attached files - you can read them directly from there instead of trying to fetch URLs.
