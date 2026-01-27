# Slack Integration Setup Guide

This guide provides detailed instructions for setting up Slack integration with TrafficControl. The Slack integration enables agent-human communication, allowing agents to ask questions, report blockers, and provide status updates.

## Overview

TrafficControl uses Slack's Socket Mode for real-time bidirectional communication. This eliminates the need for a public webhook endpoint and simplifies deployment.

### Required Environment Variables

- `SLACK_BOT_TOKEN` - Bot User OAuth Token (starts with `xoxb-`)
- `SLACK_SIGNING_SECRET` - App signing secret for request verification
- `SLACK_APP_TOKEN` - App-level token for Socket Mode (starts with `xapp-`)
- `SLACK_CHANNEL` - Channel name for notifications (optional, default: `trafficcontrol`)
- `SLACK_CHANNEL_ID` - Channel ID for direct references (optional)
- `SLACK_REPORT_CHANNEL` - Channel for status reports (optional, default: `#trafficcontrol`)

## Step-by-Step Setup

### 1. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **"Create New App"**
3. Choose **"From scratch"**
4. Enter app name (e.g., "TrafficControl Bot")
5. Select your workspace
6. Click **"Create App"**

### 2. Enable Socket Mode

Socket Mode allows your bot to connect to Slack via WebSocket instead of requiring a public HTTP endpoint.

1. In your app settings, go to **Settings > Socket Mode**
2. Toggle **"Enable Socket Mode"** to ON
3. You'll be prompted to create an App-Level Token
4. Click **"Generate Token and Scopes"**
5. Name it (e.g., "socket-token")
6. Add the scope: `connections:write`
7. Click **"Generate"**
8. Copy the token (starts with `xapp-`) and save it as `SLACK_APP_TOKEN` in your `.env` file

### 3. Configure OAuth & Permissions

1. Go to **Features > OAuth & Permissions**
2. Scroll to **"Scopes"** section
3. Under **"Bot Token Scopes"**, add the following scopes:
   - `chat:write` - Send messages as the bot
   - `channels:read` - View basic channel information
   - `channels:history` - View messages in public channels
   - `channels:manage` - Manage channel settings
   - `reactions:read` - View emoji reactions
   - `users:read` - View basic user information

### 4. Install App to Workspace

1. Go to **Settings > Install App**
2. Click **"Install to Workspace"**
3. Review the permissions and click **"Allow"**
4. Copy the **"Bot User OAuth Token"** (starts with `xoxb-`)
5. Save it as `SLACK_BOT_TOKEN` in your `.env` file

### 5. Get Signing Secret

1. Go to **Settings > Basic Information**
2. Scroll to **"App Credentials"**
3. Copy the **"Signing Secret"**
4. Save it as `SLACK_SIGNING_SECRET` in your `.env` file

### 6. Enable Event Subscriptions

**CRITICAL: This step determines whether the bot responds to ALL messages or ONLY @mentions.**

1. Go to **Features > Event Subscriptions**
2. Toggle **"Enable Events"** to ON
3. Under **"Subscribe to bot events"**, add ALL of these:
   - `message.channels` - **REQUIRED** for messages in public channels WITHOUT @mention
   - `message.im` - **REQUIRED** for direct messages to the bot
   - `message.groups` - Optional, for private channels where bot is invited
   - `app_mention` - Optional (messages will work without this)
4. Click **"Save Changes"**
5. **IMPORTANT**: After changing event subscriptions, you may need to reinstall the app to your workspace for changes to take effect

**Troubleshooting**: If the bot only responds when @mentioned:
- Verify `message.channels` is subscribed (not just `app_mention`)
- Reinstall the app to your workspace
- Ensure the bot is invited to the channel (`/invite @YourBotName`)

### 7. Create and Configure Channel

1. Create a channel in your Slack workspace (e.g., `#trafficcontrol`)
2. Invite the bot to the channel: `/invite @YourBotName`
3. Get the channel ID:
   - Right-click the channel name
   - Select **"View channel details"**
   - Scroll down and copy the Channel ID (starts with `C`)
4. Update your `.env` file:
   ```env
   SLACK_CHANNEL=trafficcontrol
   SLACK_CHANNEL_ID=C01234ABCDE
   SLACK_REPORT_CHANNEL=#trafficcontrol
   ```

### 8. Verify Configuration

Your `.env` file should now have all required Slack variables:

```env
# Slack Integration
SLACK_BOT_TOKEN=xoxb-1234567890123-1234567890123-abcdefghijklmnopqrstuvwx
SLACK_SIGNING_SECRET=1234567890abcdef1234567890abcdef
SLACK_APP_TOKEN=xapp-1-A01234ABCDE-1234567890123-abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz123456
SLACK_CHANNEL=trafficcontrol
SLACK_CHANNEL_ID=C01234ABCDE
SLACK_REPORT_CHANNEL=#trafficcontrol
```

### 9. Test the Connection

1. Start TrafficControl:
   ```bash
   npm run build
   npm run start
   ```

2. You should see log messages indicating:
   - "Starting Slack bot in socket mode"
   - "Slack bot is running"

3. Send a test message to the channel and verify the bot can read it

## Slack Bot Features

### Agent Questions

When an agent needs human input, it posts a question in the configured channel:

```
❓ [ProjectName] Agent asks:

Should I use TypeScript or JavaScript for the new component?
```

Reply in the thread to provide your answer. The response is automatically routed back to the agent.

### Blocker Notifications

When an agent is stuck, it reports a blocker:

```
🚫 [ProjectName] Blocked:

Cannot proceed without database credentials.
```

### Visual Review Requests

For UI changes, agents request visual review:

```
👁️ [ProjectName] Visual review needed for: Update homepage layout

React with ✅ to approve or ❌ to request changes.
```

### Status Reports

Morning and evening status reports are automatically posted:

```
📊 TrafficControl Status Report
Thu, Jan 26, 9:00 AM

Overview
Projects:    3 active
Tasks:       5 queued | 2 in progress | 1 blocked
Completed:   8 today | 24 this week
```

### Slash Commands

Use `/tc <command>` to interact with TrafficControl:

- `/tc status` - Show current status
- `/tc pause [project]` - Pause all or specific project
- `/tc resume [project]` - Resume all or specific project
- `/tc add task: <description>` - Add a new task
- `/tc prioritize <project>` - Bump project priority
- `/tc report` - Generate status report
- `/tc dnd [duration]` - Enable Do Not Disturb (e.g., `30m`, `2h`)
- `/tc dnd off` - Disable Do Not Disturb
- `/tc help` - Show help

## Troubleshooting

### Bot is not responding

1. Check that the bot is invited to the channel: `/invite @YourBotName`
2. Verify Socket Mode is enabled
3. Check app logs for connection errors
4. Ensure `SLACK_APP_TOKEN` has `connections:write` scope

### Bot only responds to @mentions (not all messages)

This is the most common issue. It means your Slack App is subscribed to `app_mention` but NOT `message.channels`.

**Fix:**
1. Go to https://api.slack.com/apps and select your app
2. Navigate to **Event Subscriptions > Subscribe to bot events**
3. Add these events:
   - `message.channels` (for public channel messages)
   - `message.im` (for direct messages)
4. Click **Save Changes**
5. Go to **Install App** and click **Reinstall to Workspace**
6. Re-invite the bot to your channels: `/invite @YourBotName`

### Missing messages

1. Verify `message.channels` event subscription is enabled (not just `app_mention`)
2. Check that the bot has `channels:history` scope
3. Ensure the channel is public (bot cannot read private channels without `message.groups` subscription)
4. Reinstall the app after changing event subscriptions

### Authentication errors

1. Verify all tokens are correct and not expired
2. Re-install the app to workspace if tokens were regenerated
3. Check `SLACK_SIGNING_SECRET` matches the one in Slack app settings

### Cannot send messages

1. Verify bot has `chat:write` scope
2. Check that `SLACK_CHANNEL_ID` is correct
3. Ensure bot is a member of the channel

## Security Best Practices

1. **Never commit tokens to version control** - Use `.env` file (already in `.gitignore`)
2. **Rotate tokens regularly** - Generate new tokens periodically
3. **Use channel-specific bot permissions** - Limit bot to specific channels if possible
4. **Monitor bot activity** - Review Slack app audit logs regularly
5. **Restrict app management** - Only authorized team members should have access to Slack app settings

## Advanced Configuration

### Multiple Channels

To route different notifications to different channels, you can:

1. Use `SLACK_CHANNEL` for general notifications
2. Use `SLACK_REPORT_CHANNEL` for status reports
3. Configure different channel IDs in the NotificationManager

### Custom Notification Batching

The default batch interval is configurable in `src/slack/notification-manager.ts`:

```typescript
const config: NotificationConfig = {
  batchIntervalMs: 5000, // 5 seconds
  quietHoursStart: 0,    // Midnight
  quietHoursEnd: 7,      // 7 AM
  channelId: process.env.SLACK_CHANNEL_ID
};
```

### Quiet Hours

Configure quiet hours in your `.env` file:

```env
QUIET_HOURS_START=0   # Midnight
QUIET_HOURS_END=7     # 7 AM
TIMEZONE=America/New_York
```

During quiet hours, only high-priority notifications (blockers) are sent.

## Testing Without Slack

For development or testing without Slack:

1. Comment out or remove Slack environment variables from `.env`
2. TrafficControl will detect missing credentials and skip Slack initialization
3. Notifications will be logged to console instead
4. All other functionality continues to work normally

## References

- [Slack API Documentation](https://api.slack.com/docs)
- [Socket Mode Guide](https://api.slack.com/apis/connections/socket)
- [Bolt for JavaScript](https://slack.dev/bolt-js/concepts)
- [Slack Scopes Reference](https://api.slack.com/scopes)
