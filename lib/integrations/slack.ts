export interface SlackNotificationPayload {
  leadName?: string;
  leadEmail: string;
  leadCompany?: string;
  leadMessage: string;
  categorization: {
    is_interested: boolean;
    confidence_score: number;
    reasoning: string;
  };
  responseAction: 'auto_responded' | 'needs_approval' | 'not_interested';
  agentName: string;
  inboxUrl: string;
  generatedResponse?: string;
}

function buildSlackBlocks(payload: SlackNotificationPayload): object[] {
  const statusEmoji =
    payload.responseAction === 'auto_responded'
      ? ':robot_face:'
      : payload.responseAction === 'needs_approval'
        ? ':raising_hand:'
        : ':no_entry_sign:';

  const statusText =
    payload.responseAction === 'auto_responded'
      ? 'Auto-Responded by AI'
      : payload.responseAction === 'needs_approval'
        ? 'Needs Manual Approval'
        : 'Not Interested';

  const blocks: object[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} New Interested Reply`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Lead:*\n${payload.leadName || 'Unknown'} (${payload.leadEmail})`,
        },
        {
          type: 'mrkdwn',
          text: `*Company:*\n${payload.leadCompany || 'N/A'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Agent:*\n${payload.agentName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Confidence:*\n${payload.categorization.confidence_score}/10`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Lead's Message:*\n>${payload.leadMessage.slice(0, 500).replace(/\n/g, '\n>')}${payload.leadMessage.length > 500 ? '...' : ''}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${statusEmoji} *Status:* ${statusText} | *AI Reasoning:* ${payload.categorization.reasoning.slice(0, 200)}`,
        },
      ],
    },
  ];

  if (payload.generatedResponse) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*AI Response:*\n${payload.generatedResponse.slice(0, 500)}${payload.generatedResponse.length > 500 ? '...' : ''}`,
      },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View in Inbox',
            emoji: true,
          },
          url: payload.inboxUrl,
          style: 'primary',
        },
      ],
    }
  );

  return blocks;
}

export async function sendSlackNotification(
  webhookUrl: string,
  payload: SlackNotificationPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const blocks = buildSlackBlocks(payload);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `New interested reply from ${payload.leadName || payload.leadEmail} (${payload.agentName})`,
        blocks,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Slack API error: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to send Slack notification' };
  }
}

export async function sendMeetingBookedNotification(
  webhookUrl: string,
  payload: {
    leadName?: string;
    leadEmail: string;
    agentName: string;
    meetingUrl?: string;
    inboxUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: ':calendar: Meeting Booked!',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Lead:*\n${payload.leadName || 'Unknown'} (${payload.leadEmail})`,
          },
          {
            type: 'mrkdwn',
            text: `*Agent:*\n${payload.agentName}`,
          },
        ],
      },
      ...(payload.meetingUrl
        ? [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Meeting Link:*\n${payload.meetingUrl}`,
            },
          }]
        : []),
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View in Inbox',
              emoji: true,
            },
            url: payload.inboxUrl,
            style: 'primary',
          },
        ],
      },
    ];

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:calendar: Meeting booked with ${payload.leadName || payload.leadEmail} (${payload.agentName})`,
        blocks,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Slack API error: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to send Slack notification' };
  }
}

export async function sendMeetingAutoDetectedNotification(
  webhookUrl: string,
  payload: {
    attendeeName?: string;
    attendeeEmail: string;
    eventName?: string;
    meetingTime?: string;
    platform: string;
    agentName: string;
    matchedLead?: { name?: string; email: string };
    inboxUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const matchText = payload.matchedLead
      ? `:white_check_mark: *Matched lead:* ${payload.matchedLead.name || payload.matchedLead.email}`
      : ':grey_question: No matching lead found in inbox';

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: ':calendar: Meeting Auto-Detected!',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Attendee:*\n${payload.attendeeName || 'Unknown'} (${payload.attendeeEmail})`,
          },
          {
            type: 'mrkdwn',
            text: `*Agent:*\n${payload.agentName}`,
          },
          {
            type: 'mrkdwn',
            text: `*Platform:*\n${payload.platform === 'cal_com' ? 'Cal.com' : 'Calendly'}`,
          },
          ...(payload.meetingTime
            ? [{ type: 'mrkdwn' as const, text: `*Time:*\n${payload.meetingTime}` }]
            : []),
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: matchText,
          },
        ],
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View in Inbox',
              emoji: true,
            },
            url: payload.inboxUrl,
            style: 'primary',
          },
        ],
      },
    ];

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:calendar: Meeting auto-detected: ${payload.attendeeName || payload.attendeeEmail} via ${payload.platform} (${payload.agentName})`,
        blocks,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Slack API error: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to send Slack notification' };
  }
}

export async function testSlackWebhook(
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: ':white_check_mark: Reply Agent connected successfully! You will receive notifications here when interested leads reply.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: ':white_check_mark: *Reply Agent Connected!*\nYou will receive notifications in this channel when interested leads reply to your campaigns.',
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Invalid webhook URL: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to connect to Slack' };
  }
}
