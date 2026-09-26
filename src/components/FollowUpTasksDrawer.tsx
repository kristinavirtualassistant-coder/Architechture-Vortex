import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Square,
  Clock,
  Trash2,
  X,
  Plus,
  Calendar,
  AlertCircle,
  Phone,
  Building2,
  FileText,
  Search,
  Filter,
  CheckCircle2,
  CalendarDays,
  Sparkles,
  Download,
} from 'lucide-react';
import { FollowUpTask } from '../types/followUpTask';
import {
  getFollowUpTasks,
  toggleTaskCompletion,
  deleteFollowUpTask,
  clearCompletedTasks,
  saveFollowUpTask,
  FOLLOW_UP_UPDATED_EVENT,
} from '../lib/followUpStorage';

interface FollowUpTasksDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FollowUpTasksDrawer: React.FC<FollowUpTasksDrawerProps> = ({ isOpen, onClose }) => {
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [filterTab, setFilterTab] = useState<'all' | 'pending' | 'today' | 'completed'>('pending');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isAddingTask, setIsAddingTask] = useState<boolean>(false);

  // Quick manual add form state
  const [newTitle, setNewTitle] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [newTaskType, setNewTaskType] = useState<'call' | 'email' | 'cma' | 'offer' | 'meeting' | 'other'>('call');
  const [newNotes, setNewNotes] = useState('');

  const loadTasks = () => {
    setTasks(getFollowUpTasks());
  };

  useEffect(() => {
    loadTasks();

    const handleUpdate = () => {
      loadTasks();
    };

    window.addEventListener(FOLLOW_UP_UPDATED_EVENT, handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener(FOLLOW_UP_UPDATED_EVENT, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  if (!isOpen) return null;

  const todayStr = new Date().toISOString().split('T')[0];

  const filteredTasks = tasks.filter((task) => {
    // Tab filter
    if (filterTab === 'pending' && task.completed) return false;
    if (filterTab === 'completed' && !task.completed) return false;
    if (filterTab === 'today') {
      if (task.completed) return false;
      if (task.dueDate > todayStr) return false; // today or overdue
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = task.contactName?.toLowerCase().includes(q);
      const matchPhone = task.phone?.includes(q);
      const matchTitle = task.taskTitle?.toLowerCase().includes(q);
      const matchAddr = task.propertyAddress?.toLowerCase().includes(q);
      const matchNotes = task.notes?.toLowerCase().includes(q);
      return matchName || matchPhone || matchTitle || matchAddr || matchNotes;
    }

    return true;
  });

  const pendingCount = tasks.filter((t) => !t.completed).length;
  const todayDueCount = tasks.filter((t) => !t.completed && t.dueDate <= todayStr).length;
  const completedCount = tasks.filter((t) => t.completed).length;

  const handleToggleComplete = (id: string) => {
    const updated = toggleTaskCompletion(id);
    setTasks(updated);
  };

  const handleDelete = (id: string) => {
    const updated = deleteFollowUpTask(id);
    setTasks(updated);
  };

  const handleClearCompleted = () => {
    if (window.confirm('Clear all completed follow-up reminders?')) {
      const updated = clearCompletedTasks();
      setTasks(updated);
    }
  };

  const handleCreateManualTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContactName.trim()) return;

    saveFollowUpTask({
      contactName: newContactName.trim(),
      phone: newPhone.trim() || '(949) 555-0100',
      taskTitle: newTitle.trim(),
      dueDate: newDueDate || todayStr,
      priority: newPriority,
      taskType: newTaskType,
      dispositionCode: 'CALLBACK',
      notes: newNotes.trim() || undefined,
    });

    setNewTitle('');
    setNewContactName('');
    setNewPhone('');
    setNewDueDate('');
    setNewNotes('');
    setIsAddingTask(false);
    loadTasks();
  };

  const exportTasksToCsv = () => {
    if (tasks.length === 0) return;
    const headers = ['ID', 'Contact Name', 'Phone', 'Task Title', 'Due Date', 'Priority', 'Type', 'Status', 'Property Address', 'Dispo Code', 'Notes', 'Created At'];
    const rows = tasks.map((t) => [
      t.id,
      `"${t.contactName || ''}"`,
      `"${t.phone || ''}"`,
      `"${(t.taskTitle || '').replace(/"/g, '""')}"`,
      t.dueDate,
      t.priority,
      t.taskType,
      t.completed ? 'Completed' : 'Pending',
      `"${(t.propertyAddress || '').replace(/"/g, '""')}"`,
      t.dispositionCode,
      `"${(t.notes || '').replace(/"/g, '""')}"`,
      t.createdAt,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `vortex_follow_up_tasks_${todayStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-sm flex justify-end animate-fadeIn">
      <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl text-slate-100">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <CheckSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base text-white">Follow-up Tasks & Reminders</h3>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Local Storage
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                {pendingCount} Pending • {todayDueCount} Due Today / Overdue
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsAddingTask(!isAddingTask)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Task</span>
            </button>
            <button
              onClick={exportTasksToCsv}
              disabled={tasks.length === 0}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 hover:text-white border border-slate-700 transition-colors"
              title="Export tasks to CSV"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Manual Add Task Form Subpanel */}
        {isAddingTask && (
          <form onSubmit={handleCreateManualTask} className="p-4 bg-slate-950 border-b border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-indigo-300">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Create Lead Follow-up Reminder
              </span>
              <button
                type="button"
                onClick={() => setIsAddingTask(false)}
                className="text-slate-500 hover:text-slate-300 text-xs"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Lead / Contact Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Richard Vance"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Phone Number</label>
                <input
                  type="text"
                  placeholder="(949) 555-0100"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">Task Action / Title *</label>
              <input
                type="text"
                required
                placeholder="e.g. Follow up regarding 1031 exchange replacement property"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Due Date</label>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Task Type</label>
                <select
                  value={newTaskType}
                  onChange={(e) => setNewTaskType(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="call">Follow-up Call</option>
                  <option value="email">Send Email / Info</option>
                  <option value="cma">Prepare CMA / Equity</option>
                  <option value="offer">Send Purchase Offer</option>
                  <option value="meeting">In-Person Meeting</option>
                  <option value="other">Other Task</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Priority</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="high">High Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="low">Low Priority</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">Notes / Instructions (Optional)</label>
              <textarea
                rows={2}
                placeholder="Key details from previous call..."
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-1">
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Save Reminder
              </button>
            </div>
          </form>
        )}

        {/* Filter Tabs & Search Bar */}
        <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-900/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
              <button
                onClick={() => setFilterTab('pending')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'pending'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Pending ({pendingCount})
              </button>
              <button
                onClick={() => setFilterTab('today')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'today'
                    ? 'bg-amber-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Due Today ({todayDueCount})
              </button>
              <button
                onClick={() => setFilterTab('completed')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'completed'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Completed ({completedCount})
              </button>
              <button
                onClick={() => setFilterTab('all')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  filterTab === 'all'
                    ? 'bg-slate-800 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({tasks.length})
              </button>
            </div>

            {completedCount > 0 && (
              <button
                onClick={handleClearCompleted}
                className="text-[11px] font-mono text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Completed</span>
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search tasks by contact name, phone, address, or task notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredTasks.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
              <CheckSquare className="w-8 h-8 text-slate-600 mx-auto" />
              <h4 className="text-sm font-semibold text-slate-300">No Follow-up Tasks Found</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                When you submit a disposition with &quot;Follow-up Task&quot; toggled on, reminders will automatically be tracked here in local storage.
              </p>
            </div>
          ) : (
            filteredTasks.map((task) => {
              const isOverdue = !task.completed && task.dueDate < todayStr;
              const isDueToday = !task.completed && task.dueDate === todayStr;

              return (
                <div
                  key={task.id}
                  className={`p-4 rounded-xl border transition-all ${
                    task.completed
                      ? 'bg-slate-950/60 border-slate-800/80 opacity-70'
                      : isOverdue
                      ? 'bg-rose-950/20 border-rose-800/60'
                      : isDueToday
                      ? 'bg-amber-950/20 border-amber-800/60'
                      : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start space-x-3 flex-1 min-w-0">
                      <button
                        onClick={() => handleToggleComplete(task.id)}
                        className="mt-0.5 text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                        title={task.completed ? 'Mark as incomplete' : 'Mark as completed'}
                      >
                        {task.completed ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-500 hover:text-indigo-400" />
                        )}
                      </button>

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`font-semibold text-sm ${
                              task.completed ? 'line-through text-slate-400' : 'text-white'
                            }`}
                          >
                            {task.taskTitle}
                          </span>

                          {/* Priority badge */}
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${
                              task.priority === 'high'
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                                : task.priority === 'medium'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                            }`}
                          >
                            {task.priority}
                          </span>

                          {/* Task type badge */}
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                            {task.taskType}
                          </span>

                          {/* Disposition code badge */}
                          {task.dispositionCode && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                              {task.dispositionCode}
                            </span>
                          )}
                        </div>

                        {/* Contact details */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span className="font-bold text-slate-200">{task.contactName}</span>
                          <span className="flex items-center gap-1 font-mono text-indigo-300">
                            <Phone className="w-3 h-3 text-indigo-400" /> {task.phone}
                          </span>
                          {task.propertyAddress && (
                            <span className="flex items-center gap-1 text-slate-400 truncate max-w-xs" title={task.propertyAddress}>
                              <Building2 className="w-3 h-3 text-slate-500" /> {task.propertyAddress}
                            </span>
                          )}
                        </div>

                        {/* Notes if available */}
                        {task.notes && (
                          <div className="p-2 rounded bg-slate-900 border border-slate-800/80 text-xs text-slate-300 font-sans mt-2">
                            <span className="text-[10px] font-mono text-slate-500 uppercase block mb-0.5">Notes:</span>
                            {task.notes}
                          </div>
                        )}

                        {/* Due date & status footer */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] font-mono">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`flex items-center gap-1 font-bold ${
                                task.completed
                                  ? 'text-slate-500'
                                  : isOverdue
                                  ? 'text-rose-400'
                                  : isDueToday
                                  ? 'text-amber-400'
                                  : 'text-indigo-300'
                              }`}
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              Due: {task.dueDate} {task.dueTime ? `@ ${task.dueTime}` : ''}
                              {isOverdue && ' (OVERDUE)'}
                              {isDueToday && ' (TODAY)'}
                            </span>
                          </div>

                          <div className="flex items-center space-x-3 text-slate-500">
                            <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                            {task.completedAt && (
                              <span className="text-emerald-400">
                                Done: {new Date(task.completedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDelete(task.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition-colors"
                      title="Delete reminder"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
