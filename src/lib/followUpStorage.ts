import { FollowUpTask, NewFollowUpTaskPayload } from '../types/followUpTask';

export const LOCAL_STORAGE_FOLLOW_UP_KEY = 'vortex_follow_up_tasks';
export const FOLLOW_UP_UPDATED_EVENT = 'vortex_follow_up_tasks_updated';

/**
 * Retrieves all follow-up tasks from localStorage.
 */
export function getFollowUpTasks(): FollowUpTask[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_FOLLOW_UP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.warn('Failed to read follow-up tasks from localStorage:', err);
    return [];
  }
}

/**
 * Saves a new follow-up task to localStorage.
 */
export function saveFollowUpTask(payload: NewFollowUpTaskPayload): FollowUpTask {
  const tasks = getFollowUpTasks();
  
  const newTask: FollowUpTask = {
    ...payload,
    id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    createdAt: new Date().toISOString(),
    completed: false,
  };

  const updatedTasks = [newTask, ...tasks];
  persistAndNotify(updatedTasks);
  return newTask;
}

/**
 * Toggles completion status of a follow-up task.
 */
export function toggleTaskCompletion(id: string): FollowUpTask[] {
  const tasks = getFollowUpTasks();
  const updatedTasks = tasks.map((t) => {
    if (t.id === id) {
      const isNowCompleted = !t.completed;
      return {
        ...t,
        completed: isNowCompleted,
        completedAt: isNowCompleted ? new Date().toISOString() : undefined,
      };
    }
    return t;
  });

  persistAndNotify(updatedTasks);
  return updatedTasks;
}

/**
 * Deletes a follow-up task by ID.
 */
export function deleteFollowUpTask(id: string): FollowUpTask[] {
  const tasks = getFollowUpTasks();
  const updatedTasks = tasks.filter((t) => t.id !== id);
  persistAndNotify(updatedTasks);
  return updatedTasks;
}

/**
 * Clears all completed tasks.
 */
export function clearCompletedTasks(): FollowUpTask[] {
  const tasks = getFollowUpTasks();
  const updatedTasks = tasks.filter((t) => !t.completed);
  persistAndNotify(updatedTasks);
  return updatedTasks;
}

/**
 * Returns count of active pending tasks.
 */
export function getPendingFollowUpCount(): number {
  return getFollowUpTasks().filter((t) => !t.completed).length;
}

/**
 * Helper to write to localStorage and dispatch custom window event for instant multi-component reactivity.
 */
function persistAndNotify(tasks: FollowUpTask[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_FOLLOW_UP_KEY, JSON.stringify(tasks));
  } catch (err) {
    console.error('Failed to persist follow-up tasks to localStorage:', err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOLLOW_UP_UPDATED_EVENT, { detail: { tasks } }));
  }
}
