import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/extract-website
 * Extract company information from a website URL using Perplexity AI
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json(
        {
          success: false,
          error: 'URL is required',
        },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid URL format. Please enter a valid website URL (e.g., https://example.com)',
        },
        { status: 400 }
      );
    }

    const perplexityApiKey = process.env.PERPLEXITY_API_KEY;

    if (!perplexityApiKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Perplexity API key not configured',
        },
        { status: 500 }
      );
    }

    // Use Perplexity AI to extract information from the website
    const extractionPrompt = `Analyze the website at ${url} and extract the following information:

1. Company Info: A brief 2-3 sentence description of what the company does and their mission
2. Product/Service Description: What products or services they offer (2-3 sentences)
3. Value Propositions: 3-5 key benefits, value propositions, or unique selling points

Please browse the website and provide accurate, factual information.

Return your response in this exact JSON format:
{
  "company_info": "string",
  "product_description": "string",
  "value_propositions": ["string", "string", "string"]
}

Only include factual information found on the website. Be concise and professional.`;

    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${perplexityApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar-pro',
          messages: [
            {
              role: 'system',
              content: 'You are a precise web research assistant. Extract factual information from websites and return valid JSON. Browse the web to find accurate information.',
            },
            {
              role: 'user',
              content: extractionPrompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Perplexity API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from Perplexity AI');
      }

      // Extract JSON from the response
      let extracted;
      try {
        // Try to parse as JSON directly
        extracted = JSON.parse(content);
      } catch {
        // If that fails, try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          extracted = JSON.parse(jsonMatch[1]);
        } else {
          // Try to find JSON object in the text
          const objectMatch = content.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            extracted = JSON.parse(objectMatch[0]);
          } else {
            throw new Error('Could not parse response as JSON');
          }
        }
      }

      // Validate the extracted data
      if (!extracted.company_info && !extracted.product_description) {
        throw new Error('Could not extract meaningful information from the website');
      }

      return NextResponse.json({
        success: true,
        data: {
          company_info: extracted.company_info || '',
          product_description: extracted.product_description || '',
          value_propositions: Array.isArray(extracted.value_propositions)
            ? extracted.value_propositions
            : [],
        },
        message: 'Information extracted successfully using Perplexity AI',
      });
    } catch (aiError: any) {
      console.error('Error extracting with Perplexity:', aiError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to extract information: ${aiError.message}`,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error in website extraction:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to extract website information',
      },
      { status: 500 }
    );
  }
}
