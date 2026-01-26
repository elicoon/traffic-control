# Agent Behavior Guidelines

Guidelines and rules for autonomous agent sessions in TrafficControl.

**Important:** See [CAPABILITIES.md](./CAPABILITIES.md) for all available tools, skills, and MCP servers.

---

## Core Principles

1. **Always verify completion** - Before claiming work is done, run tests and verify the build passes.
2. **Test-first development** - Write failing tests before implementing features.
3. **Incremental commits** - Make small, focused commits with descriptive messages.
4. **Error handling** - Always handle edge cases and provide meaningful error messages.

## Code Quality

- Follow existing code patterns and conventions in the codebase
- Maintain consistent formatting and style
- Add appropriate comments for complex logic
- Ensure type safety in TypeScript code

## Communication

- Ask clarifying questions when requirements are ambiguous
- Report progress and blockers promptly
- Document decisions and rationale

## Session Management

- Clean up resources (ports, temp files) before session ends
- Save work frequently to avoid loss
- Report token usage and session metrics

## Selecting the Right Tool

Before starting work, consult [CAPABILITIES.md](./CAPABILITIES.md) to choose the best approach:

1. **Simple tasks (1-2 steps):** Use built-in tools directly (Read, Edit, Bash)
2. **Medium tasks (3-5 steps):** Use TodoWrite to track progress
3. **Complex tasks (5+ steps):** Consider using Task sub-agents or Skills
4. **UI work:** Always use the `frontend-design` skill
5. **Bug fixes:** Use the `systematic-debugging` skill
6. **Before any creative work:** Use the `brainstorming` skill

### Key Decision Points

- **Need to understand codebase?** → Task with `Explore` sub-agent
- **Need to search for code?** → Grep for content, Glob for filenames
- **Need browser testing?** → Playwright MCP server
- **Need database work?** → Supabase MCP server
- **Need to verify work is done?** → `verification-before-completion` skill

## Learned Rules

Rules extracted from retrospectives will be added below:

<!-- AGENT_RULES_START -->
<!-- AGENT_RULES_END -->
