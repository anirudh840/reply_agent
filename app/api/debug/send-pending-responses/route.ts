import { NextResponse } from 'next/server';

/**
 * POST /api/debug/send-pending-responses
 * DISABLED — This endpoint was a one-time migration tool that could send emails
 * without authentication or workspace isolation. It has been disabled to prevent
 * accidental cross-workspace sends.
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'This debug endpoint has been permanently disabled for safety. '
        + 'Use the inbox UI to approve and send pending responses.',
    },
    { status: 410 }
  );
}
