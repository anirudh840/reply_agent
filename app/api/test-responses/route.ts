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

    // Fetch interested replies (fetch more to filter out empty ones)
    let sampleReplies;
    try {
      const result = await emailbisonClient.getReplies({
        status: 'interested',
        limit: 20, // Fetch more to filter out empty ones
      });

      // Filter out replies with empty bodies and take first 5
      sampleReplies = result.data
        .filter((reply) => reply.body && reply.body.trim() !== '')
        .slice(0, 5);
    } catch (emailError: any) {
      console.error('Error fetching EmailBison replies:', emailError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch replies from EmailBison. Please check your API key.',
        },
        { status: 400 }
      );
    }

    if (sampleReplies.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No interested replies with content found in your EmailBison workspace',
      });
    }

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
