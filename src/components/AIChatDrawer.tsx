/**
 * Vortex One Gemini AI Copilot & Chat Drawer
 * Features:
 * - Multi-turn conversational history with role specialization
 * - Model selector: gemini-3.5-flash, gemini-3.1-pro-preview, gemini-3.1-flash-lite
 * - Google Search Grounding toggle (with live citations)
 * - Google Maps Grounding toggle (with place cards & map links)
 * - Cloud synchronization with Firebase Firestore
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Search,
  MapPin,
  Bot,
  User,
  Send,
  Trash2,
  ExternalLink,
  ChevronDown,
  CloudUpload,
  Layers,
  Zap,
  Cpu,
  RefreshCw,
  Building2,
  X,
  PhoneCall,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export interface AIChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeContact?: any;
  activeCall?: any;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  groundingSources?: Array<{ title?: string; url?: string; sourceType: 'web' | 'map' }>;
  searchQueries?: string[];
  modelUsed?: string;
}

const AI_ROLES = [
  {
    id: 'property_analyst',
    name: 'Property & Owner Analyst',
    icon: '🏢',
    defaultModel: 'gemini-3.5-flash',
    instruction:
      'You are Vortex One Lead Intelligence Specialist. Provide authoritative property, parcel, assessed value, owner entity structure, and county public records intelligence.',
  },
  {
    id: 'acquisition_copilot',
    name: 'Acquisition & Negotiation Copilot',
    icon: '🎯',
    defaultModel: 'gemini-3.5-flash',
    instruction:
      'You are an elite Commercial Real Estate Acquisition Negotiator. Provide high-conversion cold call scripts, creative financing frameworks (seller carryback, sub-to, master lease), and objection rebuttals.',
  },
  {
    id: 'zoning_gis',
    name: 'Zoning & GIS Specialist',
    icon: '🗺️',
    defaultModel: 'gemini-3.5-flash',
    instruction:
      'You are an expert GIS and urban planning advisor. Analyze parcel boundaries, zoning codes, density allowances, commercial corridors, and neighborhood amenities.',
  },
  {
    id: 'speed_coach',
    name: 'Rapid Script Coach',
    icon: '⚡',
    defaultModel: 'gemini-3.1-flash-lite',
    instruction:
      'You are an ultra-fast cold call objection handling coach. Return 1 to 2 sharp, conversational sentences directly addressing objections in real time.',
  },
  {
    id: 'deep_underwriting',
    name: 'Deep Underwriting & Legal Analyst',
    icon: '🧠',
    defaultModel: 'gemini-3.1-pro-preview',
    instruction:
      'You are a senior real estate private equity analyst and legal researcher. Perform complex cap rate analysis, NOI forecasting, tax assessment appeals, and title entity discovery.',
  },
];

export const AIChatDrawer: React.FC<AIChatDrawerProps> = ({
  isOpen,
  onClose,
  activeContact,
  activeCall,
}) => {
  const { user, saveChatToCloud } = useAuth();
  const [selectedRole, setSelectedRole] = useState(AI_ROLES[0]);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash');
  const [useSearchGrounding, setUseSearchGrounding] = useState<boolean>(true);
  const [useMapsGrounding, setUseMapsGrounding] = useState<boolean>(false);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [cloudSaved, setCloudSaved] = useState<boolean>(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome_1',
      role: 'model',
      content:
        '👋 Welcome to **Vortex One AI Copilot**. I am connected with live Google Search & Maps Grounding. How can I assist with property owner intelligence or cold call strategy today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelUsed: 'gemini-3.5-flash',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleRoleChange = (role: (typeof AI_ROLES)[0]) => {
    setSelectedRole(role);
    setSelectedModel(role.defaultModel);
    if (role.id === 'zoning_gis') {
      setUseMapsGrounding(true);
      setUseSearchGrounding(false);
    } else {
      setUseMapsGrounding(false);
      setUseSearchGrounding(true);
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || inputQuery).trim();
    if (!textToSend || loading) return;

    const userMessage: Message = {
      id: Math.random().toString(36).substring(2, 9),
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputQuery('');
    setLoading(true);

    try {
      // Build conversation payload
      const chatHistory = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const contextData = activeContact
        ? {
            contactName: activeContact.name,
            phone: activeContact.phone,
            propertyAddress: activeContact.metadata?.property_address || activeContact.metadata?.address || '1840 S Grand Ave, Santa Ana, CA',
            apn: activeContact.metadata?.apn || '580-081-01',
            county: 'Orange County, CA (FIPS 06059)',
            callState: activeCall?.state || 'IDLE',
          }
        : undefined;

      const res = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          model: selectedModel,
          systemInstruction: selectedRole.instruction,
          useSearchGrounding: selectedModel === 'gemini-3.5-flash' && useSearchGrounding,
          useMapsGrounding: selectedModel === 'gemini-3.5-flash' && useMapsGrounding,
          currentContext: contextData,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to receive AI response');
      }

      const botMessage: Message = {
        id: Math.random().toString(36).substring(2, 9),
        role: 'model',
        content: data.text || 'No response returned from model.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        groundingSources: data.groundingSources || [],
        searchQueries: data.searchQueries || [],
        modelUsed: data.modelUsed || selectedModel,
      };

      const updatedList = [...newMessages, botMessage];
      setMessages(updatedList);

      // Auto-sync to Firestore if user authenticated
      if (user) {
        saveChatToCloud({
          title: `Chat with ${selectedRole.name}`,
          role: selectedRole.id,
          model: selectedModel,
          messages: updatedList,
        });
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      const errorMessage: Message = {
        id: Math.random().toString(36).substring(2, 9),
        role: 'model',
        content: `⚠️ **Error**: ${err?.message || 'Could not reach Gemini service. Please verify server connection.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: selectedModel,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleCloudSaveChat = async () => {
    if (!user) return;
    try {
      await saveChatToCloud({
        title: `Chat with ${selectedRole.name}`,
        role: selectedRole.id,
        model: selectedModel,
        messages,
      });
      setCloudSaved(true);
      setTimeout(() => setCloudSaved(false), 3000);
    } catch (err) {
      console.error('Cloud save failed:', err);
    }
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: 'welcome_reset',
        role: 'model',
        content: `Conversation reset. Ready for queries as **${selectedRole.name}**.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: selectedModel,
      },
    ]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-slate-900 border-l border-slate-700/80 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-bold text-white text-sm">Gemini AI Copilot & Chatbot</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Multi-Turn
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Powered by Google Search & Google Maps Grounding
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-1.5">
          {user && (
            <button
              onClick={handleCloudSaveChat}
              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
              title="Save Conversation to Firestore Cloud"
            >
              {cloudSaved ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <CloudUpload className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={handleClearHistory}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            title="Clear Chat History"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Role & Model Controls Panel */}
      <div className="p-3 bg-slate-950/80 border-b border-slate-800 space-y-2.5">
        {/* Role Selector Chips */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
          {AI_ROLES.map((r) => (
            <button
              key={r.id}
              onClick={() => handleRoleChange(r)}
              className={`px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all flex items-center space-x-1.5 border cursor-pointer ${
                selectedRole.id === r.id
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/20'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>{r.icon}</span>
              <span>{r.name}</span>
            </button>
          ))}
        </div>

        {/* Model & Grounding Toggles Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {/* Model Selector */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[11px] font-mono text-slate-500">Model:</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:border-indigo-500"
            >
              <option value="gemini-3.5-flash">gemini-3.5-flash (Balanced + Grounding)</option>
              <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Deep Reasoning)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Fast Tasks)</option>
            </select>
          </div>

          {/* Grounding Toggles */}
          {selectedModel === 'gemini-3.5-flash' && (
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => {
                  setUseSearchGrounding(!useSearchGrounding);
                  if (!useSearchGrounding) setUseMapsGrounding(false);
                }}
                className={`flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                  useSearchGrounding
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-bold'
                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
                title="Use Google Search data (grounding tool)"
              >
                <Search className="w-3 h-3" />
                <span>Search</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUseMapsGrounding(!useMapsGrounding);
                  if (!useMapsGrounding) setUseSearchGrounding(false);
                }}
                className={`flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                  useMapsGrounding
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold'
                    : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
                title="Use Google Maps data (grounding tool)"
              >
                <MapPin className="w-3 h-3" />
                <span>Maps</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active Context Banner if contact exists */}
      {activeContact && (
        <div className="px-4 py-2 bg-indigo-950/30 border-b border-indigo-900/30 flex items-center justify-between text-xs font-mono text-indigo-300">
          <div className="flex items-center space-x-2 truncate">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="truncate">
              Injected Lead: <strong>{activeContact.name}</strong> • {activeContact.phone}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 shrink-0">Auto-Context Active</span>
        </div>
      )}

      {/* Messages Scrollable Thread */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-950/40">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${
              m.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            {/* Header info */}
            <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-500 mb-1 px-1">
              <span className="flex items-center space-x-1">
                {m.role === 'user' ? (
                  <>
                    <User className="w-3 h-3 text-indigo-400" />
                    <span>Agent</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-emerald-400" />
                    <span>Gemini AI ({m.modelUsed || selectedModel})</span>
                  </>
                )}
              </span>
              <span>•</span>
              <span>{m.timestamp}</span>
            </div>

            {/* Bubble */}
            <div
              className={`p-3.5 rounded-2xl text-xs sm:text-sm max-w-[90%] leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-600/10'
                  : 'bg-slate-800/90 text-slate-100 border border-slate-700/80 rounded-tl-none'
              }`}
            >
              <div className="whitespace-pre-wrap font-sans">{m.content}</div>

              {/* Search Grounding Sources */}
              {m.groundingSources && m.groundingSources.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-700/60 space-y-1.5">
                  <div className="text-[10px] font-mono font-bold text-blue-300 uppercase tracking-wider flex items-center space-x-1">
                    <Search className="w-3 h-3" />
                    <span>Verified Grounding Sources:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.groundingSources.map((src, i) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-blue-950/60 border border-blue-500/30 text-[11px] font-mono text-blue-300 hover:bg-blue-900/60 hover:text-white transition-colors"
                      >
                        {src.sourceType === 'map' ? (
                          <MapPin className="w-2.5 h-2.5 text-emerald-400" />
                        ) : (
                          <ExternalLink className="w-2.5 h-2.5 text-blue-400" />
                        )}
                        <span className="truncate max-w-[180px]">{src.title || 'Source Citation'}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Queries */}
              {m.searchQueries && m.searchQueries.length > 0 && (
                <div className="mt-2 text-[10px] font-mono text-slate-400">
                  <span className="text-slate-500">Google Grounding Queries: </span>
                  {m.searchQueries.join(', ')}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center space-x-2 text-slate-400 text-xs font-mono p-3 bg-slate-900/80 border border-slate-800 rounded-xl max-w-xs">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
            <span>Gemini {selectedModel} is thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompt Chips */}
      <div className="p-2.5 bg-slate-950/60 border-t border-slate-800/80 flex items-center space-x-2 overflow-x-auto scrollbar-none text-[11px] font-mono">
        <span className="text-slate-500 shrink-0">Quick Prompts:</span>
        <button
          onClick={() => handleSendMessage('Give me a high-converting cold call opener for an absentee owner in Orange County.')}
          className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 whitespace-nowrap border border-slate-700 shrink-0"
        >
          📞 Absentee Opener
        </button>
        <button
          onClick={() => handleSendMessage('Lookup latest commercial zoning and tax assessment trends for Santa Ana / Orange County CA.')}
          className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 whitespace-nowrap border border-slate-700 shrink-0"
        >
          🔍 Orange County Zoning Trends
        </button>
        <button
          onClick={() => handleSendMessage('How do I handle the objection: "I am not interested in selling right now"?')}
          className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 whitespace-nowrap border border-slate-700 shrink-0"
        >
          🎯 Not Interested Rebuttal
        </button>
      </div>

      {/* Input Form */}
      <div className="p-3 bg-slate-900 border-t border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={`Ask ${selectedRole.name}...`}
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-sans"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || loading}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl shadow-lg shadow-indigo-600/20 transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
