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