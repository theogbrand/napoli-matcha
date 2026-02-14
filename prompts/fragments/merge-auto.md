## Merge Strategy: Auto

After completing your work:
- If this is a **terminal task** (last in the chain, no downstream dependencies): create a Pull Request
- If this is a **non-terminal task** (other tasks depend on this): push directly to the branch

For PRs, use:
```bash
gh pr create --head <branch> --title "<title>" --body "<summary of changes>"
```

For direct push:
```bash
git push origin <branch>
```
