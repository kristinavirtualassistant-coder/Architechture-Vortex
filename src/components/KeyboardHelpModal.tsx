import React from 'react';
import {
  Keyboard,
  X,
  Phone,
  Play,
  Pause,
  Shield,
  Activity,
  Cpu,
  Settings,
  Sparkles,
  Headphones,
  Cloud,
  CheckCircle2,
  HelpCircle,
  Hash,
} from 'lucide-react';

interface KeyboardHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: 'dialing' | 'navigation' | 'ai_tools' | 'general';
  tag?: string;
}

const SHORTCUTS: ShortcutItem[] = [
  // Dialing & Session
  {
    keys: ['Space'],
    description: 'Toggle Start / Pause / Resume dialing session',
    category: 'dialing',
    tag: 'Session',
  },
  {
    keys: ['D'],
    description: 'Submit quick disposition for active connected call',
    category: 'dialing',
    tag: 'Disposition',
  },
  {
    keys: ['1'],
    description: 'Quick select: Interested disposition',
    category: 'dialing',
    tag: 'Dispo Form',
  },
  {
    keys: ['2'],
    description: 'Quick select: Callback Requested disposition',
    category: 'dialing',
    tag: 'Dispo Form',
  },
  {
    keys: ['3'],
    description: 'Quick select: Not Interested disposition',
    category: 'dialing',
    tag: 'Dispo Form',
  },
  {
    keys: ['4'],
    description: 'Quick select: DNC (Add to Suppression)',
    category: 'dialing',
    tag: 'Compliance',
  },

  // Navigation & Views
  {
    keys: ['Alt', '1'],
    description: 'Switch to Agent Workspace (Active Dialing)',
    category: 'navigation',
  },
  {
    keys: ['Alt', '2'],
    description: 'Switch to Campaigns & Lead Queue Manager',
    category: 'navigation',
  },
  {
    keys: ['Alt', '3'],
    description: 'Switch to DNC Suppression Guard',
    category: 'navigation',
  },
  {
    keys: ['Alt', '4'],
    description: 'Switch to FSM & Architecture Blueprint',
    category: 'navigation',
  },
  {
    keys: ['Alt', '5'],
    description: 'Switch to Telephony Providers',
    category: 'navigation',
  },

  // AI & Cloud Drawers
  {
    keys: ['C'],
    description: 'Open AI Copilot Chat Drawer (Search & Maps)',
    category: 'ai_tools',
    tag: 'AI',
  },
  {
    keys: ['L'],
    description: 'Open Gemini Live Voice AI Session',
    category: 'ai_tools',
    tag: 'Live Voice',
  },
  {
    keys: ['S'],
    description: 'Open Saved Leads Drawer',
    category: 'ai_tools',
    tag: 'Cloud CRM',
  },

  // General
  {
    keys: ['?'],
    description: 'Toggle this Keyboard Shortcuts & Help overlay',
    category: 'general',
  },
  {
    keys: ['Esc'],
    description: 'Close active modal, drawer, or help overlay',
    category: 'general',
  },
];

export const KeyboardHelpModal: React.FC<KeyboardHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const categories = [
    { id: 'dialing', label: 'Dialer & Call Controls', icon: Phone, color: 'text-indigo-400' },
    { id: 'ai_tools', label: 'AI Intelligence & Cloud Drawers', icon: Sparkles, color: 'text-emerald-400' },
    { id: 'navigation', label: 'Tab Navigation', icon: Activity, color: 'text-blue-400' },
    { id: 'general', label: 'General & Global', icon: HelpCircle, color: 'text-amber-400' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-inner">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">Agent Keyboard Shortcuts</h3>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Speed Dial Mode
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Press <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700 rounded text-indigo-300">?</kbd> anywhere to toggle this guide during active campaigns.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm">
          {categories.map((cat) => {
            const CatIcon = cat.icon;
            const items = SHORTCUTS.filter((s) => s.category === cat.id);

            return (
              <div key={cat.id} className="space-y-2.5">
                <div className="flex items-center space-x-2 pb-1 border-b border-slate-800/60">
                  <CatIcon className={`w-4 h-4 ${cat.color}`} />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
                    {cat.label}
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition-all gap-3"
                    >
                      <span className="text-xs text-slate-300 leading-snug flex-1">
                        {item.description}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.keys.map((k, kIdx) => (
                          <React.Fragment key={kIdx}>
                            {kIdx > 0 && <span className="text-[10px] text-slate-500 font-mono">+</span>}
                            <kbd className="px-2 py-1 text-xs font-mono font-bold bg-slate-800 border border-slate-700/80 rounded-md text-indigo-300 shadow-sm min-w-[24px] text-center">
                              {k}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Onboarding Tip Box */}
          <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-semibold text-indigo-200">Pro-Agent Dialing Workflow:</p>
              <p className="text-slate-400 leading-relaxed">
                When a call connects, review the active property card, press <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700 rounded text-indigo-300">D</kbd> or number keys to set disposition, and tap <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700 rounded text-indigo-300">Space</kbd> to launch the next batch of parallel lines without reaching for your mouse.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-1 font-mono text-[11px]">
            <span>Shortcuts are automatically disabled when typing in notes</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-colors cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
