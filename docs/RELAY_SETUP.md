# Slack Claude Relay Setup Guide

The relay module bridges Slack messages to Claude Code CLI sessions. Send a message in Slack, and the relay spawns a Claude Code process against a local project directory, streaming progress and results back to the Slack thread.

## How It Works

1. A user sends a message (or @mentions the bot) in a Slack channel
2. The relay looks up which project directory is mapped to that channel
3. It spawns `claude --print --output-format stream-json` in that directory
4. Tool-use progress (reading files, running commands, etc.) is posted to the thread
5. The final response is posted back to the thread
6. The Claude session ID is stored so follow-up messages in the same thread resume the conversation

## Prerequisites

- **Claude Code CLI** installed and authenticated (`claude` available in PATH)
- **Slack App** configured with Socket Mode (see [SLACK_SETUP.md](SLACK_SETUP.md) for base Slack setup)
- The Slack App must have these bot event subscriptions:
  - `message.channels` — public channel messages
  - `message.im` — direct messages
  - `message.groups` — private channels (optional)

## Environment Variables

The relay reuses the same Slack tokens as the main TrafficControl bot (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`). These additional variables configure relay-specific behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_MODEL` | `sonnet` | Model to use: `sonnet` or `opus` |
| `RELAY_CLI_PATH` | `claude` | Path to the Claude Code CLI executable |
| `RELAY_PROJECTS_DIR` | _(not set)_ | Base directory for fuzzy project name matching (e.g., `~/projects`) |
| `RELAY_TIMEOUT_MS` | `600000` | CLI operation timeout in milliseconds (default: 10 minutes) |

### Example `.env` additions

```env
# Relay configuration
RELAY_MODEL=sonnet
RELAY_CLI_PATH=claude
RELAY_PROJECTS_DIR=/home/user/projects
RELAY_TIMEOUT_MS=600000
```

## Slack Commands

### Setting a project for a channel

When the bot receives a message in a channel with no project mapping, it asks:

> I don't have a project set for this channel yet. Which directory should I work in?

Reply with either:
- A full path: `/home/user/projects/my-app`
- A project name: `my-app` (requires `RELAY_PROJECTS_DIR` to be set)

The mapping is saved to `~/.relay-projects.json` and persists across restarts.

### Switching projects

```
switch to /home/user/projects/other-app
```

Or with fuzzy matching (if `RELAY_PROJECTS_DIR` is set):

```
switch to other-app
```

Fuzzy matching is case-insensitive and ignores hyphens, underscores, and spaces. For example, `trafficcontrol` matches a directory named `traffic-control`.

### Resetting a conversation

```
!reset
```

Clears the stored session ID for the current thread. The next message starts a fresh Claude conversation.

### Sending a request

Any message that isn't a command is relayed to Claude Code:

```
What files handle authentication in this project?
```

The bot replies with "Working on it..." and posts progress updates (e.g., "Reading auth.ts...", "Running command...") as Claude works. The final response is posted in the thread.

## Example Use Case

**Scenario:** You want to ask Claude to review a pull request from your phone via Slack.

1. Create a Slack channel `#my-app-dev` and invite the bot
2. Send any message — the bot asks for the project directory
3. Reply with `my-app` (or the full path)
4. Send: `Review the changes in the last commit and summarize what was changed`
5. Claude reads the git log, diffs the files, and posts a summary in the thread
6. Follow up in the same thread: `Are there any potential issues with the error handling?`
7. Claude resumes the same session and answers with full context

## Architecture

```
Slack message
  -> RelayBot (bot.ts) receives event via Socket Mode
  -> ProjectStore (project-store.ts) resolves channel -> project path
  -> SessionStore (session-store.ts) checks for existing session ID
  -> RelayHandler (handler.ts) spawns Claude CLI process
  -> Streams JSON output, posts progress to Slack thread
  -> Stores session ID for conversation continuity
  -> Posts final response (chunked if > 3800 chars)
```

### Key implementation details

- The CLI is spawned with `--dangerously-skip-permissions` for non-interactive use
- `ANTHROPIC_API_KEY` is stripped from the child process environment so the CLI uses a Max subscription instead of API billing
- Long responses are automatically split at paragraph/line boundaries to fit Slack's 4000-character limit
- Progress updates are rate-limited to one every 3 seconds to avoid flooding the thread

## Troubleshooting

### Bot doesn't respond to messages

- Verify `message.channels` is subscribed in your Slack App's Event Subscriptions (not just `app_mention`)
- Reinstall the app after changing event subscriptions
- Ensure the bot is invited to the channel: `/invite @YourBotName`

### "Claude CLI not found"

- Verify `claude` is in PATH, or set `RELAY_CLI_PATH` to the full path
- Check that `claude` works when run manually in the terminal

### "Claude CLI needs authentication"

- Run `claude` in a terminal on the host machine and complete the login flow

### Fuzzy project matching doesn't work

- Set `RELAY_PROJECTS_DIR` to the parent directory containing your projects
- Ensure the directory exists and contains subdirectories

### Responses are cut off

- Responses over 3800 characters are automatically chunked into multiple messages
- If the CLI times out, increase `RELAY_TIMEOUT_MS`

### Session resume fails

- The relay automatically falls back to starting a fresh session
- Use `!reset` to manually clear a stale session
