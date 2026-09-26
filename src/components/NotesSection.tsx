import React, { useState, useEffect } from 'react';
import { FileText, Send, Clock, User, Check, AlertCircle, Sparkles } from 'lucide-react';
import { CallNote } from '../types/dialer';

interface NotesSectionProps {
  callId?: string;
  contactName?: string;
  initialNotes?: string;
  onNoteAdded?: (note: CallNote) => void;
}

export const NotesSection: React.FC<NotesSectionProps> = ({
  callId,
  contactName,
  initialNotes,
  onNoteAdded,
}) => {
  const [notesHistory, setNotesHistory] = useState<CallNote[]>([]);
  const [newNoteText, setNewNoteText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Fetch notes history when callId changes
  useEffect(() => {
    if (!callId) {
      setNotesHistory([]);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    fetch(`/api/v1/calls/${callId}/notes`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load notes');
        return res.json();
      })
      .then((data) => {
        if (isMounted && data.notes) {
          setNotesHistory(data.notes);
        }
      })
      .catch(() => {
        // If empty or initial notes exist
        if (isMounted && initialNotes) {
          setNotesHistory([
            {
              id: 'init_note',
              call_id: callId,
              author: 'Agent',
              text: initialNotes,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [callId, initialNotes]);

  const handleSaveNote = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!callId) {
      setErrorMessage('No active call to attach notes to');
      setSaveStatus('error');
      return;
    }
    if (!newNoteText.trim()) return;

    setIsSaving(true);
    setSaveStatus('idle');
    setErrorMessage('');

    try {
      const res = await fetch(`/api/v1/calls/${callId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: newNoteText.trim(),
          author: 'Kristina Madrigal',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Failed to persist note' }));
        throw new Error(errData.error || 'Failed to save note');
      }

      const data = await res.json();
      if (data.note) {
        const updatedList = data.notes || [...notesHistory, data.note];
        setNotesHistory(updatedList);
        if (onNoteAdded) onNoteAdded(data.note);
      }

      setNewNoteText('');
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error saving note');
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickTemplate = (template: string) => {
    setNewNoteText((prev) => (prev ? `${prev} - ${template}` : template));
  };

  return (
    <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center space-x-2">
          <FileText className="w-4 h-4 text-indigo-400" />
          <h4 className="font-bold text-slate-200 text-xs font-mono uppercase tracking-wider">
            Call History & Agent Notes
          </h4>
        </div>
        {contactName && (
          <span className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]">
            Target: <strong className="text-slate-300">{contactName}</strong>
          </span>
        )}
      </div>

      {/* Existing Notes Log */}
      <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="text-center py-4 text-xs text-slate-500 font-mono">
            Loading call notes...
          </div>
        ) : notesHistory.length === 0 ? (
          <div className="text-center py-4 rounded-lg bg-slate-900/40 border border-slate-800/50 text-slate-500 text-xs italic">
            No notes logged for this call session yet. Enter notes below to persist.
          </div>
        ) : (
          notesHistory.map((n, idx) => (
            <div
              key={n.id || idx}
              className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs space-y-1"
            >
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span className="flex items-center gap-1 text-indigo-300 font-medium">
                  <User className="w-3 h-3 text-indigo-400" />
                  {n.author || 'Agent'}
                </span>
                <span className="flex items-center gap-1 text-slate-500">
                  <Clock className="w-3 h-3" />
                  {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
              <p className="text-slate-200 text-xs leading-relaxed whitespace-pre-wrap font-sans">
                {n.text}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Quick Templates */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1 mr-1">
          <Sparkles className="w-3 h-3 text-amber-400" /> Quick:
        </span>
        {[
          'Owner requested valuation',
          'Left voicemail',
          'Follow-up next week',
          'Interested in cash offer',
          'Not selling currently',
        ].map((tpl) => (
          <button
            key={tpl}
            type="button"
            onClick={() => handleQuickTemplate(tpl)}
            className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-[10px] font-mono border border-slate-800 transition-colors"
          >
            +{tpl}
          </button>
        ))}
      </div>

      {/* New Note Form */}
      <form onSubmit={handleSaveNote} className="space-y-2 pt-1">
        <textarea
          value={newNoteText}
          onChange={(e) => setNewNoteText(e.target.value)}
          placeholder={callId ? 'Type call summary, negotiation notes, or owner feedback...' : 'Select or wait for an active call to add notes...'}
          disabled={!callId || isSaving}
          rows={2}
          className="w-full bg-slate-900 text-xs p-2.5 rounded-lg border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-slate-600"
        />

        <div className="flex items-center justify-between">
          <div>
            {saveStatus === 'success' && (
              <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Note saved & persisted via API!
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-[11px] font-mono text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {errorMessage}
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={!callId || !newNoteText.trim() || isSaving}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center gap-1.5 font-mono"
          >
            {isSaving ? (
              <span>Saving...</span>
            ) : (
              <>
                <Send className="w-3 h-3" />
                <span>Save Note</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
