import { NextRequest, NextResponse } from 'next/server';
import { getAgent, updateAgent, deleteAgent } from '@/lib/supabase/queries';
import { generateKnowledgeBaseEmbeddings } from '@/lib/openai/embeddings';

/**
 * GET /api/agents/[id]
 * Get a specific agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = await getAgent(id);

    return NextResponse.json({
      success: true,
      data: agent,
    });
  } catch (error: any) {
    console.error('Error fetching agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch agent',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/agents/[id]
 * Update an agent
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Update agent
    const agent = await updateAgent(id, body);

    // If knowledge base was updated, regenerate embeddings
    if (body.knowledge_base || body.objection_handling || body.case_studies) {
      generateKnowledgeBaseEmbeddings(agent).catch((error) => {
        console.error('Error regenerating embeddings:', error);
      });
    }

    return NextResponse.json({
      success: true,
      data: agent,
      message: 'Agent updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to update agent',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents/[id]
 * Delete an agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteAgent(id);

    return NextResponse.json({
      success: true,
      message: 'Agent deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to delete agent',
      },
      { status: 500 }
    );
  }
}
