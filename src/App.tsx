/**
 * Vortex One Dialer - Main Application
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { AgentWorkspace } from './components/AgentWorkspace';
import { CampaignManager } from './components/CampaignManager';
import { SuppressionManager } from './components/SuppressionManager';
import { SystemArchitectureView } from './components/SystemArchitectureView';
import { TelephonySettings } from './components/TelephonySettings';
import { AIChatDrawer } from './components/AIChatDrawer';
import { LiveVoiceModal } from './components/LiveVoiceModal';
import { SavedLeadsDrawer } from './components/SavedLeadsDrawer';
import { FollowUpTasksDrawer } from './components/FollowUpTasksDrawer';
import { KeyboardHelpModal } from './components/KeyboardHelpModal';
import { Call, Campaign, CampaignContact, DialingSession, SuppressionRecord, WSMessage, SessionDispositionStats } from './types/dialer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Keyboard } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('workspace');
  const [campaigns, setCampaigns] = useState<(Campaign & { counts?: any })[]>([]);
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [suppressionList, setSuppressionList] = useState<SuppressionRecord[]>([]);
  const [providers, setProviders] = useState<Array<{ name: string; isDefault: boolean; isConfigured: boolean }>>([
    { name: 'mock', isDefault: true, isConfigured: true },
    { name: 'ringcentral', isDefault: false, isConfigured: false },
  ]);
  const [activeSession, setActiveSession] = useState<DialingSession | null>(null);
  const [activeCalls, setActiveCalls] = useState<(Call & { contactName?: string; contactMetadata?: any })[]>([]);
  const [activeContact, setActiveContact] = useState<CampaignContact | null>(null);
  const [dispositionStats, setDispositionStats] = useState<SessionDispositionStats | null>(null);
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [queueCounts, setQueueCounts] = useState({ total: 0, pending: 0, completed: 0, dialing: 0, dnc: 0 });
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [ws, setWs] = useState<WebSocket | null>(null);

  // Modals & Drawers state
  const [isAIChatOpen, setIsAIChatOpen] = useState<boolean>(false);
  const [isLiveVoiceOpen, setIsLiveVoiceOpen] = useState<boolean>(false);
  const [isSavedLeadsOpen, setIsSavedLeadsOpen] = useState<boolean>(false);
  const [isTasksOpen, setIsTasksOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);

  const orgId = 'org_cmc_realty_01';

  // 1. Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      const [campRes, suppRes, provRes, evRes] = await Promise.all([
        fetch(`/api/v1/dialer/campaigns?org_id=${orgId}`).then((r) => r.json()),
        fetch(`/api/v1/dialer/suppression?org_id=${orgId}`).then((r) => r.json()),
        fetch('/api/v1/dialer/providers').then((r) => r.json()),
        fetch('/api/v1/dialer/events?limit=30').then((r) => r.json()),
      ]);

      if (campRes.campaigns) {
        setCampaigns(campRes.campaigns);
        if (campRes.campaigns[0]) {
          const cRes = await fetch(`/api/v1/dialer/campaigns/${campRes.campaigns[0].id}/contacts`).then((r) => r.json());
          if (cRes.contacts) {
            setContacts(cRes.contacts);
            // Default active contact preview
            setActiveContact(cRes.contacts[0] || null);
          }
          if (campRes.campaigns[0].counts) {
            setQueueCounts(campRes.campaigns[0].counts);
          }
        }
      }

      if (suppRes.suppression_list) {
        setSuppressionList(suppRes.suppression_list);
      }

      if (provRes.providers) {
        setProviders(provRes.providers);
      }

      if (evRes.events) {
        setRecentEvents(evRes.events);
      }
    } catch (err) {
      console.warn('API fetch warning:', err);
    }
  }, [orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 2. Setup WebSocket Connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setIsWsConnected(true);
        if (activeSession) {
          socket.send(JSON.stringify({ action: 'subscribe', sessionId: activeSession.id, organizationId: orgId }));
        }
      };

      socket.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          if (msg.type === 'SESSION_STATE') {
            if (msg.payload.session) setActiveSession(msg.payload.session);
            if (msg.payload.activeCalls) setActiveCalls(msg.payload.activeCalls);
            if (msg.payload.dispositionStats) setDispositionStats(msg.payload.dispositionStats);
          } else if (msg.type === 'ACTIVE_CONTACT') {
            if (msg.payload.contact) setActiveContact(msg.payload.contact);
          } else if (msg.type === 'QUEUE_UPDATE') {
            setQueueCounts(msg.payload);
          }
          // Refresh event logs
          fetch('/api/v1/dialer/events?limit=20')
            .then((r) => r.json())
            .then((d) => d.events && setRecentEvents(d.events))
            .catch(() => {});
        } catch (e) {
          // ignore
        }
      };

      socket.onclose = () => {
        setIsWsConnected(false);
      };

      socket.onerror = () => {
        setIsWsConnected(false);
      };

      setWs(socket);
    } catch (e) {
      setIsWsConnected(false);
    }

    return () => {
      if (socket) socket.close();
    };
  }, [activeSession?.id]);

  // 3. Handlers
  const handleStartSession = async (lines: number) => {
    if (campaigns.length === 0) return;
    const campaignId = campaigns[0].id;

    try {
      const res = await fetch('/api/v1/dialer/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: orgId,
          campaign_id: campaignId,
          agent_id: 'usr_kristina_01',
          requested_lines: lines,
        }),
      });
      const data = await res.json();
      if (data.session_id) {
        // Fetch session status
        const sessRes = await fetch(`/api/v1/dialer/sessions/${data.session_id}`).then((r) => r.json());
        if (sessRes.session) setActiveSession(sessRes.session);
        if (sessRes.active_calls) setActiveCalls(sessRes.active_calls);
        if (sessRes.queue_counts) setQueueCounts(sessRes.queue_counts);
        if (sessRes.disposition_stats) setDispositionStats(sessRes.disposition_stats);

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'subscribe', sessionId: data.session_id, organizationId: orgId }));
        }
      }
    } catch (err) {
      console.error('Failed to start session:', err);
    }
  };

  const handlePauseSession = async () => {
    if (!activeSession) return;
    await fetch(`/api/v1/dialer/sessions/${activeSession.id}/pause`, { method: 'POST' });
    setActiveSession({ ...activeSession, status: 'paused' });
  };

  const handleResumeSession = async () => {
    if (!activeSession) return;
    await fetch(`/api/v1/dialer/sessions/${activeSession.id}/resume`, { method: 'POST' });
    setActiveSession({ ...activeSession, status: 'active' });
    fetchData();
  };

  const handleEndSession = async () => {
    if (!activeSession) return;
    await fetch(`/api/v1/dialer/sessions/${activeSession.id}/end`, { method: 'POST' });
    setActiveSession(null);
    setActiveCalls([]);
    fetchData();
  };

  const handleChangeLines = async (lines: number) => {
    if (!activeSession) return;
    await fetch(`/api/v1/dialer/sessions/${activeSession.id}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines_count: lines }),
    });
    setActiveSession({ ...activeSession, lines_count: lines });
  };

  const handleSubmitDisposition = async (callId: string, dispo: any) => {
    try {
      await fetch(`/api/v1/dialer/calls/${callId}/disposition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dispo),
      });
      fetchData();
    } catch (err) {
      console.error('Failed to submit disposition:', err);
    }
  };

  const handleSimulateEvent = async (callId: string, eventType: string) => {
    try {
      await fetch('/api/v1/dialer/simulate-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: callId, event_type: eventType }),
      });
      fetchData();
    } catch (err) {
      console.error('Failed to simulate event:', err);
    }
  };

  const handleDispatchNext = async () => {
    if (!activeSession) return;
    await fetch(`/api/v1/dialer/sessions/${activeSession.id}/resume`, { method: 'POST' });
    fetchData();
  };

  const handleIngestCampaign = async (campaignData: any) => {
    try {
      await fetch('/api/v1/dialer/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaignData),
      });
      fetchData();
      setActiveTab('workspace');
    } catch (err) {
      console.error('Failed to ingest campaign:', err);
    }
  };

  const handleAddSuppression = async (phone: string, reason: string) => {
    try {
      await fetch('/api/v1/dialer/suppression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId, phone, reason }),
      });
      fetchData();
    } catch (err) {
      console.error('Failed to add suppression:', err);
    }
  };

  const handleSelectProvider = async (name: string) => {
    try {
      await fetch('/api/v1/dialer/providers/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      fetchData();
    } catch (err) {
      console.error('Failed to select provider:', err);
    }
  };

  // Find active call for disposition / detail
  const currentConnectedCall = activeCalls.find(
    (c) => c.state === 'CONNECTED' || c.state === 'DISPO_PENDING'
  ) || activeCalls[0] || null;

  // Global Keyboard Shortcuts (Space, D, ?, C, L, S, Alt+1-5, Esc)
  useKeyboardShortcuts({
    onToggleHelp: () => setIsHelpOpen((prev) => !prev),
    onCloseModal: () => {
      if (isHelpOpen) setIsHelpOpen(false);
      else if (isAIChatOpen) setIsAIChatOpen(false);
      else if (isLiveVoiceOpen) setIsLiveVoiceOpen(false);
      else if (isSavedLeadsOpen) setIsSavedLeadsOpen(false);
    },
    onToggleAIChat: () => setIsAIChatOpen((prev) => !prev),
    onToggleLiveVoice: () => setIsLiveVoiceOpen((prev) => !prev),
    onToggleSavedLeads: () => setIsSavedLeadsOpen((prev) => !prev),
    onSelectTab: (tab) => setActiveTab(tab),
    onTogglePauseResume: () => {
      if (!activeSession) {
        handleStartSession(3);
      } else if (activeSession.status === 'paused') {
        handleResumeSession();
      } else {
        handlePauseSession();
      }
    },
    onTriggerDisposition: () => {
      if (currentConnectedCall) {
        // Trigger disposition flow for current active call
        handleSubmitDisposition(currentConnectedCall.id, {
          disposition_code: 'INTERESTED',
          notes: 'Quick dispo submitted via shortcut key [D]',
        });
      }
    },
    enabled: true,
  });

  const defaultProvider = providers.find((p) => p.isDefault)?.name || 'mock';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-600 selection:text-white relative">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeSession={activeSession}
        isConnected={isWsConnected}
        providerName={defaultProvider}
        onOpenAIChat={() => setIsAIChatOpen(true)}
        onOpenLiveVoice={() => setIsLiveVoiceOpen(true)}
        onOpenSavedLeads={() => setIsSavedLeadsOpen(true)}
        onOpenTasks={() => setIsTasksOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {activeTab === 'workspace' && (
          <AgentWorkspace
            session={activeSession}
            activeCalls={activeCalls}
            activeContact={activeContact}
            activeCall={currentConnectedCall}
            queueCounts={queueCounts}
            onStartSession={handleStartSession}
            onPauseSession={handlePauseSession}
            onResumeSession={handleResumeSession}
            onEndSession={handleEndSession}
            onChangeLines={handleChangeLines}
            onSubmitDisposition={handleSubmitDisposition}
            onSimulateEvent={handleSimulateEvent}
            onDispatchNext={handleDispatchNext}
            onOpenTasks={() => setIsTasksOpen(true)}
            onAddSuppression={handleAddSuppression}
            dispositionStats={dispositionStats}
            recentEvents={recentEvents}
          />
        )}

        {activeTab === 'campaigns' && (
          <CampaignManager
            campaigns={campaigns}
            contacts={contacts}
            onIngestCampaign={handleIngestCampaign}
          />
        )}

        {activeTab === 'suppression' && (
          <SuppressionManager
            suppressionList={suppressionList}
            onAddSuppression={handleAddSuppression}
          />
        )}

        {activeTab === 'architecture' && <SystemArchitectureView />}

        {activeTab === 'telephony' && (
          <TelephonySettings
            providers={providers}
            onSelectProvider={handleSelectProvider}
            onRefreshHealth={fetchData}
          />
        )}
      </main>

      {/* Floating Keyboard Shortcuts Trigger Button */}
      <button
        onClick={() => setIsHelpOpen(true)}
        className="fixed bottom-14 sm:bottom-6 right-4 sm:right-6 z-30 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 hover:border-indigo-500/50 shadow-xl backdrop-blur-md transition-all text-xs font-mono group cursor-pointer"
        title="Keyboard Shortcuts & Onboarding Guide (Press '?')"
      >
        <Keyboard className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
        <span className="hidden md:inline font-sans font-medium text-slate-300">Shortcuts</span>
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-800 border border-slate-700 rounded text-indigo-300 group-hover:border-indigo-500/50">
          ?
        </kbd>
      </button>

      {/* Persistent AI & Firestore Modals/Drawers */}
      <KeyboardHelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />

      <AIChatDrawer
        isOpen={isAIChatOpen}
        onClose={() => setIsAIChatOpen(false)}
        activeContact={activeContact}
        activeCall={currentConnectedCall}
      />

      <LiveVoiceModal
        isOpen={isLiveVoiceOpen}
        onClose={() => setIsLiveVoiceOpen(false)}
        activeContact={activeContact}
      />

      <SavedLeadsDrawer
        isOpen={isSavedLeadsOpen}
        onClose={() => setIsSavedLeadsOpen(false)}
      />

      <FollowUpTasksDrawer
        isOpen={isTasksOpen}
        onClose={() => setIsTasksOpen(false)}
      />

      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 py-5 text-center text-xs mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-slate-200">Vortex One Dialer Engine</span>
            <span>•</span>
            <span className="text-slate-400">PostgreSQL + Authoritative FSM + Multi-Line + Gemini AI</span>
          </div>
          <div className="font-mono text-slate-500 text-[11px]">
            Tenant: CMC Realty Partners (Orange County FIPS 06059)
          </div>
        </div>
      </footer>
    </div>
  );
}
