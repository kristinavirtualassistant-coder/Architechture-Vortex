import React, { useState } from 'react';
import { Settings, Phone, CheckCircle2, AlertCircle, RefreshCw, Key, ShieldCheck } from 'lucide-react';

interface TelephonySettingsProps {
  providers: Array<{ name: string; isDefault: boolean; isConfigured: boolean }>;
  onSelectProvider: (name: string) => void;
  onRefreshHealth: () => void;
}

export const TelephonySettings: React.FC<TelephonySettingsProps> = ({
  providers,
  onSelectProvider,
  onRefreshHealth,
}) => {
  const [selected, setSelected] = useState(
    providers.find((p) => p.isDefault)?.name || 'mock'
  );
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = () => {
    onSelectProvider(selected);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-indigo-600" />
          <span>Telephony Driver Configuration & Providers</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Manage telephony drivers under the <code className="font-mono text-indigo-600">ITelephonyProvider</code> abstraction layer.
        </p>
      </div>

      {/* Provider Selector Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <div className="lg:col-span-6 bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Active Telephony Driver</h3>

          <div className="space-y-3">
            {providers.map((p) => (
              <label
                key={p.name}
                className={`p-4 rounded-xl border flex items-start justify-between cursor-pointer transition-all ${
                  selected === p.name
                    ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-start space-x-3">
                  <input
                    type="radio"
                    name="telephony_provider"
                    value={p.name}
                    checked={selected === p.name}
                    onChange={() => setSelected(p.name)}
                    className="mt-1 text-indigo-600 focus:ring-0"
                  />
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-900 text-sm capitalize">
                        {p.name === 'mock' ? 'Mock Deterministic Simulator' : 'RingCentral Production Driver'}
                      </span>
                      {p.isDefault && (
                        <span className="text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {p.name === 'mock'
                        ? 'Simulates ringing, pickups, busy signals, failures, timeouts, and delays for full FSM testing without live telephony costs.'
                        : 'Connects to RingCentral REST RingOut & Telephony Webhook events.'}
                    </p>
                  </div>
                </div>

                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded whitespace-nowrap ${
                    p.isConfigured
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {p.isConfigured ? 'READY' : 'UNCONFIGURED'}
                </span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleSave}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-colors shadow"
            >
              Switch Telephony Driver
            </button>
            {saveSuccess && (
              <span className="text-xs font-mono text-emerald-600 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Driver updated!
              </span>
            )}
          </div>
        </div>

        {/* RingCentral Credentials & Environment Docs */}
        <div className="lg:col-span-6 bg-slate-900 text-white rounded-xl p-5 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-center space-x-2 text-indigo-400 font-mono text-xs font-bold uppercase">
            <Key className="w-4 h-4" />
            <span>Environment Variable Wiring</span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            RingCentral production credentials are read securely from server-side environment variables without exposing secrets to browser code.
          </p>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 space-y-1.5 overflow-x-auto">
            <div><span className="text-slate-500">RINGCENTRAL_CLIENT_ID</span>=<span className="text-emerald-400">"..."</span></div>
            <div><span className="text-slate-500">RINGCENTRAL_CLIENT_SECRET</span>=<span className="text-emerald-400">"..."</span></div>
            <div><span className="text-slate-500">RINGCENTRAL_SERVER_URL</span>=<span className="text-amber-400">"https://platform.devtest.ringcentral.com"</span></div>
            <div><span className="text-slate-500">RINGCENTRAL_JWT</span>=<span className="text-emerald-400">"..."</span></div>
          </div>

          <div className="pt-2 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span>Webhook Endpoint:</span>
            <code className="text-indigo-400 font-mono text-[11px]">/api/v1/dialer/webhooks/ringcentral</code>
          </div>
        </div>

      </div>
    </div>
  );
};
