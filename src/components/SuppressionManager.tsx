import React, { useState } from 'react';
import { Shield, Plus, AlertTriangle, CheckCircle2, Phone } from 'lucide-react';
import { SuppressionRecord } from '../types/dialer';

interface SuppressionManagerProps {
  suppressionList: SuppressionRecord[];
  onAddSuppression: (phone: string, reason: string) => void;
}

export const SuppressionManager: React.FC<SuppressionManagerProps> = ({
  suppressionList,
  onAddSuppression,
}) => {
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('Agent Requested DNC');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    onAddSuppression(phone, reason);
    setPhone('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Shield className="w-5 h-5 text-rose-600" />
          <span>DNC Suppression Guard & Compliance Repository</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Authoritative organization-level Do Not Call (DNC) list. Numbers registered here are filtered pre-dial before telephony provider dispatch.
        </p>
      </div>

      {/* Grid: Add Form & Compliance Guarantees */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Form Card */}
        <div className="lg:col-span-5 bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-indigo-600" /> Add Phone to DNC Suppression
          </h3>

          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Phone Number</label>
              <input
                type="text"
                required
                placeholder="e.g. +17145559999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-300 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Suppression Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white"
              >
                <option value="Agent Requested DNC">Agent Requested DNC</option>
                <option value="National DNC Registry">National DNC Registry</option>
                <option value="Litigator / High Risk">Litigator / High Risk</option>
                <option value="Wrong Contact / Deceased">Wrong Contact / Deceased</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition-colors shadow"
            >
              Block Phone Number
            </button>
          </form>
        </div>

        {/* Compliance Guarantees Card */}
        <div className="lg:col-span-7 bg-slate-900 text-white rounded-xl p-5 border border-slate-800 shadow-xl space-y-3">
          <div className="flex items-center space-x-2 text-rose-400 font-mono text-xs font-bold uppercase">
            <AlertTriangle className="w-4 h-4" />
            <span>Strict Compliance Guarantees</span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            The multi-line dialing engine executes a strict lookup against this table <strong>before</strong> building outbound provider call requests. If a record matches, the contact status is marked <code className="text-rose-400 font-bold">DNC</code> and the telephony provider is never contacted.
          </p>

          <div className="grid grid-cols-2 gap-3 pt-2 font-mono text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[10px]">Active Suppressed Numbers</span>
              <span className="font-bold text-rose-400 text-lg">{suppressionList.length}</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[10px]">Pre-Dial Interception</span>
              <span className="font-bold text-emerald-400 text-lg">100% Enforced</span>
            </div>
          </div>
        </div>

      </div>

      {/* Suppression List Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-5 space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">Active Organization Suppression Records</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-mono uppercase tracking-wider border-y border-slate-200">
              <tr>
                <th className="p-3">Suppressed Phone</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Registered Date</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {suppressionList.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-4 text-slate-400 italic">
                    No numbers currently suppressed.
                  </td>
                </tr>
              ) : (
                suppressionList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-900 text-xs">{s.phone}</td>
                    <td className="p-3 text-slate-600">{s.reason}</td>
                    <td className="p-3 text-slate-400">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                        BLOCKED
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
