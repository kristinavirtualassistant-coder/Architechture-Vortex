/**
 * Vortex One Cloud Saved Leads & Persistence Drawer
 * Backed by Firebase Firestore.
 */

import React, { useEffect, useState } from 'react';
import {
  Cloud,
  Trash2,
  X,
  Building,
  Phone,
  Calendar,
  ExternalLink,
  RefreshCw,
  Plus,
  CheckCircle,
  Database,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SavedLeadsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLead?: (lead: any) => void;
}

export const SavedLeadsDrawer: React.FC<SavedLeadsDrawerProps> = ({
  isOpen,
  onClose,
  onSelectLead,
}) => {
  const { user, getCloudSavedLeads, deleteCloudLead, signInWithGoogle } = useAuth();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchLeads = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getCloudSavedLeads();
      setLeads(data);
    } catch (err) {
      console.error('Error fetching leads:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && user) {
      fetchLeads();
    }
  }, [isOpen, user]);

  const handleDelete = async (id: string) => {
    try {
      await deleteCloudLead(id);
      setLeads((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-slate-900 border-l border-slate-700/80 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-white text-sm">Firestore Saved Leads</h3>
            <p className="text-xs text-slate-400 font-mono">Durable Cloud Database Persistence</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {!user ? (
          <div className="p-6 bg-slate-950/80 border border-slate-800 rounded-xl text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center mx-auto">
              <UserCheck className="w-6 h-6" />
            </div>
            <h4 className="font-bold text-white text-sm">Sign in for Cloud Sync</h4>
            <p className="text-xs text-slate-400">
              Sign in with your Google account via Firebase Auth to persist property intelligence leads and dispositions across sessions.
            </p>
            <button
              onClick={signInWithGoogle}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs font-mono transition-colors shadow-lg shadow-indigo-600/20"
            >
              Sign In with Google
            </button>
          </div>
        ) : loading ? (
          <div className="h-48 flex flex-col items-center justify-center text-slate-400 text-xs font-mono space-y-2">
            <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
            <span>Loading leads from Firestore...</span>
          </div>
        ) : leads.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs font-mono space-y-2">
            <Cloud className="w-8 h-8 mx-auto text-slate-600" />
            <div>No saved leads in your Firestore collection yet.</div>
            <p className="text-[11px] text-slate-600">
              Click &quot;Save to Cloud&quot; on any active contact in your dialer workspace.
            </p>
          </div>
        ) : (
          leads.map((lead) => (
            <div
              key={lead.id}
              className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl hover:border-slate-700 transition-all space-y-2"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-slate-100 text-sm">{lead.contactName || 'Lead'}</h4>
                  <div className="flex items-center space-x-1.5 text-xs text-indigo-400 font-mono mt-0.5">
                    <Phone className="w-3 h-3" />
                    <span>{lead.phone}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(lead.id)}
                  className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                  title="Delete from Firestore"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {lead.propertyAddress && (
                <div className="flex items-center space-x-1 text-xs text-slate-300 font-sans">
                  <Building className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">{lead.propertyAddress}</span>
                </div>
              )}

              {lead.notes && (
                <div className="text-xs text-slate-400 bg-slate-900/80 p-2 rounded-lg border border-slate-800/80 font-sans italic">
                  &quot;{lead.notes}&quot;
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/60">
                <span>Disposition: <strong className="text-slate-300">{lead.dispositionCode || 'SAVED'}</strong></span>
                <span>{new Date(lead.savedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-3 bg-slate-950 border-t border-slate-800 text-center text-[11px] font-mono text-slate-500">
        Firestore Collection: <span className="text-slate-400">users/{user?.uid || 'guest'}/saved_leads</span>
      </div>
    </div>
  );
};
