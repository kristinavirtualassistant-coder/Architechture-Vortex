export interface FollowUpTask {
  id: string;
  callId?: string;
  contactId?: string;
  contactName: string;
  phone: string;
  propertyAddress?: string;
  city?: string;
  apn?: string;
  dispositionCode: string;
  taskTitle: string;
  dueDate: string; // YYYY-MM-DD
  dueTime?: string; // HH:mm
  priority: 'high' | 'medium' | 'low';
  taskType: 'call' | 'email' | 'cma' | 'offer' | 'meeting' | 'other';
  notes?: string;
  createdAt: string;
  completed: boolean;
  completedAt?: string;
}

export type NewFollowUpTaskPayload = Omit<FollowUpTask, 'id' | 'createdAt' | 'completed' | 'completedAt'>;
