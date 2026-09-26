import React, { useState, useEffect } from 'react';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Pause,
  Play,
  SkipForward,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
  DollarSign,
  MapPin,
  FileText,
  Radio,
  Sliders,
  AlertTriangle,
  Keyboard,
  Sparkles,
  CloudUpload,
  Zap,
  RefreshCw,
  HelpCircle,
  Mail,
  Tag,
  Calendar,
  Layers,
  UserCheck,
  Home,
  CheckSquare,
  Briefcase,
  Compass,
  ShieldCheck,
  CalendarClock,
  Bell,
  ListTodo,
  ArrowUpRight,
} from 'lucide-react';
import { Call, CampaignContact, DialingSession, FsmCallState, SessionDispositionStats } from '../types/dialer';
import { FollowUpTask } from '../types/followUpTask';
import {
  saveFollowUpTask,
  getFollowUpTasks,
  FOLLOW_UP_UPDATED_EVENT,
} from '../lib/followUpStorage';
import { NotesSection } from './NotesSection';
import { ConnectionSignal } from './ConnectionSignal';
import { DispositionBarChart } from './DispositionBarChart';
import { useAuth } from '../context/AuthContext';

interface AgentWorkspaceProps {
  session: DialingSession | null;
  activeCalls: (Call & { contactName?: string; contactMetadata?: any })[];
  activeContact: CampaignContact | null;
  activeCall: Call | null;
  queueCounts: { total: number; pending: number; completed: number; dialing: number; dnc: number };
  dispositionStats?: SessionDispositionStats | null;
  onStartSession: (lines: number) => void;
  onPauseSession: () => void;
  onResumeSession: () => void;
  onEndSession: () => void;
  onChangeLines: (lines: number) => void;
  onSubmitDisposition: (callId: string, dispo: { disposition_code: string; notes?: string; add_to_dnc?: boolean; follow_up_date?: string }) => void;
  onSimulateEvent: (callId: string, eventType: string) => void;
  onDispatchNext: () => void;
  onOpenTasks?: () => void;
  onAddSuppression?: (phone: string, reason: string) => void;
  recentEvents: any[];
}

const LOCAL_STORAGE_DISPO_KEY = 'vortex_dialer_dispo_form_state';

interface ConnectedCallTimerProps {
  call: (Call & { contactMetadata?: any }) | Call | null;
  className?: string;
  showIcon?: boolean;
}

/**
 * ConnectedCallTimer
 * Tracks and displays the live elapsed duration of a CONNECTED call by calculating
 * the real-time difference between Date.now() and the connected_at timestamp from call metadata.
 */
export const ConnectedCallTimer: React.FC<ConnectedCallTimerProps> = ({
  call,
  className = 'text-xs font-mono font-bold text-emerald-400',
  showIcon = false,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    if (!call) {
      setElapsedSeconds(0);
      return;
    }

    // Extract connected_at from call object or contactMetadata
    const connectedTimestamp =
      call.connected_at ||
      (call as any).contactMetadata?.connected_at ||
      (call as any).contactMetadata?.connectedAt;

    if (call.state === 'CONNECTED' && connectedTimestamp) {
      const startTime = new Date(connectedTimestamp).getTime();

      const calculateElapsed = () => {
        const now = Date.now();
        const diff = Math.max(0, Math.floor((now - startTime) / 1000));
        setElapsedSeconds(diff);
      };

      calculateElapsed();
      const interval = setInterval(calculateElapsed, 1000);
      return () => clearInterval(interval);
    } else {
      setElapsedSeconds(call.duration_seconds || 0);
    }
  }, [call?.id, call?.state, call?.connected_at, (call as any)?.contactMetadata?.connected_at]);

  const formatElapsed = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const hours = Math.floor(mins / 60);
    if (hours > 0) {
      const remainingMins = mins % 60;
      return `${hours.toString().padStart(2, '0')}:${remainingMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {showIcon && <Clock className="w-3.5 h-3.5" />}
      <span>{formatElapsed(elapsedSeconds)}</span>
    </span>
  );
};

export const AgentWorkspace: React.FC<AgentWorkspaceProps> = ({
  session,
  activeCalls,
  activeContact,
  activeCall,
  queueCounts,
  dispositionStats,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onEndSession,
  onChangeLines,
  onSubmitDisposition,
  onSimulateEvent,
  onDispatchNext,
  onOpenTasks,
  onAddSuppression,
  recentEvents,
}) => {
  const [linesCount, setLinesCount] = useState<number>(session?.lines_count || 3);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const { user, saveLeadToCloud, signInWithGoogle } = useAuth();
  
  // State for AI Objection Assistant and Cloud Sync
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);
  const [cloudSaveStatus, setCloudSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Helper date functions for follow-up reminders
  const getTomorrowDateStr = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };

  const getDateOffsetStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  // State for disposition form & follow-up task creation
  const [agentNotes, setAgentNotes] = useState<string>('');
  const [selectedDispo, setSelectedDispo] = useState<string>('INTERESTED');
  const [addToDnc, setAddToDnc] = useState<boolean>(false);
  const [followUpDate, setFollowUpDate] = useState<string>('');
  const [callDuration, setCallDuration] = useState<number>(0);

  // Optional Follow-up Task reminder toggle & configuration
  const [createFollowUpTask, setCreateFollowUpTask] = useState<boolean>(false);
  const [taskTitle, setTaskTitle] = useState<string>('');
  const [taskDueDate, setTaskDueDate] = useState<string>(getTomorrowDateStr());
  const [taskDueTime, setTaskDueTime] = useState<string>('10:00');
  const [taskPriority, setTaskPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [taskType, setTaskType] = useState<'call' | 'email' | 'cma' | 'offer' | 'meeting' | 'other'>('call');
  const [taskSuccessToast, setTaskSuccessToast] = useState<string | null>(null);
  const [recentFollowUpTasks, setRecentFollowUpTasks] = useState<FollowUpTask[]>([]);

  // Sync recent follow-up tasks from local storage
  useEffect(() => {
    const refreshTasks = () => {
      setRecentFollowUpTasks(getFollowUpTasks());
    };
    refreshTasks();
    window.addEventListener(FOLLOW_UP_UPDATED_EVENT, refreshTasks);
    window.addEventListener('storage', refreshTasks);
    return () => {
      window.removeEventListener(FOLLOW_UP_UPDATED_EVENT, refreshTasks);
      window.removeEventListener('storage', refreshTasks);
    };
  }, []);

  const handleQuickAiObjection = async (objection: string) => {
    setIsGeneratingScript(true);
    try {
      const res = await fetch('/api/v1/ai/script-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objection,
          context: {
            contactName: activeContact?.name,
            phone: activeContact?.phone,
            secondaryPhones: activeContact?.metadata?.secondary_phones,
            email: activeContact?.metadata?.email,
            propertyAddress: activeContact?.metadata?.property_address || '1840 S Grand Ave, Santa Ana, CA',
            city: activeContact?.metadata?.city,
            state: activeContact?.metadata?.state,
            zip: activeContact?.metadata?.zip,
            apn: activeContact?.metadata?.apn,
            propertyType: activeContact?.metadata?.property_type_standardized || activeContact?.metadata?.property_type,
            units: activeContact?.metadata?.units,
            isVacant: activeContact?.metadata?.is_vacant,
            isOwnerOccupied: activeContact?.metadata?.is_owner_occupied,
            pipelineName: activeContact?.metadata?.pipeline_name,
            stageName: activeContact?.metadata?.stage_name_standardized || activeContact?.metadata?.stage_name,
            estimatedEquity: activeContact?.metadata?.estimated_equity || '$485,000',
            assessedValue: activeContact?.metadata?.assessed_value,
            ownerType: activeContact?.metadata?.owner_type,
          },
        }),
      });
      const data = await res.json();
      setAiSuggestion(data.text || 'No script suggestion returned.');
    } catch (err) {
      setAiSuggestion('Could not generate script suggestion.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleSaveToFirestore = async () => {
    if (!user) {
      signInWithGoogle();
      return;
    }
    if (!activeContact) return;

    setCloudSaveStatus('saving');
    try {
      await saveLeadToCloud({
        contactName: activeContact.name,
        phone: activeContact.phone,
        email: activeContact.metadata?.email || null,
        secondaryPhones: activeContact.metadata?.secondary_phones || null,
        trackedPhone: activeContact.metadata?.tracked_phone || null,
        propertyAddress: activeContact.metadata?.property_address || '123 Main St',
        city: activeContact.metadata?.city || 'Anaheim',
        state: activeContact.metadata?.state || 'CA',
        zip: activeContact.metadata?.zip || '92805',
        apn: activeContact.metadata?.apn || '580-081-01',
        propertyTypeStandardized: activeContact.metadata?.property_type_standardized || null,
        propertyType: activeContact.metadata?.property_type || null,
        units: activeContact.metadata?.units || 1,
        isVacant: activeContact.metadata?.is_vacant || 'No',
        isOwnerOccupied: activeContact.metadata?.is_owner_occupied || 'No',
        pipelineName: activeContact.metadata?.pipeline_name || 'High Equity Acquisitions',
        stageNameStandardized: activeContact.metadata?.stage_name_standardized || null,
        stageStatusStandardized: activeContact.metadata?.stage_status_standardized || null,
        assignedTo: activeContact.metadata?.assigned_to || null,
        nextTaskKind: activeContact.metadata?.next_task_kind || null,
        nextTaskDueAt: activeContact.metadata?.next_task_due_at || null,
        tagList: activeContact.metadata?.tag_list || null,
        estimatedEquity: activeContact.metadata?.estimated_equity || null,
        assessedValue: activeContact.metadata?.assessed_value || null,
        ownerType: activeContact.metadata?.owner_type || 'Absentee Owner',
        dispositionCode: selectedDispo,
        notes: agentNotes || 'Saved from Active Dialer Workspace',
      });
      setCloudSaveStatus('saved');
      setTimeout(() => setCloudSaveStatus('idle'), 3500);
    } catch (err) {
      console.error('Save to Firestore failed:', err);
      setCloudSaveStatus('error');
      setTimeout(() => setCloudSaveStatus('idle'), 3500);
    }
  };

  // Restore disposition form state from localStorage on component mount / active call
  useEffect(() => {
    if (activeCall) {
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_DISPO_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.agentNotes !== undefined) setAgentNotes(parsed.agentNotes);
          if (parsed.selectedDispo !== undefined) setSelectedDispo(parsed.selectedDispo);
          if (parsed.addToDnc !== undefined) setAddToDnc(Boolean(parsed.addToDnc));
          if (parsed.followUpDate !== undefined) setFollowUpDate(parsed.followUpDate);
        }
      } catch (e) {
        console.warn('Failed to restore disposition form state from localStorage:', e);
      }
    }
  }, [activeCall?.id]);

  // Debounce sync disposition form changes to localStorage by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      try {
        const formPayload = {
          agentNotes,
          selectedDispo,
          addToDnc,
          followUpDate,
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(LOCAL_STORAGE_DISPO_KEY, JSON.stringify(formPayload));
      } catch (e) {
        // ignore storage quota errors
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [agentNotes, selectedDispo, addToDnc, followUpDate]);

  // Timer for connected call
  useEffect(() => {
    let timer: any;
    if (activeCall && activeCall.state === 'CONNECTED' && activeCall.connected_at) {
      const startTime = new Date(activeCall.connected_at).getTime();
      timer = setInterval(() => {
        setCallDuration(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
      }, 1000);
    } else {
      setCallDuration(activeCall?.duration_seconds || 0);
    }
    return () => clearInterval(timer);
  }, [activeCall]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getStateBadge = (state: FsmCallState) => {
    switch (state) {
      case 'INITIATED':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">INITIATING</span>;
      case 'DIALING':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-blue-950 text-blue-400 border border-blue-800 animate-pulse">DIALING...</span>;
      case 'RINGING':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-amber-950 text-amber-400 border border-amber-800 animate-pulse">RINGING 🔔</span>;
      case 'CONNECTED':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-700">CONNECTED 🟢</span>;
      case 'BUSY':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-rose-950 text-rose-400 border border-rose-800">BUSY</span>;
      case 'FAILED':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-rose-950 text-rose-400 border border-rose-800">FAILED</span>;
      case 'NO_ANSWER':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">NO ANSWER</span>;
      case 'DISPO_PENDING':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-700 animate-pulse">DISPO REQUIRED</span>;
      case 'TERMINATED':
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-slate-900 text-slate-400 border border-slate-800">ENDED</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-slate-800 text-slate-300">{state}</span>;
    }
  };

  const handleQuickDnc = () => {
    if (!activeCall) return;
    const phoneToSuppress = activeContact?.phone || activeCall.phone_dialed;
    if (phoneToSuppress && onAddSuppression) {
      onAddSuppression(phoneToSuppress, 'Quick DNC from Active Call Card');
    }
    onSubmitDisposition(activeCall.id, {
      disposition_code: 'DNC',
      notes: agentNotes || 'Quick DNC triggered from AgentWorkspace',
      add_to_dnc: true,
    });
    onSimulateEvent(activeCall.id, 'hangup');
  };

  const handleDispoSubmit = (code?: string) => {
    const dispoCode = code || selectedDispo;
    if (!activeCall) return;

    const targetDueDate = createFollowUpTask ? taskDueDate : (followUpDate || undefined);

    onSubmitDisposition(activeCall.id, {
      disposition_code: dispoCode,
      notes: agentNotes,
      add_to_dnc: addToDnc || dispoCode === 'DNC',
      follow_up_date: targetDueDate,
    });

    // If Follow-up Task toggle is checked, automatically create reminder in local storage
    if (createFollowUpTask && activeContact) {
      const contactName = activeContact.name || 'Lead';
      const promptTitle = taskTitle.trim() || `Follow up with ${contactName} (${dispoCode})`;
      const chosenDueDate = taskDueDate || getTomorrowDateStr();

      saveFollowUpTask({
        callId: activeCall.id,
        contactId: activeContact.id,
        contactName: contactName,
        phone: activeContact.phone,
        propertyAddress: activeContact.metadata?.property_address || undefined,
        city: activeContact.metadata?.city || undefined,
        apn: activeContact.metadata?.apn || undefined,
        dispositionCode: dispoCode,
        taskTitle: promptTitle,
        dueDate: chosenDueDate,
        dueTime: taskDueTime || undefined,
        priority: taskPriority,
        taskType: taskType,
        notes: agentNotes || undefined,
      });

      setTaskSuccessToast(`✅ Follow-up task scheduled for ${contactName} on ${chosenDueDate}!`);
      setTimeout(() => setTaskSuccessToast(null), 4500);
    }

    // Reset local state & clear localStorage draft
    setAgentNotes('');
    setAddToDnc(false);
    setCreateFollowUpTask(false);
    setTaskTitle('');
    try {
      localStorage.removeItem(LOCAL_STORAGE_DISPO_KEY);
    } catch (e) {}
  };

  return (
    <div className="space-y-6">
      {/* Session Header Controller Bar */}
      <div className="bg-slate-900 rounded-xl p-4 sm:p-5 border border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-bold text-white text-base">Campaign: Orange County High Equity Owners</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                FIPS 06059
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Agent: <strong className="text-slate-200">Kristina Madrigal</strong> • Org: <strong className="text-slate-200">CMC Realty Partners</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Telephony Connection Signal Indicator (Green/Yellow/Red) */}
          <ConnectionSignal activeCalls={activeCalls} />

          {/* Multi-Line Capacity Selector */}
          <div className="flex items-center space-x-1 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono">
            <span className="text-slate-400">Lines:</span>
            <select
              value={session?.lines_count || linesCount}
              onChange={(e) => {
                const val = Number(e.target.value);
                setLinesCount(val);
                if (session) onChangeLines(val);
              }}
              className="bg-transparent font-bold text-indigo-400 focus:outline-none cursor-pointer"
            >
              <option value="1" className="bg-slate-900 text-white">1 Line</option>
              <option value="2" className="bg-slate-900 text-white">2 Lines</option>
              <option value="3" className="bg-slate-900 text-white">3 Lines (Power)</option>
              <option value="4" className="bg-slate-900 text-white">4 Lines (Max)</option>
            </select>
          </div>

          {/* Session Play/Pause/Start Controls */}
          {!session ? (
            <button
              onClick={() => onStartSession(linesCount)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Start Dialing Session</span>
            </button>
          ) : session.status === 'paused' ? (
            <button
              onClick={onResumeSession}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Resume Dialer</span>
            </button>
          ) : (
            <div className="flex items-center space-x-2">
              <button
                onClick={onPauseSession}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </button>
              <button
                onClick={onDispatchNext}
                className="px-3 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5"
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span>Next Batch</span>
              </button>
            </div>
          )}

          {session && (
            <button
              onClick={onEndSession}
              className="px-3 py-2 bg-rose-900/40 hover:bg-rose-900/70 text-rose-300 font-bold text-xs rounded-lg border border-rose-800 transition-colors"
            >
              End Session
            </button>
          )}
        </div>
      </div>

      {/* Keyboard Shortcuts Helper Pill */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/60 rounded-lg border border-slate-800/80 text-[11px] font-mono text-slate-400">
        <div className="flex items-center space-x-3">
          <span className="flex items-center gap-1 text-indigo-400 font-bold">
            <Keyboard className="w-3.5 h-3.5" /> Hotkeys Active:
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-bold">Space</kbd> Toggle Pause/Resume
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-bold">D</kbd> Quick Disposition
          </span>
        </div>
        <span className="text-slate-500 hidden md:inline">Auto-saves notes locally & synchronizes live via WebSockets</span>
      </div>

      {/* Main Split Grid: Active Lines & Ingested Property Contact Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Multi-Line Dialing Engine */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span className="font-bold text-sm text-white font-mono uppercase tracking-wider">
                  Active Lines ({session?.lines_count || linesCount} Lines Parallel)
                </span>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Queue: <strong className="text-emerald-400">{queueCounts.pending}</strong> pending
              </span>
            </div>

            {/* Render Lines */}
            <div className="space-y-3">
              {Array.from({ length: session?.lines_count || linesCount }).map((_, idx) => {
                const lineNum = idx + 1;
                const callOnLine = activeCalls.find((c) => c.line_number === lineNum);

                return (
                  <div
                    key={lineNum}
                    className={`p-4 rounded-xl border transition-all ${
                      callOnLine?.state === 'CONNECTED'
                        ? 'bg-emerald-950/40 border-emerald-500/80 shadow-lg shadow-emerald-950/30'
                        : callOnLine?.state === 'DISPO_PENDING'
                        ? 'bg-indigo-950/40 border-indigo-500/80'
                        : callOnLine
                        ? 'bg-slate-950 border-slate-800'
                        : 'bg-slate-950/40 border-slate-800/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-mono text-xs flex items-center justify-center font-bold">
                          {lineNum}
                        </span>
                        <span className="font-mono text-xs text-slate-400">
                          {callOnLine?.provider_name?.toUpperCase() || 'IDLE'}
                        </span>
                      </div>
                      {callOnLine ? (
                        getStateBadge(callOnLine.state)
                      ) : (
                        <span className="text-xs font-mono text-slate-500">STANDBY</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono font-bold text-sm text-slate-100 block">
                          {callOnLine?.phone_dialed || 'Waiting for dispatch...'}
                        </span>
                        <span className="text-xs text-slate-400">
                          {callOnLine?.contactName || (callOnLine ? 'Contact Record' : 'No active call')}
                        </span>
                      </div>

                      {/* Timer / Waveform if Connected */}
                      {callOnLine?.state === 'CONNECTED' && (
                        <div className="text-right">
                          <ConnectedCallTimer call={callOnLine} className="text-xs font-mono font-bold text-emerald-400 block" />
                          <span className="text-[10px] font-mono text-emerald-500/80">AUDIO LIVE 🎙️</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Developer Simulator Controls (for sandbox testing) */}
            {activeCalls.length > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <span>⚡</span> Provider Simulation Triggers (Testing Sandbox):
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {activeCalls.map((c) => (
                    <div key={c.id} className="p-2 rounded bg-slate-950 border border-slate-800 text-xs space-y-1">
                      <div className="flex items-center justify-between font-mono text-[10px] text-slate-400">
                        <span>L{c.line_number}: {c.phone_dialed.slice(-4)}</span>
                        <span>{c.state}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {c.state === 'DIALING' && (
                          <button
                            onClick={() => onSimulateEvent(c.id, 'ringing')}
                            className="px-1.5 py-0.5 bg-blue-900/50 hover:bg-blue-900 text-blue-300 text-[10px] rounded font-mono"
                          >
                            Ring
                          </button>
                        )}
                        {(c.state === 'DIALING' || c.state === 'RINGING') && (
                          <>
                            <button
                              onClick={() => onSimulateEvent(c.id, 'answered')}
                              className="px-1.5 py-0.5 bg-emerald-900/50 hover:bg-emerald-900 text-emerald-300 text-[10px] rounded font-mono font-bold"
                            >
                              Pickup 🟢
                            </button>
                            <button
                              onClick={() => onSimulateEvent(c.id, 'busy')}
                              className="px-1.5 py-0.5 bg-rose-900/50 hover:bg-rose-900 text-rose-300 text-[10px] rounded font-mono"
                            >
                              Busy
                            </button>
                            <button
                              onClick={() => onSimulateEvent(c.id, 'no_answer')}
                              className="px-1.5 py-0.5 bg-amber-900/50 hover:bg-amber-900 text-amber-300 text-[10px] rounded font-mono"
                            >
                              NoAns
                            </button>
                          </>
                        )}
                        {c.state === 'CONNECTED' && (
                          <button
                            onClick={() => onSimulateEvent(c.id, 'hangup')}
                            className="px-1.5 py-0.5 bg-rose-900/50 hover:bg-rose-900 text-rose-300 text-[10px] rounded font-mono font-bold"
                          >
                            Hangup 🔴
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Ingested CRM Property & Contact Metadata Card */}
        <div className="lg:col-span-7 space-y-4 flex flex-col justify-between">
          <div className="bg-slate-900 rounded-xl p-5 sm:p-6 border border-slate-800 shadow-xl space-y-5">
            
            {/* Contact Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4 gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-400">
                    Active Contact CRM Intelligence
                  </span>
                  {(!activeContact?.phone || activeContact?.phone.trim() === '') && (
                    <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded-full bg-amber-950/80 text-amber-300 border border-amber-500/40">
                      No Phone Number (Email Only)
                    </span>
                  )}
                  {(activeContact?.status === 'dnc' ||
                    activeContact?.metadata?.stage_name_standardized?.toLowerCase().includes('do not contact') ||
                    activeContact?.metadata?.stage_name?.toLowerCase().includes('do not email') ||
                    activeContact?.metadata?.stage_status_standardized === 'lost') && (
                    <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded-full bg-rose-950/80 text-rose-300 border border-rose-500/40">
                      DNC / Opt-Out
                    </span>
                  )}
                  {activeContact?.metadata?.stage_status_standardized && (
                    <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
                      {activeContact.metadata.stage_status_standardized}
                    </span>
                  )}
                  {activeContact?.metadata?.source_name && (
                    <span className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono text-slate-400 bg-slate-800/80 rounded border border-slate-700/60">
                      Src: {activeContact.metadata.source_name}
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  {activeContact?.name || 'No Active Contact Selected'}
                </h3>
                <div className="flex items-center gap-3 mt-1 text-xs font-mono text-slate-400">
                  <span>ID: {activeContact?.external_contact_id || 'vortex_standby'}</span>
                  {activeContact?.metadata?.assigned_to && (
                    <span className="flex items-center gap-1 text-indigo-300">
                      <UserCheck className="w-3 h-3 text-indigo-400" />
                      Rep: {activeContact.metadata.assigned_to}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {/* Save to Firestore Button */}
                {activeContact && (
                  <button
                    onClick={handleSaveToFirestore}
                    disabled={cloudSaveStatus === 'saving'}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center space-x-1.5 transition-all border ${
                      cloudSaveStatus === 'saved'
                        ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300'
                        : cloudSaveStatus === 'saving'
                        ? 'bg-slate-800 border-slate-700 text-slate-400'
                        : 'bg-indigo-950/40 border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/40 hover:text-white'
                    }`}
                    title="Persist this lead with notes and property details to Firebase Firestore"
                  >
                    {cloudSaveStatus === 'saving' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    ) : cloudSaveStatus === 'saved' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <CloudUpload className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    <span>{cloudSaveStatus === 'saved' ? 'Saved to Cloud' : cloudSaveStatus === 'saving' ? 'Saving...' : 'Save to Cloud'}</span>
                  </button>
                )}

                {activeCall && (
                  <div className="text-right">
                    {getStateBadge(activeCall.state)}
                    {activeCall.state === 'CONNECTED' && (
                      <ConnectedCallTimer call={activeCall} className="text-xs font-mono text-emerald-400 block mt-1 font-bold" />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Comprehensive CRM Lead & Property Intelligence Grid */}
            {activeContact ? (
              <div className="space-y-3">
                {/* Highlight Section: Pipeline, Stage & Next Scheduled Task */}
                <div className="p-3.5 bg-indigo-950/25 rounded-xl border border-indigo-500/30 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-300 flex items-center gap-1.5 font-bold mb-1">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" /> Pipeline & Stage
                    </span>
                    <span className="font-bold text-slate-100 text-sm block truncate">
                      {activeContact.metadata?.pipeline_name || 'High Equity Acquisitions'}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-indigo-300 font-mono font-medium">
                        {activeContact.metadata?.stage_name_standardized || activeContact.metadata?.stage_name || 'Discovery'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        • {activeContact.metadata?.stage_status_standardized || activeContact.metadata?.stage_status || 'Active'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-orange-300 flex items-center gap-1.5 font-bold mb-1">
                      <Calendar className="w-3.5 h-3.5 text-orange-400" /> Next Scheduled Task
                    </span>
                    <span className="font-semibold text-slate-200 text-xs block truncate">
                      {activeContact.metadata?.next_task_kind || 'Outbound Call & Offer'}
                    </span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-orange-400/80" />
                      <span className="text-xs font-mono text-orange-300/90 font-medium">
                        Due: {activeContact.metadata?.next_task_due_at || 'Immediate / Ready'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300 flex items-center gap-1.5 font-bold mb-1">
                      <Tag className="w-3.5 h-3.5 text-cyan-400" /> Lead Tags & Source
                    </span>
                    <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
                      {activeContact.metadata?.tag_list ? (
                        String(activeContact.metadata.tag_list)
                          .split(',')
                          .map((tag, i) => (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 bg-slate-900 text-cyan-300 font-mono text-[9px] rounded border border-cyan-800/40"
                            >
                              {tag.trim()}
                            </span>
                          ))
                      ) : (
                        <span className="text-[11px] text-slate-400 font-mono">Standard Ingest</span>
                      )}
                    </div>
                    {activeContact.metadata?.referrer_name && (
                      <span className="text-[9px] font-mono text-slate-500 block mt-1">
                        Ref: {activeContact.metadata.referrer_name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Section 2: Property GIS & Parcel Attributes */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 sm:col-span-2">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-rose-400" /> Property Address
                    </span>
                    <span className="font-bold text-slate-100 text-sm block">
                      {activeContact.metadata?.property_address || '123 Main St'}
                    </span>
                    <span className="text-slate-400 text-xs font-sans block">
                      {activeContact.metadata?.city || 'Anaheim'}, {activeContact.metadata?.state || 'CA'} {activeContact.metadata?.zip || '92805'}
                    </span>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-indigo-400" /> Parcel APN
                    </span>
                    <span className="font-mono font-bold text-indigo-300 text-sm block">
                      {activeContact.metadata?.apn || '580-081-01'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 block mt-0.5">Orange County GIS</span>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <Home className="w-3 h-3 text-teal-400" /> Property Type & Units
                    </span>
                    <span className="font-medium text-slate-200 text-xs block truncate" title={activeContact.metadata?.property_type_standardized || activeContact.metadata?.property_type || 'SFR'}>
                      {activeContact.metadata?.property_type_standardized || activeContact.metadata?.property_type || 'Single Family'}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-mono">
                      <span className="text-slate-400">{activeContact.metadata?.units || 1} Unit(s)</span>
                      <span>•</span>
                      {activeContact.metadata?.is_vacant === 'Yes' || activeContact.metadata?.is_vacant === true ? (
                        <span className="text-amber-400 font-bold">Vacant</span>
                      ) : (
                        <span className="text-slate-400">Occupied</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 3: Communications & Contact Channels */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <Phone className="w-3 h-3 text-emerald-400" /> Primary Phone
                    </span>
                    <span className="font-mono font-bold text-emerald-400 text-sm block truncate">
                      {activeContact.phone || '--'}
                    </span>
                    {activeContact.metadata?.tracked_phone && (
                      <span className="text-[10px] text-indigo-400 font-mono block mt-0.5">
                        Trunk: {activeContact.metadata.tracked_phone}
                      </span>
                    )}
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <PhoneCall className="w-3 h-3 text-indigo-400" /> Secondary Phones
                    </span>
                    <span className="font-mono text-slate-300 text-xs block truncate" title={activeContact.metadata?.secondary_phones || 'None'}>
                      {activeContact.metadata?.secondary_phones || 'None on file'}
                    </span>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <Mail className="w-3 h-3 text-cyan-400" /> Email Address
                    </span>
                    <span className="font-mono text-slate-300 text-xs block truncate" title={activeContact.metadata?.email || 'None'}>
                      {activeContact.metadata?.email || 'None on file'}
                    </span>
                  </div>
                </div>

                {/* Section 4: Financial Valuation & Equity */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-amber-400" /> Estimated Equity
                    </span>
                    <span className="font-mono font-bold text-amber-400 text-sm">
                      {activeContact.metadata?.estimated_equity ? String(activeContact.metadata.estimated_equity) : '$485,000'}
                    </span>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-emerald-400" /> Assessed Value
                    </span>
                    <span className="font-mono font-bold text-slate-200 text-sm">
                      {activeContact.metadata?.assessed_value ? String(activeContact.metadata.assessed_value) : '$750,000'}
                    </span>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400 uppercase block flex items-center gap-1">
                      <UserCheck className="w-3 h-3 text-purple-400" /> Owner Classification
                    </span>
                    <span className="font-bold text-slate-200 text-xs block">
                      {activeContact.metadata?.owner_type || (activeContact.metadata?.is_owner_occupied ? 'Owner Occupied' : 'Absentee Owner')}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center space-y-2">
                <Radio className="w-8 h-8 text-indigo-400/60 mx-auto animate-pulse" />
                <h4 className="text-sm font-semibold text-slate-300">Dialer Engine on Standby</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  When a call is connected or dispatched from the campaign queue, full CRM lead intelligence, parcel GIS records, and AI objection scripts will populate automatically.
                </p>
              </div>
            )}

            {/* AI Objection Copilot Widget */}
            <div className="p-4 bg-gradient-to-br from-indigo-950/30 to-slate-950 border border-indigo-500/20 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-indigo-200 font-mono">Gemini AI Script & Objection Assistant</span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">gemini-2.5-flash</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  'Not interested in selling',
                  'Offer too low',
                  'Already working with an agent',
                  'Call me next quarter',
                  'How did you get my number?',
                ].map((objection) => (
                  <button
                    key={objection}
                    onClick={() => handleQuickAiObjection(objection)}
                    disabled={isGeneratingScript}
                    className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-indigo-900/40 border border-slate-700/80 hover:border-indigo-500/40 text-slate-300 hover:text-indigo-200 text-xs transition-colors font-sans"
                  >
                    &quot;{objection}&quot;
                  </button>
                ))}
              </div>

              {isGeneratingScript ? (
                <div className="flex items-center space-x-2 text-xs font-mono text-indigo-300 py-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Synthesizing tailored counter-pitch with property equity & APN context...</span>
                </div>
              ) : aiSuggestion ? (
                <div className="p-3 bg-slate-950/80 border border-indigo-500/30 rounded-lg text-xs font-sans text-indigo-100 leading-relaxed relative">
                  <div className="text-[10px] font-mono text-indigo-400 font-bold uppercase mb-1">
                    Recommended Script Response:
                  </div>
                  {aiSuggestion}
                  <button
                    onClick={() => setAiSuggestion(null)}
                    className="absolute top-2 right-2 text-slate-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                </div>
              ) : null}
            </div>

            {/* Audio & Call Control Actions Bar */}
            {activeCall && activeCall.state === 'CONNECTED' && (
              <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className={`p-2.5 rounded-lg border font-mono text-xs font-bold flex items-center gap-1.5 transition-colors ${
                      isMuted
                        ? 'bg-rose-900/60 text-rose-300 border-rose-700'
                        : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {isMuted ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4 text-emerald-400" />}
                    <span>{isMuted ? 'Muted' : 'Mute'}</span>
                  </button>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono text-emerald-300">
                      Call active with {activeContact?.name}
                    </span>
                    <span className="text-slate-500 font-mono text-xs">•</span>
                    <ConnectedCallTimer call={activeCall} className="text-xs font-mono font-bold text-emerald-400" showIcon />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleQuickDnc}
                    className="px-3 py-2 bg-rose-950/80 hover:bg-rose-900 text-rose-300 font-bold text-xs rounded-lg border border-rose-800 transition-colors shadow flex items-center gap-1.5 cursor-pointer"
                    title="Add current contact phone to DNC suppression list and hang up"
                  >
                    <ShieldCheck className="w-4 h-4 text-rose-400" />
                    <span>Quick DNC</span>
                  </button>
                  <button
                    onClick={() => onSimulateEvent(activeCall.id, 'hangup')}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center gap-1.5 cursor-pointer"
                  >
                    <PhoneOff className="w-4 h-4" />
                    <span>Hang Up Call</span>
                  </button>
                </div>
              </div>
            )}

            {/* Dedicated Notes Section Component (API-backed persistence & history) */}
            <NotesSection
              callId={activeCall?.id}
              contactName={activeContact?.name}
              initialNotes={agentNotes}
              onNoteAdded={(newNote) => {
                setAgentNotes((prev) => (prev ? `${prev}\n${newNote.text}` : newNote.text));
              }}
            />

            {/* Disposition Submission Bar */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              {/* Task Success Toast Notification */}
              {taskSuccessToast && (
                <div className="p-3 bg-emerald-950/90 border border-emerald-500/50 rounded-xl text-emerald-200 text-xs font-mono flex items-center justify-between shadow-lg animate-fade-in">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{taskSuccessToast}</span>
                  </div>
                  <button
                    onClick={() => setTaskSuccessToast(null)}
                    className="text-emerald-400 hover:text-white text-xs px-2 py-0.5 rounded hover:bg-emerald-900/60 cursor-pointer"
                  >
                    Dismiss ✕
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono text-slate-300 uppercase tracking-wider font-bold">
                    Disposition Action Controls:
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    (Draft auto-saved to localStorage)
                  </span>
                </div>

                <div className="flex items-center space-x-4">
                  {/* Follow-up Task Toggle */}
                  <label className="flex items-center space-x-2 text-xs text-amber-300 hover:text-amber-200 cursor-pointer font-mono font-medium select-none bg-amber-950/30 px-2.5 py-1 rounded-lg border border-amber-500/30">
                    <input
                      type="checkbox"
                      checked={createFollowUpTask}
                      onChange={(e) => {
                        setCreateFollowUpTask(e.target.checked);
                        if (e.target.checked) {
                          if (!taskDueDate) setTaskDueDate(getTomorrowDateStr());
                          if (!taskTitle && activeContact) {
                            setTaskTitle(`Follow up with ${activeContact.name} regarding property`);
                          }
                        }
                      }}
                      className="rounded border-slate-700 text-amber-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="flex items-center gap-1">
                      <CalendarClock className="w-3.5 h-3.5 text-amber-400" />
                      Create Follow-up Task
                    </span>
                  </label>

                  {/* DNC Suppression Toggle */}
                  <label className="flex items-center space-x-1.5 text-xs text-rose-400 cursor-pointer font-mono select-none">
                    <input
                      type="checkbox"
                      checked={addToDnc}
                      onChange={(e) => setAddToDnc(e.target.checked)}
                      className="rounded border-slate-700 text-rose-600 focus:ring-0 w-3.5 h-3.5"
                    />
                    <span>Add to DNC</span>
                  </label>
                </div>
              </div>

              {/* Optional Follow-up Task Configuration Panel (Expanded when toggle is ON) */}
              {createFollowUpTask && (
                <div className="p-3.5 bg-slate-950/90 border border-amber-500/40 rounded-xl space-y-3 shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center space-x-2">
                      <CalendarClock className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-mono font-bold text-slate-200">
                        Follow-up Task Details
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        Local Storage Reminder
                      </span>
                    </div>
                    {onOpenTasks && (
                      <button
                        onClick={onOpenTasks}
                        className="text-[11px] font-mono text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                      >
                        <span>View all tasks</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Quick Preset Title Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-mono text-slate-400">Quick Templates:</span>
                    <button
                      type="button"
                      onClick={() => setTaskTitle(`Callback with purchase offer for ${activeContact?.name || 'lead'}`)}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 hover:text-amber-300 cursor-pointer"
                    >
                      + Offer Callback
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskTitle(`Send CMA comps & valuation to ${activeContact?.name || 'lead'}`)}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 hover:text-amber-300 cursor-pointer"
                    >
                      + Send CMA Comps
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskTitle(`Discuss 1031 tax deferred exchange options`)}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 hover:text-amber-300 cursor-pointer"
                    >
                      + 1031 Exchange
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskTitle(`Review equity & reassessment schedule`)}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 hover:text-amber-300 cursor-pointer"
                    >
                      + Equity Review
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    {/* Task Title */}
                    <div className="sm:col-span-6 space-y-1">
                      <label className="text-[10px] font-mono text-slate-400">Task Title / Action</label>
                      <input
                        type="text"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder={`e.g. Follow up with ${activeContact?.name || 'lead'} on property offer`}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    {/* Task Type */}
                    <div className="sm:col-span-3 space-y-1">
                      <label className="text-[10px] font-mono text-slate-400">Task Type</label>
                      <select
                        value={taskType}
                        onChange={(e) => setTaskType(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                      >
                        <option value="call">📞 Follow-up Call</option>
                        <option value="email">✉️ Send Email / Info</option>
                        <option value="cma">📊 Prepare CMA Report</option>
                        <option value="offer">📄 Send Purchase Offer</option>
                        <option value="meeting">🤝 Meeting / Appt</option>
                        <option value="other">📌 Other Task</option>
                      </select>
                    </div>

                    {/* Priority */}
                    <div className="sm:col-span-3 space-y-1">
                      <label className="text-[10px] font-mono text-slate-400">Priority</label>
                      <select
                        value={taskPriority}
                        onChange={(e) => setTaskPriority(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                      >
                        <option value="high">🔴 High Priority</option>
                        <option value="medium">🟡 Medium Priority</option>
                        <option value="low">🔵 Low Priority</option>
                      </select>
                    </div>
                  </div>

                  {/* Due Date & Time */}
                  <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-900">
                    <div className="flex items-center space-x-2">
                      <label className="text-[10px] font-mono text-slate-400">Due Date:</label>
                      <input
                        type="date"
                        value={taskDueDate}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={(e) => setTaskDueDate(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <label className="text-[10px] font-mono text-slate-400">Time:</label>
                      <input
                        type="time"
                        value={taskDueTime}
                        onChange={(e) => setTaskDueTime(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                      />
                    </div>

                    {/* Quick Date Presets */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setTaskDueDate(getTomorrowDateStr())}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-300 hover:text-white cursor-pointer"
                      >
                        Tomorrow
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskDueDate(getDateOffsetStr(3))}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-300 hover:text-white cursor-pointer"
                      >
                        3 Days
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskDueDate(getDateOffsetStr(7))}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-300 hover:text-white cursor-pointer"
                      >
                        1 Week
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskDueDate(getDateOffsetStr(14))}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-300 hover:text-white cursor-pointer"
                      >
                        2 Weeks
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => handleDispoSubmit('INTERESTED')}
                  disabled={!activeCall}
                  className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center justify-center gap-1.5 cursor-pointer group"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Interested</span>
                  <kbd className="px-1 py-0.2 text-[9px] font-mono bg-emerald-800/80 rounded border border-emerald-400/40 text-emerald-100">
                    1
                  </kbd>
                </button>
                <button
                  onClick={() => handleDispoSubmit('NOT_INTERESTED')}
                  disabled={!activeCall}
                  className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-bold text-xs rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer group"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Not Interested</span>
                  <kbd className="px-1 py-0.2 text-[9px] font-mono bg-slate-900 rounded border border-slate-600 text-slate-400">
                    2
                  </kbd>
                </button>
                <button
                  onClick={() => {
                    // Auto open follow up task if selecting callback
                    if (!createFollowUpTask) setCreateFollowUpTask(true);
                    handleDispoSubmit('CALLBACK');
                  }}
                  disabled={!activeCall}
                  className="py-2.5 px-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center justify-center gap-1.5 cursor-pointer group"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Callback</span>
                  <kbd className="px-1 py-0.2 text-[9px] font-mono bg-amber-800/80 rounded border border-amber-400/40 text-amber-100">
                    3
                  </kbd>
                </button>
                <button
                  onClick={() => handleDispoSubmit('DNC')}
                  disabled={!activeCall}
                  className="py-2.5 px-3 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center justify-center gap-1.5 cursor-pointer group"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>DNC / Remove</span>
                  <kbd className="px-1 py-0.2 text-[9px] font-mono bg-rose-900/80 rounded border border-rose-400/40 text-rose-100">
                    4
                  </kbd>
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* Interactive Time-Series Performance & Disposition Analytics */}
      <DispositionBarChart
        sessionId={session?.id}
        initialStats={dispositionStats}
      />

      {/* Local Storage Upcoming Follow-up Reminders Widget */}
      {recentFollowUpTasks.filter(t => t.status === 'pending').length > 0 && (
        <div className="bg-slate-900/90 rounded-xl p-4 border border-amber-500/30 shadow-xl space-y-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <CalendarClock className="w-4 h-4 text-amber-400" />
              <h4 className="font-mono font-bold text-slate-200 text-xs uppercase tracking-wider">
                Upcoming Follow-up Reminders ({recentFollowUpTasks.filter(t => t.status === 'pending').length})
              </h4>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                Local Storage Reminders
              </span>
            </div>
            {onOpenTasks && (
              <button
                onClick={onOpenTasks}
                className="text-xs font-mono text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
              >
                <span>Open Tasks Drawer</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {recentFollowUpTasks
              .filter(t => t.status === 'pending')
              .slice(0, 3)
              .map((t) => (
                <div
                  key={t.id}
                  className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-amber-500/40 transition-colors flex flex-col justify-between space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-200 truncate">{t.taskTitle}</span>
                    <span
                      className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${
                        t.priority === 'high'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : t.priority === 'low'
                          ? 'bg-blue-950 text-blue-300 border border-blue-800'
                          : 'bg-amber-950 text-amber-300 border border-amber-800'
                      }`}
                    >
                      {t.priority}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                    <span>{t.contactName}</span>
                    <span className="text-amber-400/90 font-medium">Due: {t.dueDate}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Real-time FSM Event Audit Stream */}
      <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <h4 className="font-mono font-bold text-slate-200 text-xs uppercase tracking-wider">
              Real-time FSM Event Stream (<code className="text-indigo-400">call_events</code> Sequence Log)
            </h4>
          </div>
          <span className="text-[11px] font-mono text-slate-400">Authoritative Server Audit Log</span>
        </div>

        <div className="max-h-48 overflow-y-auto space-y-1.5 pr-2 font-mono text-xs">
          {recentEvents.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">No event logs emitted yet. Start dialing to see live FSM audit transitions.</p>
          ) : (
            recentEvents.slice(0, 15).map((evt) => (
              <div
                key={evt.id}
                className="p-2 rounded bg-slate-950 border border-slate-800/80 flex items-center justify-between text-[11px]"
              >
                <div className="flex items-center space-x-2">
                  <span className="text-indigo-400 font-bold">#{evt.id}</span>
                  <span className="text-slate-400">[{new Date(evt.created_at).toLocaleTimeString()}]</span>
                  <span className="text-rose-400">{evt.from_state}</span>
                  <span className="text-slate-500">➔</span>
                  <span className="text-emerald-400 font-bold">{evt.to_state}</span>
                  <span className="text-slate-400">({evt.event})</span>
                </div>
                <span className="text-slate-500 text-[10px] truncate max-w-xs">
                  call_id: {evt.call_id?.slice(0, 12)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
