/**
 * Vortex One AI Intelligence Service
 * Server-side Gemini API integration powered by @google/genai SDK.
 */

import { GoogleGenAI } from '@google/genai';

// Initialize server-side Gemini client with aistudio-build User-Agent header
export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not configured in the environment. AI calls may fail.');
  }

  return new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface GroundingSource {
  title?: string;
  url?: string;
  sourceType: 'web' | 'map';
}

export interface ChatMessage {
  role: 'user' | 'model' | 'assistant';
  content: string;
}

export interface GeminiChatOptions {
  model?: 'gemini-3.5-flash' | 'gemini-3.1-pro-preview' | 'gemini-3.1-flash-lite';
  systemInstruction?: string;
  useSearchGrounding?: boolean;
  useMapsGrounding?: boolean;
  messages: ChatMessage[];
  currentContext?: {
    contactName?: string;
    phone?: string;
    propertyAddress?: string;
    apn?: string;
    county?: string;
    callState?: string;
  };
}

export interface GeminiChatResponse {
  text: string;
  groundingSources: GroundingSource[];
  searchQueries?: string[];
  modelUsed: string;
}

/**
 * Execute a multi-turn chat generation with optional Search or Maps grounding
 */
export async function generateGeminiChat(
  options: GeminiChatOptions
): Promise<GeminiChatResponse> {
  const ai = getGeminiClient();
  const selectedModel = options.model || 'gemini-3.5-flash';

  // Construct system prompt with role and optional property context
  let systemInstruction = options.systemInstruction ||
    'You are Vortex One Intelligence Copilot, an elite commercial real estate acquisition and property-owner intelligence AI assistant.';

  if (options.currentContext) {
    const ctx = options.currentContext;
    systemInstruction += `\n\nActive Telephony & Property Context:
- Property Address: ${ctx.propertyAddress || 'Not specified'}
- APN: ${ctx.apn || 'Unknown'}
- County: ${ctx.county || 'Orange County, CA (FIPS 06059)'}
- Contact / Owner: ${ctx.contactName || 'Unknown'} (${ctx.phone || 'N/A'})
- Call State: ${ctx.callState || 'IDLE'}
Use this context to provide hyper-targeted, verified owner intelligence, cold call talking points, and negotiation strategy.`;
  }

  // Format contents for multi-turn history
  const contents = options.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : m.role,
    parts: [{ text: m.content }],
  }));

  // Build tools configuration for grounding
  const tools: any[] = [];
  if (options.useSearchGrounding && selectedModel === 'gemini-3.5-flash') {
    tools.push({ googleSearch: {} });
  } else if (options.useMapsGrounding && selectedModel === 'gemini-3.5-flash') {
    tools.push({ googleMaps: {} });
  }

  const config: any = {
    systemInstruction,
  };

  if (tools.length > 0) {
    config.tools = tools;
  }

  try {
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents,
      config,
    });

    const text = response.text || '';
    const groundingSources: GroundingSource[] = [];
    const searchQueries: string[] = [];

    // Extract Google Search / Maps Grounding Metadata
    const candidate = response.candidates?.[0];
    const groundingMetadata = candidate?.groundingMetadata;

    if (groundingMetadata?.groundingChunks) {
      for (const chunk of groundingMetadata.groundingChunks) {
        if ((chunk as any).web) {
          groundingSources.push({
            title: (chunk as any).web.title || 'Web Search Citation',
            url: (chunk as any).web.uri,
            sourceType: 'web',
          });
        }
        if ((chunk as any).maps) {
          groundingSources.push({
            title: (chunk as any).maps.title || 'Google Maps Place',
            url: (chunk as any).maps.uri,
            sourceType: 'map',
          });
        }
      }
    }

    if (groundingMetadata?.webSearchQueries) {
      searchQueries.push(...groundingMetadata.webSearchQueries);
    }

    return {
      text,
      groundingSources,
      searchQueries,
      modelUsed: selectedModel,
    };
  } catch (err: any) {
    console.error('Error generating Gemini response:', err);
    throw new Error(err?.message || 'Failed to generate response from Gemini API');
  }
}
