/**
 * Vortex One Dialer - Core Types & Domain Models
 * Multi-tenant, provider-agnostic, authoritative FSM power dialing engine.
 */

export type FsmCallState =
  | 'INITIATED'
  | 'DIALING'
  | 'RINGING'
  | 'CONNECTED'
  | 'BUSY'
  | 'FAILED'
  | 'NO_ANSWER'
  | 'DISPO_PENDING'
  | 'TERMINATED';

export type FsmTriggerEvent =
  | 'DISPATCH'
  | 'RECV_RINGING'
  | 'RECV_ANSWERED'
  | 'RECV_BUSY'
  | 'RECV_FAILED'
  | 'TIMEOUT_NO_ANSWER'
  | 'HANGUP'
  | 'SUBMIT_DISPO'
  | 'CANCEL_PARALLEL'
  | 'PROVIDER_ERROR';

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  role: 'admin' | 'supervisor' | 'agent';
  created_at: string;
}

export interface Campaign {
  id: string;
  organization_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  lines_per_agent: number; // 1 to 4
  dial_mode: 'power' | 'preview';
  skip_dnc: boolean;
  skip_invalid: boolean;
  outbound_caller_id?: string;
  created_at: string;
}

export interface PropertyMetadata {
  property_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  apn?: string;
  property_type_standardized?: string;
  property_type?: string;
  units?: number;
  is_vacant?: string | boolean;
  is_owner_occupied?: string | boolean;
  secondary_phones?: string;
  tracked_phone?: string;
  email?: string;
  stage_name_standardized?: string;
  stage_status_standardized?: string;
  stage_name?: string;
  stage_status?: string;
  source_name?: string;
  referrer_name?: string;
  assigned_to?: string;
  pipeline_name?: string;
  next_task_kind?: string;
  next_task_due_at?: string;
  tag_list?: string;
  estimated_equity?: string | number;
  assessed_value?: string | number;
  owner_type?: string;
  [key: string]: any;
}

export interface CampaignContact {
  id: string;
  organization_id: string;
  campaign_id: string;
  external_contact_id: string;
  name: string;
  phone: string;
  metadata: PropertyMetadata;
  status: 'pending' | 'dialing' | 'connected' | 'completed' | 'skipped' | 'dnc' | 'retry';
  attempts: number;
  last_dialed_at?: string;
  created_at: string;
}

export interface DialingSession {
  id: string;
  organization_id: string;
  campaign_id: string;
  agent_id: string;
  status: 'active' | 'paused' | 'ended';
  lines_count: number;
  started_at: string;
  ended_at?: string;
}

export interface Call {
  id: string;
  organization_id: string;
  session_id: string;
  campaign_contact_id: string;
  provider_name: string;
  provider_call_id?: string;
  line_number: number;
  phone_dialed: string;
  state: FsmCallState;
  duration_seconds: number;
  disposition_code?: string;
  agent_notes?: string;
  band_score?: number;
  band_reasons?: string[];
  started_at: string;
  connected_at?: string;
  ended_at?: string;
}

export interface CallEvent {
  id: number | string;
  call_id: string;
  from_state: FsmCallState | 'NONE';
  to_state: FsmCallState;
  event: FsmTriggerEvent;
  payload: Record<string, any>;
  created_at: string;
}

export interface CallNote {
  id: string;
  call_id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface SuppressionRecord {
  id: string;
  organization_id: string;
  phone: string;
  reason: string;
  created_at: string;
}

// Telephony Interfaces
export interface TelephonyCallRequest {
  callId: string;
  organizationId: string;
  toPhone: string;
  fromPhone: string;
  lineIndex: number;
  webhookCallbackUrl: string;
  metadata?: Record<string, any>;
}

export interface TelephonyCallResult {
  providerCallId: string;
  status: 'queued' | 'initiated' | 'failed';
  rawResponse?: Record<string, any>;
  error?: string;
}

export interface NormalizedCallEvent {
  providerName: string;
  providerCallId: string;
  callId?: string;
  eventType: 'initiated' | 'ringing' | 'answered' | 'busy' | 'failed' | 'no_answer' | 'hangup';
  durationSeconds?: number;
  timestamp: string;
  rawPayload: Record<string, any>;
  signatureValid?: boolean;
}

export interface ITelephonyProvider {
  readonly providerName: string;
  initialize(credentials?: Record<string, any>): Promise<void>;
  placeOutboundCall(request: TelephonyCallRequest): Promise<TelephonyCallResult>;
  hangupCall(providerCallId: string): Promise<boolean>;
  muteCall(providerCallId: string, mute: boolean): Promise<boolean>;
  parseWebhookEvent(headers: Record<string, any>, body: any): NormalizedCallEvent | null;
}

// API Request/Response Payloads
export interface IngestCampaignRequest {
  organization_id: string;
  campaign_name: string;
  dial_settings?: {
    lines_per_agent?: number;
    dial_mode?: 'power' | 'preview';
    skip_dnc?: boolean;
    skip_invalid?: boolean;
  };
  contacts: Array<{
    external_contact_id: string;
    name: string;
    phone: string;
    metadata?: PropertyMetadata;
  }>;
}

export interface StartSessionRequest {
  organization_id: string;
  campaign_id: string;
  agent_id: string;
  requested_lines: number;
}

export interface SubmitDispositionRequest {
  disposition_code: 'INTERESTED' | 'NOT_INTERESTED' | 'CALLBACK' | 'DNC' | 'NO_ANSWER' | 'LEFT_VOICEMAIL';
  notes?: string;
  add_to_dnc?: boolean;
  follow_up_date?: string;
  band_score?: number;
  band_reasons?: string[];
}

// WebSocket Protocols
export type WSMessageType =
  | 'LINE_UPDATE'
  | 'ACTIVE_CONTACT'
  | 'CALL_EVENT'
  | 'SESSION_STATE'
  | 'QUEUE_UPDATE'
  | 'ERROR';

export interface DispositionStatItem {
  name: string;
  key: string;
  count: number;
  color: string;
  category: 'positive' | 'followup' | 'unreached' | 'negative' | 'dnc' | 'other';
  percentage?: number;
}

export interface HourlyPerformanceItem {
  hourLabel: string;
  hourKey: string;
  hourNumber: number;
  totalCalls: number;
  connectedCount: number;
  positiveLeads: number;
  connectRate: number;
  positiveRate: number;
  avgDurationSeconds: number;
  totalDurationSeconds: number;
  dispositionCounts: Record<string, number>;
  chartData: DispositionStatItem[];
}

export interface SessionDispositionStats {
  sessionId: string;
  totalCalls: number;
  totalDispositioned: number;
  connectedCount: number;
  connectRate: number;
  positiveRate: number;
  avgDurationSeconds: number;
  dispositionCounts: Record<string, number>;
  chartData: DispositionStatItem[];
  hourlyTimeSeries?: HourlyPerformanceItem[];
}

export interface WSMessage<T = any> {
  type: WSMessageType;
  sessionId: string;
  timestamp: string;
  payload: T;
}
