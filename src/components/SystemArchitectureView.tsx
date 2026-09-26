import React, { useState } from 'react';
import { Cpu, Database, Network, FileCode, CheckCircle2, Shield, ArrowRight } from 'lucide-react';

export const SystemArchitectureView: React.FC = () => {
  const [selectedTable, setSelectedTable] = useState<string>('organizations');
  const [selectedApi, setSelectedApi] = useState<string>('campaign_ingest');
  const [activeSubTab, setActiveSubTab] = useState<'architecture' | 'schema' | 'fsm' | 'api'>('architecture');

  const schemas: Record<string, { category: string; desc: string; sql: string; indexes: string }> = {
    organizations: {
      category: 'Root Multi-Tenant Scope',
      desc: 'Root organization table for tenant segregation (e.g. CMC Realty).',
      sql: `CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
      indexes: 'PRIMARY KEY (id)',
    },
    users: {
      category: 'Auth & Identity',
      desc: 'Stores user accounts and roles (admin, supervisor, agent) within an organization.',
      sql: `CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'supervisor', 'agent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
      indexes: 'PRIMARY KEY (id), UNIQUE (email), INDEX (organization_id)',
    },
    campaigns: {
      category: 'Dialing Configuration',
      desc: 'Defines dialing settings, multi-line capacity (1-4 lines), and dial mode.',
      sql: `CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    lines_per_agent INT NOT NULL DEFAULT 1 CHECK (lines_per_agent BETWEEN 1 AND 4),
    dial_mode VARCHAR(50) NOT NULL DEFAULT 'power',
    skip_dnc BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
      indexes: 'PRIMARY KEY (id), INDEX (organization_id)',
    },
    campaign_contacts: {
      category: 'Queue Repository',
      desc: 'Stores contact records ingested from Vortex CRM with parcel APN and equity metadata.',
      sql: `CREATE TABLE campaign_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    external_contact_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb, -- APN, Address, Equity
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    last_dialed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
      indexes: 'INDEX (campaign_id, status, attempts), INDEX (phone)',
    },
    calls: {
      category: 'Telephony Call Records',
      desc: 'Represents individual phone calls placed via telephony providers.',
      sql: `CREATE TABLE calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES dialing_sessions(id) ON DELETE CASCADE,
    campaign_contact_id UUID NOT NULL REFERENCES campaign_contacts(id),
    provider_name VARCHAR(50) NOT NULL,
    provider_call_id VARCHAR(255),
    line_number INT NOT NULL DEFAULT 1,
    phone_dialed VARCHAR(50) NOT NULL,
    state VARCHAR(50) NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 0,
    disposition_code VARCHAR(100),
    agent_notes TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
      indexes: 'PRIMARY KEY (id), INDEX (provider_call_id), INDEX (session_id)',
    },
    call_events: {
      category: 'FSM Immutable Audit Trail',
      desc: 'Sequence-ordered log of every FSM transition with full payload snapshots.',
      sql: `CREATE TABLE call_events (
    id BIGSERIAL PRIMARY KEY,
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    from_state VARCHAR(50) NOT NULL,
    to_state VARCHAR(50) NOT NULL,
    event VARCHAR(100) NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
      indexes: 'PRIMARY KEY (id), INDEX (call_id, id ASC)',
    },
    suppression_list: {
      category: 'DNC Compliance Guard',
      desc: 'Organization-level Do Not Call list to prevent dialing prohibited numbers.',
      sql: `CREATE TABLE suppression_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone VARCHAR(50) NOT NULL,
    reason VARCHAR(100) DEFAULT 'DNC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_suppression_org_phone UNIQUE (organization_id, phone)
);`,
      indexes: 'UNIQUE (organization_id, phone)',
    },
  };

  const apis: Record<string, { title: string; method: string; endpoint: string; desc: string; payload: string }> = {
    campaign_ingest: {
      title: 'Campaign Ingestion',
      method: 'POST',
      endpoint: '/api/v1/dialer/campaigns',
      desc: 'Ingests a lead batch with parcel APN and equity metadata from Vortex CRM into a dialer campaign queue.',
      payload: `{
  "organization_id": "org_cmc_realty_01",
  "campaign_name": "Orange County High Equity Owners",
  "dial_settings": {
    "lines_per_agent": 3,
    "dial_mode": "power",
    "skip_dnc": true
  },
  "contacts": [
    {
      "external_contact_id": "vortex_prop_991823",
      "name": "John & Martha Smith",
      "phone": "+15625551234",
      "metadata": {
        "apn": "580-081-01",
        "property_address": "123 Main St, Anaheim, CA",
        "estimated_equity": "$485,000",
        "owner_type": "Absentee Owner"
      }
    }
  ]
}`,
    },
    session_start: {
      title: 'Start Dialing Session',
      method: 'POST',
      endpoint: '/api/v1/dialer/sessions/start',
      desc: 'Locks agent into active campaign queue and begins multi-line parallel dispatch engine.',
      payload: `{
  "organization_id": "org_cmc_realty_01",
  "campaign_id": "cmp_oc_high_equity_01",
  "agent_id": "usr_kristina_01",
  "requested_lines": 3
}`,
    },
    disposition: {
      title: 'Submit Call Disposition',
      method: 'POST',
      endpoint: '/api/v1/dialer/calls/{id}/disposition',
      desc: 'Authoritatively transitions call from DISPO_PENDING to TERMINATED, saves agent notes, and advances queue.',
      payload: `{
  "disposition_code": "INTERESTED",
  "notes": "Owner agreed to property valuation review next Tuesday.",
  "add_to_dnc": false,
  "follow_up_date": "2026-08-28T14:00:00Z"
}`,
    },
  };

  return (
    <div className="space-y-6">
      {/* Sub navigation buttons */}
      <div className="flex space-x-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveSubTab('architecture')}
          className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition-colors ${
            activeSubTab === 'architecture' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Topology & Architecture
        </button>
        <button
          onClick={() => setActiveSubTab('schema')}
          className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition-colors ${
            activeSubTab === 'schema' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          PostgreSQL DDL Schemas
        </button>
        <button
          onClick={() => setActiveSubTab('fsm')}
          className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition-colors ${
            activeSubTab === 'fsm' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Call FSM Transition Matrix
        </button>
        <button
          onClick={() => setActiveSubTab('api')}
          className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition-colors ${
            activeSubTab === 'api' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          REST & WebSocket Contracts
        </button>
      </div>

      {/* 1. TOPOLOGY & ARCHITECTURE */}
      {activeSubTab === 'architecture' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-lg font-bold text-slate-900">Vortex One Standalone Dialer Architecture</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Decouples telephony execution from CRM domain logic. Ingests generic lead batches, manages multi-line dialing (1-4 lines), enforces pre-dial DNC suppression, and logs sequence-ordered audit events.
            </p>
          </div>

          <div className="bg-slate-900 text-white rounded-xl p-6 border border-slate-800 shadow-xl space-y-6 font-mono text-xs">
            {/* Layer 1: CRM Parent */}
            <div className="bg-slate-800 p-4 rounded-xl border border-indigo-500/50 text-center space-y-1">
              <span className="text-[10px] text-indigo-400 font-bold uppercase">Parent Platform</span>
              <h4 className="font-bold text-white text-sm">VORTEX ONE PLATFORM (Property CRM & Lead Gen)</h4>
              <p className="text-[11px] text-slate-300">Property Search • APN Resolution • Absentee Owners • Lead Scoring</p>
            </div>

            <div className="text-center text-slate-500">
              ▼ REST Campaign Ingestion / Webhook Sync
            </div>

            {/* Layer 2: Standalone Service Core */}
            <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-emerald-400">VORTEX ONE DIALER SERVICE CORE</span>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/20">PORT 3000 / WS</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <span className="text-indigo-400 font-bold block mb-1">REST & WS Gateway</span>
                  <p className="text-slate-400">Agent session dispatch, real-time WebSocket state streaming.</p>
                </div>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <span className="text-indigo-400 font-bold block mb-1">Authoritative Call FSM</span>
                  <p className="text-slate-400">Strict Finite State Machine & immutable audit logs in call_events.</p>
                </div>
                <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <span className="text-indigo-400 font-bold block mb-1">Multi-Line Dial Engine</span>
                  <p className="text-slate-400">1-4 lines parallel dial, DNC suppression check, auto-cancel on answer.</p>
                </div>
              </div>
            </div>

            <div className="text-center text-slate-500">
              ▼ ITelephonyProvider Abstraction
            </div>

            {/* Layer 3: Providers */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center space-y-1">
                <span className="text-emerald-400 font-bold text-xs uppercase block">MockTelephonyProvider</span>
                <p className="text-[11px] text-slate-400">Deterministic simulator for ringing, pickups, busy, timeouts & delays.</p>
              </div>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center space-y-1">
                <span className="text-amber-400 font-bold text-xs uppercase block">RingCentralProvider</span>
                <p className="text-[11px] text-slate-400">Production adapter for RingCentral RingOut & Telephony Webhooks.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. POSTGRESQL DDL SCHEMAS */}
      {activeSubTab === 'schema' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-2">
            <h4 className="font-bold text-slate-900 text-xs font-mono uppercase tracking-wider border-b border-slate-100 pb-2">
              Database Tables
            </h4>
            {Object.keys(schemas).map((t) => (
              <button
                key={t}
                onClick={() => setSelectedTable(t)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono font-medium transition-colors ${
                  selectedTable === t
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                }`}
              >
                tbl_{t}
              </button>
            ))}
          </div>

          <div className="lg:col-span-8 bg-slate-900 text-slate-100 rounded-xl p-6 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="font-bold font-mono text-emerald-400 text-base">{selectedTable}</span>
                <span className="text-xs text-slate-400 block font-mono">{schemas[selectedTable].category}</span>
              </div>
              <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2.5 py-1 rounded border border-slate-700">
                PostgreSQL SQL
              </span>
            </div>

            <p className="text-xs text-slate-300">{schemas[selectedTable].desc}</p>

            <div className="bg-slate-950 p-4 rounded-lg font-mono text-xs text-slate-200 overflow-x-auto border border-slate-800">
              <pre><code>{schemas[selectedTable].sql}</code></pre>
            </div>

            <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2.5 rounded border border-slate-800">
              Indexes: <strong className="text-indigo-300">{schemas[selectedTable].indexes}</strong>
            </div>
          </div>
        </div>
      )}

      {/* 3. CALL FSM MATRIX */}
      {activeSubTab === 'fsm' && (
        <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-base">Authoritative Call Finite State Machine (FSM) Matrix</h3>
          <p className="text-xs text-slate-500">
            Every call follows strict deterministic paths. Race conditions and orphan calls are eliminated by server-authoritative state checks.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-mono uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="p-3">Current State</th>
                  <th className="p-3">Target State</th>
                  <th className="p-3">Trigger Event</th>
                  <th className="p-3">System Action & Side Effects</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                <tr>
                  <td className="p-3 font-bold text-slate-900">INITIATED</td>
                  <td className="p-3 text-indigo-600 font-bold">DIALING</td>
                  <td className="p-3">DISPATCH</td>
                  <td className="p-3">Place outbound call via provider adapter API</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-slate-900">DIALING</td>
                  <td className="p-3 text-amber-600 font-bold">RINGING</td>
                  <td className="p-3">RECV_RINGING</td>
                  <td className="p-3">Emit real-time WebSocket update to Agent Workspace</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-slate-900">DIALING</td>
                  <td className="p-3 text-rose-600 font-bold">BUSY / FAILED</td>
                  <td className="p-3">RECV_BUSY / RECV_FAILED</td>
                  <td className="p-3">Drop line, mark contact retry/invalid, advance queue</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-slate-900">RINGING</td>
                  <td className="p-3 text-emerald-600 font-bold">CONNECTED</td>
                  <td className="p-3">RECV_ANSWERED</td>
                  <td className="p-3">Cancel parallel ringing lines, route audio stream to agent</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-slate-900">RINGING</td>
                  <td className="p-3 text-amber-600 font-bold">NO_ANSWER</td>
                  <td className="p-3">TIMEOUT_NO_ANSWER</td>
                  <td className="p-3">Ringing timeout exceeded, mark contact retry, advance queue</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-slate-900">CONNECTED</td>
                  <td className="p-3 text-indigo-600 font-bold">DISPO_PENDING</td>
                  <td className="p-3">HANGUP</td>
                  <td className="p-3">Call audio concluded, lock agent panel, prompt for disposition</td>
                </tr>
                <tr>
                  <td className="p-3 font-bold text-slate-900">DISPO_PENDING</td>
                  <td className="p-3 text-slate-900 font-bold">TERMINATED</td>
                  <td className="p-3">SUBMIT_DISPO</td>
                  <td className="p-3">Record disposition in DB, seal sequence log, advance queue</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. REST & WS SPECIFICATION */}
      {activeSubTab === 'api' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-2">
            <h4 className="font-bold text-slate-900 text-xs font-mono uppercase tracking-wider border-b border-slate-100 pb-2">
              REST Endpoints
            </h4>
            {Object.keys(apis).map((k) => (
              <button
                key={k}
                onClick={() => setSelectedApi(k)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                  selectedApi === k
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                }`}
              >
                <span className="text-emerald-600 font-bold mr-1.5">{apis[k].method}</span>
                <span>{apis[k].title}</span>
              </button>
            ))}
          </div>

          <div className="lg:col-span-8 bg-slate-900 text-slate-100 rounded-xl p-6 border border-slate-800 shadow-xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-emerald-400 font-bold mr-2">{apis[selectedApi].method}</span>
                <span className="text-slate-100 font-bold">{apis[selectedApi].endpoint}</span>
              </div>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                JSON Payload
              </span>
            </div>

            <p className="text-slate-400 font-sans text-xs">{apis[selectedApi].desc}</p>

            <div className="bg-slate-950 p-4 rounded-lg text-slate-200 overflow-x-auto border border-slate-800 max-h-80">
              <pre><code>{apis[selectedApi].payload}</code></pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
