import { NextRequest, NextResponse } from 'next/server';
import { createEmailBisonClient } from '@/lib/emailbison/client';
import { generateResponse } from '@/lib/openai/generator';
import type { Agent } from '@/lib/types';

/**
 * POST /api/test-responses
 * Fetch sample interested replies and generate test responses
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailbison_api_key, openai_api_key, knowledge_base } = body;

    if (!emailbison_api_key || !openai_api_key) {
      return NextResponse.json(
        {
          success: false,
          error: 'emailbison_api_key and openai_api_key are required',
        },
        { status: 400 }
      );
    }

    // Create EmailBison client
    const emailbisonClient = createEmailBisonClient(emailbison_api_key);

    // Collect logs to return to client
    const logs: string[] = [];

    // Fetch interested replies with multiple fallback strategies
    let sampleReplies: any[] = [];
    let fetchError: string | null = null;

    // Strategy 1: Try fetching interested replies from campaigns
    try {
      logs.push('[Strategy 1] Attempting to fetch interested replies from campaigns...');
      console.log('[Test Responses] Attempting to fetch interested replies...');

      const result = await emailbisonClient.getReplies({
        status: 'interested',
        limit: 20,
      });

      logs.push(`[Strategy 1] Received ${result.data.length} interested replies from EmailBison`);
      console.log('[Test Responses] Received', result.data.length, 'interested replies from EmailBison');

      // Filter out replies with empty bodies
      sampleReplies = result.data.filter(
        (reply) => reply.body && reply.body.trim() !== ''
      );

      logs.push(`[Strategy 1] After filtering empty bodies: ${sampleReplies.length} replies`);
      console.log('[Test Responses] After filtering empty bodies:', sampleReplies.length, 'replies');
    } catch (emailError: any) {
      logs.push(`[Strategy 1] Failed: ${emailError.message}`);
      console.error('[Test Responses] Strategy 1 failed:', emailError);
      fetchError = emailError.message;
    }

    // Strategy 2: If no interested replies, try fetching all non-automated replies
    if (sampleReplies.length === 0) {
      try {
        logs.push('[Strategy 2] Strategy 1 yielded no results. Trying all non-automated replies...');
        console.log('[Test Responses] Strategy 1 yielded no results. Trying all non-automated replies...');

        const result = await emailbisonClient.getReplies({ limit: 50 });

        logs.push(`[Strategy 2] Received ${result.data.length} total replies from EmailBison`);
        console.log('[Test Responses] Received', result.data.length, 'total replies from EmailBison');

        // Filter for non-automated replies with bodies
        sampleReplies = result.data.filter(
          (reply) =>
            !reply.is_automated &&
            reply.body &&
            reply.body.trim() !== ''
        );

        logs.push(`[Strategy 2] After filtering non-automated with bodies: ${sampleReplies.length} replies`);
        console.log('[Test Responses] After filtering non-automated with bodies:', sampleReplies.length, 'replies');
      } catch (emailError: any) {
        logs.push(`[Strategy 2] Failed: ${emailError.message}`);
        console.error('[Test Responses] Strategy 2 failed:', emailError);
        fetchError = emailError.message;
      }
    }

    // Strategy 3: If still no results, try fetching ANY replies with content
    if (sampleReplies.length === 0) {
      try {
        logs.push('[Strategy 3] Strategy 2 yielded no results. Trying any replies with content...');
        console.log('[Test Responses] Strategy 2 yielded no results. Trying any replies with content...');

        const result = await emailbisonClient.getReplies({ limit: 100 });

        logs.push(`[Strategy 3] Received ${result.data.length} total replies from EmailBison`);
        console.log('[Test Responses] Received', result.data.length, 'total replies from EmailBison');

        // Filter for any replies with bodies
        sampleReplies = result.data.filter(
          (reply) => reply.body && reply.body.trim() !== ''
        );

        logs.push(`[Strategy 3] After filtering for bodies: ${sampleReplies.length} replies`);
        console.log('[Test Responses] After filtering for bodies:', sampleReplies.length, 'replies');
      } catch (emailError: any) {
        logs.push(`[Strategy 3] Failed: ${emailError.message}`);
        console.error('[Test Responses] Strategy 3 failed:', emailError);
        fetchError = emailError.message;

        // All strategies failed - return error with logs
        return NextResponse.json(
          {
            success: false,
            error: `Failed to fetch replies from EmailBison: ${fetchError}. Please verify your API key and ensure you have replies in your workspace.`,
            details: emailError,
            logs,
          },
          { status: 400 }
        );
      }
    }

    // Take only first 5 for testing
    sampleReplies = sampleReplies.slice(0, 5);

    if (sampleReplies.length === 0) {
      logs.push('[Result] No replies with content found after all strategies');
      console.log('[Test Responses] No replies with content found after all strategies');
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No replies with content found in your EmailBison workspace. You can still create the agent and it will process replies when they arrive.',
        logs,
      });
    }

    logs.push(`[Result] Successfully found ${sampleReplies.length} sample replies for testing`);
    console.log('[Test Responses] Successfully found', sampleReplies.length, 'sample replies for testing');

    // Generate responses for each sample
    const testResults = [];

    // Create a complete agent object for testing
    const testAgent: Agent = {
      id: 'test-agent',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      name: 'Test Agent',
      mode: 'human_in_loop',
      timezone: 'UTC',
      emailbison_api_key,
      openai_api_key,
      knowledge_base: knowledge_base || {
        company_info: '',
        product_description: '',
        value_propositions: [],
      },
      objection_handling: {},
      case_studies: [],
      followup_sequence: {
        type: 'default',
        steps: [
          { delay_days: 1, type: 'value_driven' },
          { delay_days: 3, type: 'value_driven' },
          { delay_days: 10, type: 'close_up' },
        ],
      },
      learned_patterns: [],
      confidence_threshold: 6.0,
      is_active: true,
    };

    for (const reply of sampleReplies.slice(0, 5)) {
      try {
        // Skip replies with empty body
        if (!reply.body || reply.body.trim() === '') {
          testResults.push({
            reply: {
              id: reply.id,
              from_email: reply.from_email,
              from_name: reply.from_name,
              subject: reply.subject,
              body: reply.body,
            },
            generated_response: null,
            confidence_score: 0,
            error: 'Reply body is empty - cannot generate response',
          });
          continue;
        }

        const generatedResponse = await generateResponse({
          leadEmail: reply.from_email,
          leadName: reply.from_name,
          leadMessage: reply.body,
          agent: testAgent as Agent,
          conversationHistory: [],
        });

        testResults.push({
          reply: {
            id: reply.id,
            from_email: reply.from_email,
            from_name: reply.from_name,
            subject: reply.subject,
            body: reply.body,
          },
          generated_response: generatedResponse.content,
          confidence_score: generatedResponse.confidence_score,
          reasoning: generatedResponse.reasoning,
        });
      } catch (genError: any) {
        console.error(`Error generating response for ${reply.id}:`, genError);
        testResults.push({
          reply: {
            id: reply.id,
            from_email: reply.from_email,
            from_name: reply.from_name,
            subject: reply.subject,
            body: reply.body,
          },
          generated_response: null,
          confidence_score: 0,
          error: genError.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: testResults,
      message: `Generated test responses for ${testResults.length} sample replies`,
      logs,
    });
  } catch (error: any) {
    console.error('Error in test responses:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to generate test responses',
      },
      { status: 500 }
    );
  }
}
