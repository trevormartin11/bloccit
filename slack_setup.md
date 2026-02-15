# Slack Notifications Setup

This project includes a script that lets Claude send you Slack messages in the `#claude` channel when it needs your input or runs into an issue.

## 1. Create a Slack Incoming Webhook

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name it something like `Claude Notifications` and select your workspace
4. In the left sidebar, click **Incoming Webhooks**
5. Toggle **Activate Incoming Webhooks** to On
6. Click **Add New Webhook to Workspace**
7. Select the **#claude** channel and click **Allow**
8. Copy the **Webhook URL** (it looks like `https://hooks.slack.com/services/T00.../B00.../xxx...`)

## 2. Configure the Project

Create a `.env` file in the project root (it's already gitignored):

```bash
cp .env.example .env
```

Then edit `.env` and paste your webhook URL:

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## 3. Usage

The script supports several notification types:

```bash
# General update
bin/notify-slack "Making progress on the feature"

# Blocked and needs input
bin/notify-slack --blocked "Can't proceed — need to know which auth provider to use"

# Question
bin/notify-slack --question "Should I use PostgreSQL or keep SQLite for development?"

# Task complete
bin/notify-slack --done "Finished implementing user registration"
```

## How It Works in Practice

During Claude Code sessions, when Claude encounters a blocker or needs a decision, it will run:

```bash
bin/notify-slack --blocked "Description of the issue"
```

You'll see a formatted message in `#claude` with the details. You can then respond in the conversation to unblock Claude.
