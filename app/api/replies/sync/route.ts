import { NextRequest, NextResponse } from 'next/server';
import { getAgent, updateAgent, createReply, getReplyByEmailBisonId, updateReply } from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import { categorizeReply } from '@/lib/openai/categorizer';
import type { Reply } from '@/lib/types';

/**
 * POST /api/replies/sync
 * Sync replies from the platform for a specific agent
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_id } = body;

    if (!agent_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'agent_id is required',
        },
        { status: 400 }
      );
    }

    // Get agent
    const agent = await getAgent(agent_id);

    if (!agent.is_active) {
      return NextResponse.json(
        {
          success: false,
          error: 'Agent is not active',
        },
        { status: 400 }
      );
    }

    // Create platform client
    const emailbisonClient = createClientForAgent(agent);

    // Fetch new replies since last sync
    const lastSyncDate = agent.last_sync_at ? new Date(agent.last_sync_at) : undefined;
    const newReplies = await emailbisonClient.fetchRepliesForProcessing(lastSyncDate);

    console.log(`Found ${newReplies.length} new replies for agent ${agent.name}`);

    const processedReplies: Reply[] = [];
    const errors: string[] = [];

    // Process each reply
    for (const emailbisonReply of newReplies) {
      try {
        // Check if reply already exists
        const existingReply = await getReplyByEmailBisonId(emailbisonReply.id);

        if (existingReply) {
          console.log(`Reply ${emailbisonReply.id} already exists, skipping...`);
          continue;
        }

        // Create reply in database
        const replyData: Omit<Reply, 'id' | 'created_at' | 'updated_at'> = {
          agent_id: agent.id,
          emailbison_reply_id: emailbisonReply.id,
          emailbison_campaign_id: emailbisonReply.campaign_id,
          lead_email: emailbisonReply.from_email,
          lead_name: emailbisonReply.from_name,
          lead_company: emailbisonReply.lead_data?.company,
          lead_metadata: emailbisonReply.lead_data || {},
          reply_subject: emailbisonReply.subject,
          reply_body: emailbisonReply.body,
          reply_html: emailbisonReply.html,
          received_at: emailbisonReply.received_at,
          original_status: emailbisonReply.status,
          is_automated_original: emailbisonReply.is_automated,
          is_tracked_original: emailbisonReply.is_tracked,
          processing_status: 'pending',
        };

        const reply = await createReply(replyData);

        // Categorize reply using AI (only if it's marked as interested or not automated)
        if (
          emailbisonReply.status === 'interested' ||
          !emailbisonReply.is_automated
        ) {
          try {
            const categorization = await categorizeReply({
              reply,
              openaiApiKey: agent.openai_api_key,
            });

            // Update reply with categorization results
            const updatedReply = await updateReply(reply.id, {
              corrected_status: categorization.corrected_status,
              is_truly_interested: categorization.is_truly_interested,
              ai_confidence_score: categorization.confidence_score,
              ai_reasoning: categorization.reasoning,
              processing_status: 'processed',
              processed_at: new Date().toISOString(),
            });

            processedReplies.push(updatedReply);
          } catch (categorizationError: any) {
            console.error(
              `Error categorizing reply ${reply.id}:`,
              categorizationError
            );

            // Mark as error but keep the reply
            await updateReply(reply.id, {
              processing_status: 'error',
              error_message: categorizationError.message,
            });

            errors.push(`Failed to categorize reply ${emailbisonReply.id}`);
          }
        } else {
          // Skip categorization for automated replies
          await updateReply(reply.id, {
            corrected_status: 'automated_reply',
            is_truly_interested: false,
            processing_status: 'skipped',
            processed_at: new Date().toISOString(),
          });
        }
      } catch (replyError: any) {
        console.error(
          `Error processing reply ${emailbisonReply.id}:`,
          replyError
        );
        errors.push(`Failed to process reply ${emailbisonReply.id}: ${replyError.message}`);
      }
    }

    // Update last sync timestamp
    await updateAgent(agent.id, {
      last_sync_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      data: {
        total_fetched: newReplies.length,
        processed: processedReplies.length,
        errors: errors.length,
        error_details: errors,
      },
      message: `Synced ${newReplies.length} replies, processed ${processedReplies.length}`,
    });
  } catch (error: any) {
    console.error('Error syncing replies:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to sync replies',
      },
      { status: 500 }
    );
  }
}
