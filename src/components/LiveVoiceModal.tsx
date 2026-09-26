/**
 * Vortex One Live Voice Agent Modal
 * Real-time voice conversation with gemini-3.1-flash-live-preview (Live API).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  X,
  Radio,
  Sparkles,
  Zap,
  Activity,
  AlertCircle,
  Headphones,
} from 'lucide-react';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeContact?: any;
}

interface TranscriptItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({
  isOpen,
  onClose,
  activeContact,
}) => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState<boolean>(false);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to connect');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const isMutedRef = useRef<boolean>(false);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  isMutedRef.current = isMicMuted;

  // Auto-scroll transcripts
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // Convert Float32 array (-1.0 to 1.0) to 16-bit PCM little-endian Base64
  const float32ToPcmBase64 = (float32Array: Float32Array): string => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Convert base64 16-bit PCM little-endian to 24kHz AudioBuffer and play gaplessly
  const playPcmChunk = (base64Audio: string) => {
    if (!outputAudioCtxRef.current) return;
    const ctx = outputAudioCtxRef.current;

    try {
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const dataView = new DataView(bytes.buffer);
      const numSamples = Math.floor(len / 2);
      const float32 = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        const int16 = dataView.getInt16(i * 2, true);
        float32[i] = int16 / 32768;
      }

      const audioBuffer = ctx.createBuffer(1, numSamples, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      // Schedule gapless playback
      const currentTime = ctx.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime;
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;

      activeSourcesRef.current.push(source);
      setIsAiSpeaking(true);

      source.onended = () => {
        const idx = activeSourcesRef.current.indexOf(source);
        if (idx > -1) activeSourcesRef.current.splice(idx, 1);
        if (activeSourcesRef.current.length === 0) {
          setIsAiSpeaking(false);
        }
      };
    } catch (e) {
      console.warn('Error decoding PCM audio chunk:', e);
    }
  };

  const stopAllAudioSources = () => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch (e) {}
    });
    activeSourcesRef.current = [];
    if (outputAudioCtxRef.current) {
      nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
    }
    setIsAiSpeaking(false);
  };

  const startVoiceSession = async () => {
    setErrorMessage(null);
    setStatusMessage('Connecting to Live Voice AI...');

    try {
      // 1. Initialize output AudioContext at 24kHz for playback
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      outputAudioCtxRef.current = new AudioCtx({ sampleRate: 24000 });
      if (outputAudioCtxRef.current.state === 'suspended') {
        await outputAudioCtxRef.current.resume();
      }

      // 2. Request user microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // 3. Initialize input AudioContext at 16kHz for mic capture
      inputAudioCtxRef.current = new AudioCtx({ sampleRate: 16000 });
      const source = inputAudioCtxRef.current.createMediaStreamSource(stream);
      const processor = inputAudioCtxRef.current.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // 4. Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/live-voice`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setStatusMessage('Voice channel live • Speak into microphone');

        // If context available, seed initial text prompt
        if (activeContact) {
          ws.send(
            JSON.stringify({
              type: 'TEXT',
              text: `Hello! I am preparing to call property contact ${activeContact.name} at phone ${activeContact.phone} for property in Orange County. What is your advice?`,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'AUDIO' && msg.audio) {
            playPcmChunk(msg.audio);
          } else if (msg.type === 'INTERRUPTED') {
            stopAllAudioSources();
          } else if (msg.type === 'TRANSCRIPT' && msg.text) {
            setTranscripts((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).substring(2, 9),
                role: msg.role === 'model' ? 'model' : 'user',
                text: msg.text,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              },
            ]);
          } else if (msg.type === 'STATUS') {
            setStatusMessage(`Live Voice Model: ${msg.model || 'gemini-3.1-flash-live-preview'}`);
          } else if (msg.type === 'ERROR') {
            setErrorMessage(msg.message);
          }
        } catch (e) {
          console.warn('Error parsing Live Voice WS message:', e);
        }
      };

      ws.onerror = () => {
        setErrorMessage('WebSocket connection failed to /live-voice');
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setStatusMessage('Voice session disconnected');
      };

      // 5. Stream mic audio to WebSocket
      processor.onaudioprocess = (e) => {
        if (isMutedRef.current) return;
        if (ws.readyState !== WebSocket.OPEN) return;

        const inputChannelData = e.inputBuffer.getChannelData(0);
        const base64Pcm = float32ToPcmBase64(inputChannelData);
        ws.send(
          JSON.stringify({
            type: 'AUDIO',
            audio: base64Pcm,
          })
        );
      };

      source.connect(processor);
      processor.connect(inputAudioCtxRef.current.destination);
    } catch (err: any) {
      console.error('Error starting live voice session:', err);
      setErrorMessage(err?.message || 'Microphone access denied or audio initialization failed.');
      setIsConnected(false);
    }
  };

  const endVoiceSession = () => {
    stopAllAudioSources();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsAiSpeaking(false);
    setStatusMessage('Session closed');
  };

  useEffect(() => {
    if (!isOpen) {
      endVoiceSession();
    }
    return () => {
      endVoiceSession();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-white text-base">Gemini Live Voice Conversation</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  gemini-3.1-flash-live-preview
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Low-latency bidirectional audio streaming over WebSocket (16kHz in • 24kHz out)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Audio Visualizer / Status Banner */}
        <div className="p-6 bg-slate-950/60 border-b border-slate-800/80 flex flex-col items-center justify-center space-y-4">
          <div className="relative flex items-center justify-center">
            {/* Pulsing visualizer rings */}
            {isConnected && (
              <div
                className={`absolute inset-0 rounded-full transition-all duration-300 ${
                  isAiSpeaking
                    ? 'animate-ping bg-indigo-500/20'
                    : !isMicMuted
                    ? 'animate-pulse bg-emerald-500/20'
                    : 'bg-transparent'
                }`}
                style={{ width: '120px', height: '120px', margin: '-10px' }}
              />
            )}

            <div
              className={`w-24 h-24 rounded-full flex flex-col items-center justify-center border-2 transition-all duration-300 z-10 shadow-lg ${
                !isConnected
                  ? 'bg-slate-800 border-slate-700 text-slate-400'
                  : isAiSpeaking
                  ? 'bg-indigo-600/30 border-indigo-400 text-indigo-300 shadow-indigo-500/30'
                  : isMicMuted
                  ? 'bg-amber-950/40 border-amber-500/60 text-amber-300'
                  : 'bg-emerald-950/40 border-emerald-400 text-emerald-300 shadow-emerald-500/20'
              }`}
            >
              {isAiSpeaking ? (
                <Volume2 className="w-8 h-8 animate-bounce" />
              ) : isMicMuted ? (
                <MicOff className="w-8 h-8" />
              ) : (
                <Mic className="w-8 h-8" />
              )}
              <span className="text-[10px] font-mono font-bold mt-1">
                {!isConnected
                  ? 'IDLE'
                  : isAiSpeaking
                  ? 'AI SPEAKING'
                  : isMicMuted
                  ? 'MUTED'
                  : 'LISTENING'}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? (isAiSpeaking ? 'bg-indigo-400 animate-ping' : 'bg-emerald-400 animate-pulse') : 'bg-slate-600'
              }`}
            />
            <span className="text-slate-300">{statusMessage}</span>
          </div>

          {errorMessage && (
            <div className="flex items-center space-x-2 px-3 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs font-mono max-w-md text-center">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Live Spoken Transcript Feed */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-[180px] max-h-[260px] bg-slate-900/50">
          <div className="text-[11px] font-mono text-slate-500 uppercase tracking-wider px-1">
            Spoken Transcript Stream:
          </div>
          {transcripts.length === 0 ? (
            <div className="h-32 flex flex-col items-center justify-center text-slate-500 text-xs font-mono space-y-2">
              <Activity className="w-5 h-5 text-slate-600" />
              <span>Start voice session and speak to see live transcripts...</span>
            </div>
          ) : (
            transcripts.map((t) => (
              <div
                key={t.id}
                className={`flex flex-col ${
                  t.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div className="flex items-center space-x-1.5 text-[10px] font-mono text-slate-500 mb-0.5 px-1">
                  <span>{t.role === 'user' ? '👤 Agent (You)' : '✨ Gemini Live AI'}</span>
                  <span>•</span>
                  <span>{t.timestamp}</span>
                </div>
                <div
                  className={`px-3.5 py-2 rounded-xl text-xs max-w-[85%] font-sans leading-relaxed ${
                    t.role === 'user'
                      ? 'bg-indigo-600/30 border border-indigo-500/40 text-indigo-100 rounded-tr-none'
                      : 'bg-slate-800 border border-slate-700/80 text-slate-200 rounded-tl-none'
                  }`}
                >
                  {t.text}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Modal Controls Bar */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3">
          {!isConnected ? (
            <button
              onClick={startVoiceSession}
              className="flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <Radio className="w-4 h-4 animate-pulse" />
              <span>Connect Live Voice Session</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => setIsMicMuted(!isMicMuted)}
                className={`flex items-center space-x-2 py-2.5 px-4 rounded-xl font-medium text-xs font-mono transition-colors border ${
                  isMicMuted
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                }`}
              >
                {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-400" />}
                <span>{isMicMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
              </button>

              <button
                onClick={endVoiceSession}
                className="flex items-center space-x-2 py-2.5 px-5 rounded-xl font-medium text-xs font-mono bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition-all cursor-pointer"
              >
                <Radio className="w-4 h-4" />
                <span>Disconnect Voice</span>
              </button>
            </>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono border border-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
