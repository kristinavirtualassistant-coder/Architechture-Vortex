import React, { useState, useEffect } from 'react';
import {
  Phone,
  Shield,
  Cpu,
  Database,
  Settings,
  Activity,
  Sparkles,
  Headphones,
  LogIn,
  LogOut,
  User,
  Cloud,
  Keyboard,
  CheckSquare,
} from 'lucide-react';
import { getPendingFollowUpCount, FOLLOW_UP_UPDATED_EVENT } from '../lib/followUpStorage';

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  activeSession: any;
  isConnected: boolean;
  providerName: string;
  onOpenAIChat: () => void;
  onOpenLiveVoice: () => void;
  onOpenSavedLeads: () => void;
  onOpenTasks?: () => void;
  onOpenHelp?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  activeSession,
  isConnected,
  providerName,
  onOpenAIChat,
  onOpenLiveVoice,
  onOpenSavedLeads,
  onOpenTasks,
  onOpenHelp,
}) => {
    const [pendingTasksCount, setPendingTasksCount] = useState<number>(0);

  useEffect(() => {
    const updateCount = () => {
      setPendingTasksCount(getPendingFollowUpCount());
    };

    updateCount();
    window.addEventListener(FOLLOW_UP_UPDATED_EVENT, updateCount);
    window.addEventListener('storage', updateCount);

    return () => {
      window.removeEventListener(FOLLOW_UP_UPDATED_EVENT, updateCount);
      window.removeEventListener('storage', updateCount);
    };
  }, []);

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-lg text-white shadow-inner">
            ⚡
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight leading-none text-white">VORTEX ONE</span>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                v2.0 FSM + AI
              </span>
            </div>
            <span className="text-xs text-slate-400 font-mono hidden sm:inline">
              Multi-Tenant Power Dialing & Telephony Engine
            </span>
          </div>
        </div>

        {/* Global AI & Auth Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Follow-up Tasks & Reminders Button */}
          {onOpenTasks && (
            <button
              onClick={onOpenTasks}
              className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-amber-500/40 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-colors cursor-pointer relative"
              title="View Local Storage Follow-up Reminders & Tasks"
            >
              <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden md:inline">Reminders</span>
              {pendingTasksCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-amber-500 text-slate-950 ml-1">
                  {pendingTasksCount}
                </span>
              )}
            </button>
          )}

          {/* Live Voice Agent (Live API) */}
          <button
            onClick={onOpenLiveVoice}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600/30 to-purple-600/30 border border-indigo-500/40 text-indigo-200 hover:from-indigo-600/50 hover:to-purple-600/50 hover:text-white transition-all text-xs font-mono font-medium shadow-sm cursor-pointer"
            title="Open Gemini Live Voice Conversation (gemini-3.1-flash-live-preview)"
          >
            <Headphones className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden md:inline">Live Voice AI</span>
          </button>

          {/* AI Copilot & Chat */}
          <button
            onClick={onOpenAIChat}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600/20 to-teal-600/20 border border-emerald-500/40 text-emerald-200 hover:from-emerald-600/40 hover:to-teal-600/40 hover:text-white transition-all text-xs font-mono font-medium shadow-sm cursor-pointer"
            title="Open Gemini Multi-Turn Chat with Search & Maps Grounding"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">AI Copilot</span>
          </button>

          {/* Saved Leads */}
          <button
            onClick={onOpenSavedLeads}
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-colors cursor-pointer"
            title="View Saved Leads"
          >
            <Cloud className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden lg:inline">Saved Leads</span>
          </button>

          {/* Keyboard Shortcuts Help */}
          {onOpenHelp && (
            <button
              onClick={onOpenHelp}
              className="p-1.5 sm:px-2 sm:py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Keyboard Shortcuts & Agent Guide (Press '?')"
            >
              <Keyboard className="w-3.5 h-3.5 text-indigo-400" />
              <kbd className="hidden sm:inline-block px-1.5 py-0.2 bg-slate-900 border border-slate-700 rounded text-[10px] text-indigo-300 font-bold">
                ?
              </kbd>
            </button>
          )}

          {/* WebSocket Status */}
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-xs font-mono">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-slate-300">{isConnected ? 'LIVE WS' : 'POLLING'}</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-slate-950 border-t border-slate-800/80 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex space-x-1 sm:space-x-4 overflow-x-auto">
          <button
            onClick={() => onTabChange('workspace')}
            className={`py-3 px-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'workspace'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Phone className="w-4 h-4" />
            <span>Agent Workspace</span>
          </button>

          <button
            onClick={() => onTabChange('campaigns')}
            className={`py-3 px-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'campaigns'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Campaigns & Queue</span>
          </button>

          <button
            onClick={() => onTabChange('suppression')}
            className={`py-3 px-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'suppression'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>DNC Suppression Guard</span>
          </button>

          <button
            onClick={() => onTabChange('architecture')}
            className={`py-3 px-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'architecture'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>FSM & Architecture Blueprint</span>
          </button>

          <button
            onClick={() => onTabChange('telephony')}
            className={`py-3 px-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'telephony'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Telephony Providers</span>
          </button>
        </div>
      </div>
    </header>
  );
};
