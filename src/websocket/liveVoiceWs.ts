/**
 * Vortex One Live Voice WebSocket Gateway
 * Bridges low-latency real-time voice streaming with gemini-3.1-flash-live-preview.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { getGeminiClient } from '../services/geminiService.js';

export class LiveVoiceWsGateway {
  private wss: WebSocketServer | null = null;

  public initialize(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/live-voice' });

    this.wss.on('connection', async (clientWs: WebSocket) => {
      console.log('🎙️ New Live Voice client connected');
      let liveSession: any = null;

      try {
        const ai = getGeminiClient();

        liveSession = await ai.live.connect({
          model: 'gemini-3.1-flash-live-preview',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Zephyr' },
              },
            },
            systemInstruction:
              'You are the Vortex One Live Real Estate Acquisition & Telephony Voice Copilot. You speak concisely, professionally, and naturally. You assist the agent in real time with cold call objection handling, property valuation insights, owner negotiation tactics, and live mock roleplay.',
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              if (clientWs.readyState !== WebSocket.OPEN) return;

              // 1. Audio stream from Gemini
              const parts = message.serverContent?.modelTurn?.parts;
              if (parts && parts.length > 0) {
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    clientWs.send(
                      JSON.stringify({
                        type: 'AUDIO',
                        audio: part.inlineData.data,
                      })
                    );
                  }
                }
              }

              // 2. Interruption event
              if (message.serverContent?.interrupted) {
                clientWs.send(
                  JSON.stringify({
                    type: 'INTERRUPTED',
                  })
                );
              }

              // 3. Output Transcript (Gemini speech text)
              const outputTranscription = (message.serverContent?.modelTurn as any)?.outputTranscription;
              if (outputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({
                    type: 'TRANSCRIPT',
                    role: 'model',
                    text: outputTranscription.text,
                  })
                );
              }

              // 4. Input Transcript (User speech text)
              const inputTranscription = (message.serverContent as any)?.inputAudioTranscription;
              if (inputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({
                    type: 'TRANSCRIPT',
                    role: 'user',
                    text: inputTranscription.text,
                  })
                );
              }
            },
            onclose: () => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'STATUS', status: 'closed' }));
              }
            },
            onerror: (err: any) => {
              console.error('Live API Session error:', err);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(
                  JSON.stringify({
                    type: 'ERROR',
                    message: err?.message || 'Live session encountered an error',
                  })
                );
              }
            },
          },
        });

        clientWs.send(
          JSON.stringify({
            type: 'STATUS',
            status: 'connected',
            model: 'gemini-3.1-flash-live-preview',
          })
        );
      } catch (err: any) {
        console.error('Failed to establish Live API session:', err);
        clientWs.send(
          JSON.stringify({
            type: 'ERROR',
            message: err?.message || 'Failed to initialize Gemini Live Voice session',
          })
        );
        return;
      }

      // Handle audio stream messages from browser
      clientWs.on('message', (rawData: string | Buffer) => {
        try {
          const parsed = JSON.parse(rawData.toString());

          if (parsed.type === 'AUDIO' && parsed.audio && liveSession) {
            liveSession.sendRealtimeInput({
              audio: {
                data: parsed.audio,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } else if (parsed.type === 'TEXT' && parsed.text && liveSession) {
            liveSession.sendRealtimeInput({
              text: parsed.text,
            });
          }
        } catch (e) {
          // Ignore invalid frames
        }
      });

      clientWs.on('close', () => {
        console.log('🎙️ Live Voice client disconnected');
        if (liveSession) {
          try {
            liveSession.close();
          } catch (e) {}
        }
      });

      clientWs.on('error', (err) => {
        console.error('Live Voice WebSocket error:', err);
        if (liveSession) {
          try {
            liveSession.close();
          } catch (e) {}
        }
      });
    });
  }

  public close(): void {
    if (this.wss) {
      this.wss.close();
    }
  }
}

export const liveVoiceGateway = new LiveVoiceWsGateway();
