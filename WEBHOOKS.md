# Dynamic Webhook System

## Overview

The Reply Agent now supports **dynamic webhook URLs per agent**, allowing you to:
- Run multiple agents across different EmailBison workspaces
- Isolate replies by workspace and client
- Scale to multiple outreach tools in the future
- Test webhooks independently per agent

Each agent gets a unique webhook URL that routes replies only to that specific agent.

## Setup Instructions

### 1. Run Database Migration

First, add the webhook fields to your agents table in Supabase:

1. Open **Supabase Dashboard** → **SQL Editor**
2. Run the migration file: `migrations/add_webhook_fields_to_agents.sql`
3. Or manually run:

```sql
-- Add webhook fields
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS webhook_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- Create index
CREATE INDEX IF NOT EXISTS idx_agents_webhook_id ON agents(webhook_id);
```

### 2. Migrate Existing Agents

Add webhook URLs to existing agents:

```bash
curl -X POST http://localhost:3000/api/agents/migrate-webhooks
```

This will:
- Generate unique webhook IDs for all agents without webhooks
- Return the webhook URLs for each agent

Response example:
```json
{
  "success": true,
  "message": "Successfully added webhooks to 1 agents",
  "updated": 1,
  "agents": [
    {
      "agent_id": "ab1fb91f-c6d5-424e-9c42-075d8c6b6fa1",
      "agent_name": "Test Kim - Ani",
      "webhook_id": "550e8400-e29b-41d4-a716-446655440000",
      "webhook_url": "https://your-domain.com/api/webhooks/550e8400-e29b-41d4-a716-446655440000"
    }
  ]
}
```

### 3. Configure EmailBison Webhooks

For each agent:

1. **Get the webhook URL**:
   ```bash
   curl http://localhost:3000/api/agents/[AGENT_ID]/test-webhook
   ```

2. **Configure in EmailBison**:
   - Go to your EmailBison workspace settings
   - Navigate to **Webhooks** or **Integrations**
   - Add a new webhook with the URL from step 1
   - Select events: `reply.received` (or equivalent)

3. **Test the webhook**:
   ```bash
   curl -X POST http://localhost:3000/api/agents/[AGENT_ID]/test-webhook
   ```

   This sends a test payload and verifies the webhook is working.

## Webhook URL Format

```
https://your-domain.com/api/webhooks/[WEBHOOK_ID]
```

Where `[WEBHOOK_ID]` is a unique UUID for each agent.

## How It Works

### 1. Agent Creation
When you create a new agent:
- A unique `webhook_id` (UUID) is automatically generated
- The webhook URL is returned in the response
- Store this URL in your EmailBison workspace

### 2. Webhook Routing
When EmailBison sends a reply to your webhook:
1. Request arrives at `/api/webhooks/[webhook_id]`
2. System finds the agent with matching `webhook_id`
3. Reply is processed only for that specific agent
4. Workspace isolation is maintained

### 3. Auto-Processing
For each webhook:
1. ✅ Validates agent exists and is active
2. ✅ Categorizes reply using AI (interested/not interested)
3. ✅ Generates response for interested leads
4. ✅ Auto-sends if `fully_automated` mode and high confidence
5. ✅ Marks for approval if `human_in_loop` or low confidence

## API Endpoints

### Get Webhook Info
```bash
GET /api/agents/[AGENT_ID]/test-webhook
```

Returns webhook URL and configuration for an agent.

### Test Webhook
```bash
POST /api/agents/[AGENT_ID]/test-webhook
```

Sends a test payload to verify the webhook is working correctly.

### Migrate Webhooks
```bash
POST /api/agents/migrate-webhooks
```

Adds webhook IDs to existing agents that don't have them.

### Dynamic Webhook Endpoint
```bash
POST /api/webhooks/[WEBHOOK_ID]
```

Receives EmailBison webhook payloads. This is the URL you configure in EmailBison.

## Expected EmailBison Webhook Payload

The system expects EmailBison to send payloads in this format:

```json
{
  "event": "reply.received",
  "reply": {
    "id": "16241964",
    "from_email_address": "lead@example.com",
    "from_name": "John Doe",
    "subject": "Re: Your outreach",
    "text_body": "Thanks for reaching out...",
    "html_body": "<p>Thanks for reaching out...</p>",
    "date_received": "2026-02-11T10:30:00Z",
    "interested": true,
    "automated_reply": false,
    "tracked_reply": false,
    "campaign_id": "12345"
  }
}
```

## Troubleshooting

### Webhook not receiving replies
1. **Check agent is active**: `GET /api/agents/[AGENT_ID]`
2. **Verify webhook URL**: `GET /api/agents/[AGENT_ID]/test-webhook`
3. **Test the webhook**: `POST /api/agents/[AGENT_ID]/test-webhook`
4. **Check EmailBison webhook logs** for delivery failures

### Workspace mismatch errors
- Ensure the EmailBison API key for the agent matches the workspace
- Each agent should have an API key from its corresponding workspace

### Replies going to wrong agent
- Verify you're using the correct webhook URL in EmailBison
- Each workspace should have a unique webhook URL

## Security

### Optional: Webhook Verification
To add webhook signature verification:

1. Enable `webhook_secret` in agent creation
2. Implement signature verification in `/api/webhooks/[webhook_id]/route.ts`
3. Update EmailBison webhook configuration with the secret

## Migration Checklist

- [ ] Run database migration to add webhook fields
- [ ] Run `/api/agents/migrate-webhooks` to add webhooks to existing agents
- [ ] Copy webhook URLs for each agent
- [ ] Configure webhook URLs in corresponding EmailBison workspaces
- [ ] Test each webhook using the test endpoint
- [ ] Verify replies are being received and processed

## Support

If you encounter issues:
1. Check the server logs for webhook errors
2. Verify the database migration was successful
3. Ensure EmailBison is sending webhooks to the correct URL
4. Test the webhook using the built-in test endpoint
