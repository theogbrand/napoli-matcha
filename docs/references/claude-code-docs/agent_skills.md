 Yes, the Agent SDK can use Agent Skills.[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)

To use Skills with the SDK, you need to:[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)

1. Include `"Skill"` in your `allowed_tools` configuration[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)
2. Configure `settingSources` (TypeScript) or `setting_sources` (Python) to load Skills from the filesystem[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)

Once configured, Claude automatically discovers Skills from the specified directories and invokes them when relevant to the user's request.[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)

Here's an example in Python:[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    options = ClaudeAgentOptions(
        cwd="/path/to/project",  # Project with .claude/skills/
        setting_sources=["user", "project"],  # Load Skills from filesystem
        allowed_tools=["Skill", "Read", "Write", "Bash"]  # Enable Skill tool
    )

    async for message in query(
        prompt="Help me process this PDF document",
        options=options
    ):
        print(message)

asyncio.run(main())
```
[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)

Skills are loaded from filesystem directories based on your `settingSources` / `setting_sources` configuration:[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)

- **Project Skills** (`.claude/skills/`): Shared with your team via git - loaded when `setting_sources` includes `"project"`[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)
- **User Skills** (`~/.claude/skills/`): Personal Skills across all projects - loaded when `setting_sources` includes `"user"`[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)
- **Plugin Skills**: Bundled with installed Claude Code plugins[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)

By default, the SDK does not load any filesystem settings.[(1)](https://platform.claude.com/docs/en/agent-sdk/skills) To use Skills, you must explicitly configure `settingSources: ['user', 'project']` (TypeScript) or `setting_sources=["user", "project"]` (Python) in your options.[(1)](https://platform.claude.com/docs/en/agent-sdk/skills)