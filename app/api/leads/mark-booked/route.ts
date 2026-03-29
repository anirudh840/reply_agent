import { NextRequest, NextResponse } from 'next/server';
import { getInterestedLead, getAgent, createMeetingBooked, updateInterestedLead } from '@/lib/supabase/queries';
import { sendMeetingBookedNotification } from '@/lib/integrations/slack';

/**
 * POST /api/leads/mark-booked
 * Manually mark a lead as having a meeting booked
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead_id } = body;

    if (!lead_id) {
      return NextResponse.json(
        { success: false, error: 'lead_id is required' },
        { status: 400 }
      );
    }

    const lead = await getInterestedLead(lead_id);
    if (!lead) {
      return NextResponse.json(
        { success: false, error: 'Lead not found' },
        { status: 404 }
      );
    }

    const agent = await getAgent(lead.agent_id);

    // Record the meeting
    const meeting = await createMeetingBooked({
      agent_id: lead.agent_id,
      lead_id: lead.id,
      lead_email: lead.lead_email,
      lead_name: lead.lead_name,
      booking_platform: agent.booking_platform || 'manual',
      booked_at: new Date().toISOString(),
    });

    // Stop followups and mark lead as completed
    try {
      const updatedThread = [
        ...lead.conversation_thread,
        {
          role: 'agent' as const,
          content: `[Meeting Booked] Manually marked as booked`,
          timestamp: new Date().toISOString(),
        },
      ];

      await updateInterestedLead(lead.id, {
        conversation_thread: updatedThread,
        conversation_status: 'completed',
        next_followup_due_at: null,
      });
    } catch (updateError) {
      console.warn('[MarkBooked] Failed to update lead status:', updateError);
    }

    // Send Slack notification
    if (agent.slack_webhook_url) {
      try {
        const appUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        await sendMeetingBookedNotification(agent.slack_webhook_url, {
          leadName: lead.lead_name,
          leadEmail: lead.lead_email,
          agentName: agent.name,
          inboxUrl: `${appUrl}/inbox`,
        });
      } catch (slackError) {
        console.warn('[MarkBooked] Failed to send Slack notification:', slackError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Meeting marked as booked',
      data: meeting,
    });
  } catch (error: any) {
    console.error('Error marking meeting as booked:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to mark as booked' },
      { status: 500 }
    );
  }
}
