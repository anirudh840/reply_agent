/**
 * Email Thread Parser
 * Extracts individual messages from email threads with quoted replies.
 *
 * Supports:
 * - Gmail:   "On Mon, Jan 1, 2024 at 10:00 AM Person <email> wrote:"
 * - Outlook: "---- On Thu, 12 Feb 2026 14:39:18 -0600 email wrote ----"
 * - Outlook: "From: Person <email>\nSent: ..."
 * - Generic: "----  Original Message  ----"
 * - Quote markers: lines starting with "> "
 */

export interface ParsedMessage {
  content: string;
  from?: string;
  date?: string;
  isQuoted: boolean;
}

// All quote-header patterns we recognise.
// Order matters: we try from top to bottom and use the FIRST match.
const QUOTE_PATTERNS = [
  // Outlook webmail style: " ---- On Thu, 12 Feb 2026 14:39:18 -0600  email  wrote ----"
  {
    regex: /\n\s*-{2,}\s*On\s+.+?\s+wrote\s*-{2,}\s*\n/i,
    extractMeta(header: string) {
      const dateMatch = header.match(/On\s+(.+?)\s{2,}/i);
      const writerMatch = header.match(/\s{2,}(\S+@\S+)\s+wrote/i);
      return {
        from: writerMatch?.[1]?.trim(),
        date: dateMatch?.[1]?.trim(),
      };
    },
  },
  // Gmail style: "On Fri, Aug 2, 2024 at 2:08 AM Cody <cody@example.com> wrote:"
  {
    regex: /\n\s*On\s+.+?\s+wrote:\s*\n/i,
    extractMeta(header: string) {
      // Extract email from angle brackets
      const emailAngle = header.match(/<([^>]+@[^>]+)>/);
      // Try "Name <email>" pattern - capture everything between the time and the <email>
      // Strip leading AM/PM artifacts
      let fromName: string | undefined;
      if (emailAngle) {
        const beforeEmail = header.substring(0, header.indexOf('<' + emailAngle[1]));
        // Take the last word(s) after time components (AM/PM/digits)
        // The regex strips AM, PM, and time digits from the front
        const nameMatch = beforeEmail.match(
          /(?:AM|PM|am|pm)\s+([A-Za-z][A-Za-z\s.'-]+?)\s*$/
        );
        if (nameMatch) {
          fromName = nameMatch[1].trim();
        } else {
          // Fallback: just grab what's right before the <
          const fallback = beforeEmail.match(/([A-Za-z][A-Za-z\s.'-]+?)\s*$/);
          if (fallback) {
            // Clean up: strip leading AM/PM if present
            fromName = fallback[1].replace(/^(AM|PM|am|pm)\s+/i, '').trim();
          }
        }
      }
      // Fallback: bare email wrote
      const writerBare = !fromName
        ? header.match(/\s(\S+@\S+)\s+wrote/i)
        : null;

      const dateMatch = header.match(
        /On\s+([\w,]+\s+[\w]+\s+\d+,?\s+\d{4})\s+at\s+([\d:]+\s*[APap][Mm]?)/i
      ) || header.match(/On\s+(.+?)\s+at\s+([\d:]+)/i);

      return {
        from: fromName
          || (writerBare ? writerBare[1].trim() : undefined)
          || (emailAngle ? emailAngle[1] : undefined),
        date: dateMatch ? `${dateMatch[1]} at ${dateMatch[2]}` : undefined,
      };
    },
  },
  // Outlook desktop: "From: …\nSent: …"
  {
    regex: /\n\s*From:\s*.+?\n\s*Sent:\s*.+?\n/i,
    extractMeta(header: string) {
      const fromMatch = header.match(/From:\s*(.+?)(?:\n|$)/i);
      const sentMatch = header.match(/Sent:\s*(.+?)(?:\n|$)/i);
      return {
        from: fromMatch?.[1]?.trim(),
        date: sentMatch?.[1]?.trim(),
      };
    },
  },
  // Generic separator: "---- Original Message ----" or plain "----"
  {
    regex: /\n\s*-{4,}\s*(Original Message)?\s*-{4,}\s*\n/i,
    extractMeta() {
      return { from: undefined, date: undefined };
    },
  },
];

/**
 * Parse an email body and split it into separate messages.
 *
 * Returns an array where index 0 is the newest (actual) reply and
 * subsequent entries are older quoted messages.
 */
export function parseEmailThread(
  textBody: string,
  _htmlBody?: string
): ParsedMessage[] {
  if (!textBody || !textBody.trim()) return [];

  // Normalise line endings
  let text = textBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Replace non-breaking / narrow spaces that email clients inject
  text = text.replace(/[\u00A0\u202F]/g, ' ');

  const messages: ParsedMessage[] = [];

  // Try each quote pattern
  for (const pattern of QUOTE_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match && match.index !== undefined) {
      const before = text.substring(0, match.index).trim();
      const after = text.substring(match.index + match[0].length).trim();
      const meta = pattern.extractMeta(match[0]);

      // The part before the quote header is the newest reply
      if (before) {
        messages.push({
          content: cleanMessageContent(before),
          isQuoted: false,
        });
      }

      // The part after the quote header is the quoted (older) message.
      // It may itself contain another quote header – recurse.
      if (after) {
        const quotedContent = stripQuoteMarkers(after);
        const nested = parseEmailThread(quotedContent);

        if (nested.length > 0) {
          // Tag the first nested message with metadata from the header
          nested[0] = {
            ...nested[0],
            from: nested[0].from || meta.from,
            date: nested[0].date || meta.date,
            isQuoted: true,
          };
          // All nested messages are quoted
          messages.push(
            ...nested.map((m) => ({ ...m, isQuoted: true }))
          );
        } else {
          messages.push({
            content: cleanMessageContent(quotedContent),
            from: meta.from,
            date: meta.date,
            isQuoted: true,
          });
        }
      }

      return messages.filter((m) => m.content.length > 0);
    }
  }

  // No quote header found – check for lines starting with "> "
  const lines = text.split('\n');
  const hasQuoteMarkers = lines.some((l) => /^>\s/.test(l));

  if (hasQuoteMarkers) {
    const replyLines: string[] = [];
    const quotedLines: string[] = [];
    let inQuoted = false;

    for (const line of lines) {
      if (/^>\s?/.test(line)) {
        inQuoted = true;
        quotedLines.push(line.replace(/^>\s?/, ''));
      } else if (inQuoted) {
        quotedLines.push(line);
      } else {
        replyLines.push(line);
      }
    }

    const reply = replyLines.join('\n').trim();
    const quoted = quotedLines.join('\n').trim();

    if (reply) {
      messages.push({ content: cleanMessageContent(reply), isQuoted: false });
    }
    if (quoted) {
      messages.push({
        content: cleanMessageContent(quoted),
        isQuoted: true,
      });
    }

    return messages.filter((m) => m.content.length > 0);
  }

  // No quoting detected – return as a single message
  const cleaned = cleanMessageContent(text);
  if (cleaned) {
    messages.push({ content: cleaned, isQuoted: false });
  }

  return messages;
}

// ---- helpers ----

/** Remove leading "> " markers from all lines */
function stripQuoteMarkers(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n');
}

/** Remove unsubscribe footers, bare URLs, and excessive whitespace */
function cleanMessageContent(text: string): string {
  let cleaned = text;

  // Remove "To unsubscribe …" and everything after
  cleaned = cleaned.replace(/To unsubscribe[^\n]*(\n.*)*$/i, '').trim();

  // Remove bare tracking URLs like <https://trial.sasmail.io/…>
  cleaned = cleaned.replace(/<https?:\/\/[^>]+>/g, '').trim();

  // Collapse multiple blank lines into one
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

/**
 * Extract plain text from HTML email.
 */
export function extractTextFromHtml(html: string): string {
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/**
 * Clean email body by removing signatures, disclaimers, and footers.
 */
export function cleanEmailBody(body: string): string {
  const signaturePatterns = [
    /--\s*$/m,
    /_{3,}$/m,
    /Sent from my/i,
    /Get Outlook for/i,
    /To unsubscribe/i,
  ];

  let cleaned = body;

  for (const pattern of signaturePatterns) {
    const match = cleaned.match(pattern);
    if (match && match.index !== undefined) {
      if (match.index / cleaned.length > 0.7) {
        cleaned = cleaned.substring(0, match.index).trim();
        break;
      }
    }
  }

  return cleaned;
}

/**
 * Detect if an email is an automated reply.
 */
export function isAutomatedReply(body: string, subject?: string): boolean {
  const patterns = [
    /out of (the )?office/i,
    /automatic reply/i,
    /auto(-|\s)?reply/i,
    /vacation response/i,
    /away from (my )?desk/i,
    /currently unavailable/i,
  ];

  const fullText = `${subject || ''} ${body}`;
  return patterns.some((p) => p.test(fullText));
}
