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

### Verification and Completion (from 2026-01-26-premature-completion-claim.md)

1. **Never claim "it's ready" without verification**
   - "No errors" during compilation or startup does NOT mean the system is working
   - Silent failures are common in distributed systems
   - Always run or instruct running a smoke test before declaring completion

2. **Verify end-to-end functionality before claiming completion**
   - For TrafficControl: Check that agents spawn, Slack responds, and main loop processes tasks
   - For code changes: Run the affected functionality to ensure it works as expected
   - Use database queries or logs to verify actual state, not assumptions

3. **Define "done" criteria before starting work**
   - Before implementing a fix, establish what "working" looks like
   - Create specific, testable acceptance criteria
   - Document the verification steps you'll use

4. **The user should not be the first to discover failures**
   - Your job is to catch issues before the user encounters them
   - Test the changes yourself before reporting completion
   - If you can't test directly, provide explicit verification instructions

5. **Compilation success ≠ Runtime success**
   - TypeScript compiling cleanly says nothing about runtime behavior
   - Database connections, API calls, and integrations can fail silently
   - Always verify the actual execution path, not just syntax

<!-- AGENT_RULES_END -->
