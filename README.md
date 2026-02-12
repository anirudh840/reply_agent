# Reply Agent - EmailBison

AI-powered reply automation system for cold email campaigns using EmailBison.

## Features

- **Intelligent Reply Categorization**: Uses GPT-4o-mini to distinguish genuine interest from false positives
- **RAG-based Response Generation**: Generates contextual responses using your knowledge base
- **Automated Follow-up Sequences**: Configurable follow-up timing (1 day, 3 days, 10 days)
- **Approval Workflows**: Low-confidence responses require manual approval
- **Learning System**: Improves over time by learning from user corrections
- **Multi-Agent Support**: Create multiple agents for different campaigns/workspaces

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, shadcn/ui
- **Database**: Supabase (PostgreSQL + pgvector)
- **AI**: OpenAI GPT-4o-mini & text-embedding-3-large
- **Email**: EmailBison API (mail.revgenlabs.com)

## Setup Instructions

### 1. Database Setup

Run the SQL script in your Supabase SQL Editor:

1. Go to your Supabase project: https://fxxjfgfnrywffjmxoadl.supabase.co
2. Navigate to **SQL Editor**
3. Open the file `supabase-schema.sql`
4. Copy all the SQL and paste it into the editor
5. Click **Run** to create all tables and functions

This will create 5 tables:
- `agents` - Agent configurations and knowledge base
- `replies` - All email replies with AI categorization
- `interested_leads` - Active conversations with follow-up tracking
- `knowledge_base_embeddings` - Vector embeddings for RAG
- `feedback_logs` - User corrections for learning

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

The `.env.local` file is already configured with your Supabase credentials.

**Important**: Users will provide their own API keys per agent:
- EmailBison API key
- OpenAI API key

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Project Structure

```
├── app/                          # Next.js app directory
│   ├── api/                      # API routes
│   ├── dashboard/                # Dashboard page
│   ├── inbox/                    # Master Inbox page
│   ├── agents/                   # Agents management
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Home (redirects to dashboard)
│
├── lib/                          # Core library code
│   ├── supabase/
│   │   ├── client.ts            # Supabase client setup
│   │   ├── database.types.ts    # TypeScript database types
│   │   └── queries.ts           # Database query helpers
│   ├── emailbison/
│   │   └── client.ts            # EmailBison API wrapper
│   ├── openai/
│   │   ├── client.ts            # OpenAI client wrapper
│   │   ├── categorizer.ts       # Reply categorization logic
│   │   ├── generator.ts         # Response generation logic
│   │   └── embeddings.ts        # Embedding generation
│   ├── rag/
│   │   └── retrieval.ts         # Vector similarity search
│   ├── types.ts                 # TypeScript type definitions
│   ├── constants.ts             # App constants
│   └── utils.ts                 # Utility functions
│
├── components/                   # React components
│   ├── ui/                      # shadcn/ui components
│   ├── dashboard/               # Dashboard-specific components
│   ├── inbox/                   # Inbox-specific components
│   └── agents/                  # Agent management components
│
└── supabase-schema.sql          # Database schema SQL script
```

## Core Features Implemented

### ✅ Completed

1. **Project Infrastructure**
   - Next.js 14 with TypeScript configured
   - Tailwind CSS and component library setup
   - Environment variables configured

2. **Database Schema**
   - Complete SQL schema with all 5 tables
   - Vector search capability with pgvector
   - Triggers and helper functions
   - Indexes for optimal performance

3. **Core Library Files**
   - Supabase client and query helpers
   - EmailBison API integration with retry logic
   - OpenAI client for chat and embeddings
   - Comprehensive TypeScript types

4. **RAG System**
   - Embedding generation for knowledge base
   - Vector similarity search
   - Context retrieval and formatting
   - Chunking logic for large documents

5. **AI Logic**
   - Reply categorization (interested vs not interested)
   - Response generation with confidence scoring
   - Follow-up email generation
   - Context-aware prompts

### 🚧 Remaining Work

1. **API Routes** (estimated: 2-3 hours)
   - `/api/agents` - CRUD operations for agents
   - `/api/replies` - Fetch and process replies
   - `/api/responses/generate` - Generate AI responses
   - `/api/responses/send` - Send approved responses
   - `/api/followups/schedule` - Cron job for follow-ups

2. **UI Components** (estimated: 4-5 hours)
   - Navigation sidebar
   - Dashboard with metrics and charts
   - Master Inbox with filters and lead details
   - Agent creation wizard (5-step process)
   - Response approval interface

3. **Follow-up Automation** (estimated: 1-2 hours)
   - Cron job setup (Vercel Cron or node-cron)
   - Daily check for due follow-ups
   - Timezone-aware scheduling

4. **Error Handling & Testing** (estimated: 2-3 hours)
   - Comprehensive error handling
   - End-to-end workflow testing
   - Edge case handling

## How It Works

### 1. Reply Processing Flow

```
EmailBison Reply → Fetch via API → Store in DB → AI Categorization →
If Interested → Generate Response → Check Confidence →
  If >6: Auto-send
  If ≤6: Request approval
```

### 2. Follow-up Flow

```
Daily Cron Job → Check leads due for follow-up →
Generate follow-up based on stage → Send automatically →
Update next follow-up date
```

### 3. Learning Loop

```
User edits response → Log in feedback_logs →
Extract patterns → Update knowledge base →
Re-generate embeddings → Improved future responses
```

## API Endpoints (To Be Implemented)

### Agents
- `GET /api/agents` - List all agents
- `POST /api/agents` - Create new agent
- `GET /api/agents/[id]` - Get agent details
- `PATCH /api/agents/[id]` - Update agent
- `DELETE /api/agents/[id]` - Delete agent

### Replies
- `GET /api/replies` - List replies with filters
- `POST /api/replies/sync` - Sync from EmailBison
- `POST /api/replies/webhook` - Webhook handler

### Responses
- `POST /api/responses/generate` - Generate AI response
- `POST /api/responses/send` - Send approved response
- `PATCH /api/responses/[id]/approve` - Approve response

### Follow-ups
- `POST /api/followups/schedule` - Cron endpoint
- `GET /api/followups/due` - Get leads due for follow-up

### Dashboard
- `GET /api/dashboard/metrics` - Get dashboard metrics
- `GET /api/dashboard/chart-data` - Get chart data

## Configuration

### Agent Modes

**Fully Automated**
- High-confidence responses sent automatically
- Low-confidence responses need approval
- Follow-ups sent automatically

**Human in Loop**
- All responses require approval before sending
- User reviews and can edit every message
- More control, less automation

### Follow-up Sequences

**Default Sequence:**
- Day 1: Value-driven follow-up
- Day 4: Second value-driven follow-up (3 days after first)
- Day 14: Close-up email (10 days after second)

**Custom Sequence:**
- Configure your own delays and message types
- Set custom instructions for each follow-up stage

## Confidence Scoring

The AI generates a confidence score (0-10) for each response:

- **8-10**: High confidence - automatically sent (Fully Automated mode)
- **6-7**: Medium confidence - sent with caution
- **0-5**: Low confidence - requires approval

Factors affecting confidence:
- Quality of knowledge base match
- Clarity of lead's question
- Availability of relevant information

## Security

- API keys stored encrypted in database
- Service role key used for server-side operations
- Row Level Security available (currently disabled)
- Environment variables for sensitive data

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Enable Vercel Cron for follow-ups
5. Deploy

### Cron Configuration (vercel.json)

```json
{
  "crons": [{
    "path": "/api/followups/schedule",
    "schedule": "0 9 * * *"
  }]
}
```

## Troubleshooting

**Database connection issues:**
- Verify Supabase URL and service key
- Check if tables were created successfully

**EmailBison API errors:**
- Verify API key is valid
- Check rate limits (429 errors)
- Ensure instance URL is correct (mail.revgenlabs.com)

**OpenAI errors:**
- Verify API key per agent
- Check quota and billing
- Monitor rate limits

## Next Steps

1. ✅ Run `supabase-schema.sql` in Supabase SQL Editor
2. ✅ Install dependencies with `npm install`
3. ⏳ Implement API routes
4. ⏳ Build UI components
5. ⏳ Set up cron job for follow-ups
6. ⏳ Test end-to-end workflow
7. ⏳ Deploy to Vercel

## Support

For issues or questions:
- Check the code comments for implementation details
- Review the plan file at `.claude/plans/calm-hopping-simon.md`
- Refer to API documentation:
  - [EmailBison API](https://mail.revgenlabs.com/api/reference)
  - [OpenAI API](https://platform.openai.com/docs)
  - [Supabase Docs](https://supabase.com/docs)

## License

Proprietary - All rights reserved
