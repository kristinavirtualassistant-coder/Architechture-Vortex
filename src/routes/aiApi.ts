/**
 * Vortex One AI Intelligence API Routes
 * Endpoints for multi-turn chat, Search Grounding, Maps Grounding, and Copilot Insights.
 */

import { Router, Request, Response } from 'express';
import { generateGeminiChat, GeminiChatOptions } from '../services/geminiService.js';

export const aiApiRouter = Router();

// Multi-turn Chat / Grounded Query
aiApiRouter.post('/chat', async (req: Request, res: Response) => {
  try {
    const {
      messages,
      model,
      systemInstruction,
      useSearchGrounding,
      useMapsGrounding,
      currentContext,
    } = req.body as GeminiChatOptions;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({
        error: 'messages array is required',
        code: 'INVALID_INPUT',
      });
      return;
    }

    const result = await generateGeminiChat({
      messages,
      model,
      systemInstruction,
      useSearchGrounding: Boolean(useSearchGrounding),
      useMapsGrounding: Boolean(useMapsGrounding),
      currentContext,
    });

    res.json(result);
  } catch (err: any) {
    console.error('AI chat endpoint error:', err);
    res.status(500).json({
      error: err?.message || 'Internal AI service error',
      code: 'AI_SERVICE_ERROR',
    });
  }
});

// Quick Objection Handling / Call Script Helper
aiApiRouter.post('/script-suggestion', async (req: Request, res: Response) => {
  try {
    const { objection, context } = req.body;
    const prompt = `Generate a concise 2-sentence conversational response for a real estate acquisition agent facing this objection: "${objection || 'Not interested in selling'}". Property: ${context?.propertyAddress || 'Subject property'}, Owner: ${context?.contactName || 'Owner'}.`;

    const result = await generateGeminiChat({
      model: 'gemini-3.1-flash-lite',
      systemInstruction: 'You are an expert real estate phone sales coach. Return strictly the spoken script and one tactical follow-up question.',
      messages: [{ role: 'user', content: prompt }],
      currentContext: context,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      error: err?.message || 'Script suggestion failed',
      code: 'AI_SERVICE_ERROR',
    });
  }
});
