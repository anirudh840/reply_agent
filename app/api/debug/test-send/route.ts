import { NextResponse } from 'next/server';

/**
 * GET /api/debug/test-send
 * DISABLED — This debug endpoint could send real emails without authentication
 * or workspace isolation. It has been disabled to prevent accidental sends.
 */
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'This debug endpoint has been permanently disabled for safety. '
        + 'Use the inbox UI to send responses.',
    },
    { status: 410 }
  );
}
