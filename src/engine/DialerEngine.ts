import { v4 as uuidv4 } from 'uuid';
import {
  DialingSession,
  CampaignContact,
  Call,
  NormalizedCallEvent,
  SubmitDispositionRequest,
} from '../types/dialer.js';
import { db, claimNextContactsAtomic, recordWebhookEventIdempotent } from '../db/db.js';
import { CallFsm } from './CallFsm.js';
import { providerRegistry } from '../telephony/ProviderRegistry.js';
import { dialerWsServer } from '../websocket/dialerWs.js';

export class DialerEngine {
  private processedWebhookEvents: Map<string, number> = new Map();
  private activeDispatchLocks: Set<string> = new Set();
  private readonly MAX_CACHE_SIZE = 5000;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  constructor() {
    providerRegistry.getMockProvider().setEventCallback((event) => {
      this.handleNormalizedTelephonyEvent(event);
    });

    setInterval(() => {
      this.pruneExpiredWebhookEvents();
    }, 2 * 60 * 1000).unref();
  }

  private async isEventProcessed(event: NormalizedCallEvent, eventKey: string): Promise<boolean> {
    const pool = db.getPool ? db.getPool() : null;
    if (db.isUsingPostgres() && pool) {
      const isUnique = await recordWebhookEventIdempotent(
        pool,
        event.providerName,
        event.providerCallId,
        event.callId,
        event.eventType
      );
      return !isUnique; // If insertion failed on conflict, it was already processed
    }

    // In-memory fallback
    const timestamp = this.processedWebhookEvents.get(eventKey);
    if (!timestamp) return false;
    if (Date.now() - timestamp > this.CACHE_TTL_MS) {
      this.processedWebhookEvents.delete(eventKey);
      return false;
    }
    return true;
  }

  private markEventProcessed(eventKey: string): void {
    if (this.processedWebhookEvents.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.processedWebhookEvents.keys().next().value;
      if (oldestKey) {
        this.processedWebhookEvents.delete(oldestKey);
      }
    }
    this.processedWebhookEvents.set(eventKey, Date.now());
  }

  private pruneExpiredWebhookEvents(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.processedWebhookEvents.entries()) {
      if (now - timestamp > this.CACHE_TTL_MS) {
        this.processedWebhookEvents.delete(key);
      }
    }
  }

  public async dispatchNextBatch(sessionId: string): Promise<Call[]> {
    // Concurrency Lock: Prevent multiple workers from oversubscribing lines simultaneously
    if (this.activeDispatchLocks.has(sessionId)) {
      return db.getActiveCallsForSession(sessionId);
    }
    this.activeDispatchLocks.add(sessionId);

    try {
      const session = db.getSession(sessionId);
      if (!session || session.status !== 'active') {
        return [];
      }
      const campaign = db.getCampaign(session.campaign_id, session.organization_id);
      if (!campaign || campaign.status !== 'active') {
        return [];
      }

      const existingActive = db.getActiveCallsForSession(sessionId);
      const hasConnectedOrDispo = existingActive.some(
        (c) => c.state === 'CONNECTED' || c.state === 'DISPO_PENDING'
      );
      if (hasConnectedOrDispo) {
        return existingActive;
      }

      const currentDialingCount = existingActive.filter(
        (c) => c.state === 'INITIATED' || c.state === 'DIALING' || c.state === 'RINGING'
      ).length;
      const neededLines = Math.max(0, session.lines_count - currentDialingCount);
      if (neededLines <= 0) {
        return existingActive;
      }

      // Concurrency-Safe Contact Claiming
      let pendingContacts: CampaignContact[] = [];
      const pool = db.getPool ? db.getPool() : null;
      if (db.isUsingPostgres() && pool) {
        pendingContacts = await claimNextContactsAtomic(
          pool,
          session.campaign_id,
          session.organization_id,
          neededLines
        );
      } else {
        pendingContacts = db.claimNextContactsAtomic(session.campaign_id, session.organization_id, neededLines);
      }

      if (pendingContacts.length === 0) {
        this.broadcastQueueUpdate(sessionId, session.campaign_id, session.organization_id);
        return existingActive;
      }

      const dispatchedCalls: Call[] = [];
      let lineNum = currentDialingCount + 1;

      for (const contact of pendingContacts) {
        // Strict advisory check: re-verify active dialing count against session.lines_count before dispatching
        const latestActive = db.getActiveCallsForSession(sessionId);
        const latestDialingCount = latestActive.filter(
          (c) => c.state === 'INITIATED' || c.state === 'DIALING' || c.state === 'RINGING'
        ).length;
        if (latestDialingCount >= session.lines_count || dispatchedCalls.length >= neededLines) {
          break;
        }

        if (!contact.phone || contact.phone.trim() === '' || contact.phone === 'No Phone on File') {
          db.updateContactStatus(contact.id, 'skipped');
          continue;
        }

        const isDnc =
          (campaign.skip_dnc && db.isNumberSuppressed(session.organization_id, contact.phone)) ||
          contact.metadata?.stage_name_standardized?.toLowerCase().includes('do not contact') ||
          contact.metadata?.stage_name?.toLowerCase().includes('do not') ||
          contact.metadata?.stage_status_standardized === 'lost';
        if (isDnc) {
          db.updateContactStatus(contact.id, 'dnc');
          continue;
        }

        if (
          campaign.skip_invalid &&
          (contact.metadata?.stage_status_standardized === 'invalid' ||
            contact.metadata?.stage_name_standardized?.toLowerCase().includes('invalid'))
        ) {
          db.updateContactStatus(contact.id, 'skipped');
          continue;
        }

        const provider = providerRegistry.getProvider();
        const call = db.createCall({
          organization_id: session.organization_id,
          session_id: session.id,
          campaign_contact_id: contact.id,
          provider_name: provider.providerName,
          line_number: lineNum++,
          phone_dialed: contact.phone,
          state: 'INITIATED',
          duration_seconds: 0,
        });

        await CallFsm.transition(call.id, 'DISPATCH', {
          session_id: session.id,
          campaign_id: session.campaign_id,
          contact_id: contact.id,
        });

        const outboundCallerId = campaign.outbound_caller_id || process.env.DEFAULT_CALLER_ID || '+19495550100';
        const callbackUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/v1/dialer/webhooks/${provider.providerName}`;

        provider
          .placeOutboundCall({
            callId: call.id,
            organizationId: session.organization_id,
            toPhone: contact.phone,
            fromPhone: outboundCallerId,
            lineIndex: call.line_number,
            webhookCallbackUrl: callbackUrl,
            metadata: {
              sessionId: session.id,
              campaignId: session.campaign_id,
            },
          })
          .then((result) => {
            if (result.providerCallId) {
              db.updateCall(call.id, { provider_call_id: result.providerCallId });
            }
            if (result.status === 'failed') {
              this.handleCallFailed(call.id, result.error || 'Provider rejected call');
            }
          })
          .catch((err) => {
            this.handleCallFailed(call.id, err.message);
          });

        dispatchedCalls.push(call);
      }

      this.broadcastSessionState(sessionId);
      this.broadcastQueueUpdate(sessionId, session.campaign_id, session.organization_id);
      return [...existingActive, ...dispatchedCalls];
    } finally {
      this.activeDispatchLocks.delete(sessionId);
    }
  }

  public async handleNormalizedTelephonyEvent(event: NormalizedCallEvent): Promise<void> {
    const eventKey = `${event.providerName}:${event.providerCallId}:${event.eventType}`;
    const alreadyHandled = await this.isEventProcessed(event, eventKey);
    if (alreadyHandled) {
      return;
    }
    this.markEventProcessed(eventKey);

    let call: Call | undefined;
    if (event.callId) {
      call = db.getCall(event.callId);
    }
    if (!call && event.providerCallId) {
      call = db.getCallByProviderCallId(event.providerCallId);
    }
    if (!call) {
      return;
    }

    const sessionId = call.session_id;

    switch (event.eventType) {
      case 'ringing':
        await CallFsm.transition(call.id, 'RECV_RINGING', event.rawPayload);
        this.broadcastSessionState(sessionId);
        break;
      case 'answered': {
        const result = await CallFsm.transition(call.id, 'RECV_ANSWERED', event.rawPayload);
        if (result.success) {
          db.updateContactStatus(call.campaign_contact_id, 'connected');
          await this.cancelOtherLinesInSession(sessionId, call.id);
          this.broadcastSessionState(sessionId);
          this.broadcastActiveContact(sessionId, call);
        }
        break;
      }
      case 'busy':
        await CallFsm.transition(call.id, 'RECV_BUSY', event.rawPayload);
        db.updateContactStatus(call.campaign_contact_id, 'retry');
        this.checkAndAdvanceSession(sessionId);
        break;
      case 'no_answer':
        await CallFsm.transition(call.id, 'TIMEOUT_NO_ANSWER', event.rawPayload);
        db.updateContactStatus(call.campaign_contact_id, 'retry');
        this.checkAndAdvanceSession(sessionId);
        break;
      case 'failed':
        await CallFsm.transition(call.id, 'RECV_FAILED', event.rawPayload);
        db.updateContactStatus(call.campaign_contact_id, 'skipped');
        this.checkAndAdvanceSession(sessionId);
        break;
      case 'hangup':
        if (call.state === 'CONNECTED') {
          await CallFsm.transition(call.id, 'HANGUP', event.rawPayload);
          this.broadcastSessionState(sessionId);
        } else if (call.state === 'DIALING' || call.state === 'RINGING') {
          await CallFsm.transition(call.id, 'HANGUP', event.rawPayload);
          db.updateContactStatus(call.campaign_contact_id, 'retry');
          this.checkAndAdvanceSession(sessionId);
        }
        break;
    }
  }

  public async cancelOtherLinesInSession(sessionId: string, winningCallId: string): Promise<void> {
    const activeCalls = db.getActiveCallsForSession(sessionId);
    const otherCalls = activeCalls.filter((c) => c.id !== winningCallId);
    const cancellationPromises: Promise<any>[] = [];

    for (const otherCall of otherCalls) {
      if (otherCall.state === 'DIALING' || otherCall.state === 'RINGING' || otherCall.state === 'INITIATED') {
        await CallFsm.transition(otherCall.id, 'CANCEL_PARALLEL', { reason: 'parallel_answered', winningCallId });
        db.updateContactStatus(otherCall.campaign_contact_id, 'retry');

        if (otherCall.provider_call_id) {
          const provider = providerRegistry.getProvider(otherCall.provider_name);
          cancellationPromises.push(provider.hangupCall(otherCall.provider_call_id).catch(() => {}));
        }
      }
    }
    if (cancellationPromises.length > 0) {
      await Promise.allSettled(cancellationPromises);
    }
  }

  public async submitDisposition(callId: string, req: SubmitDispositionRequest): Promise<Call | null> {
    const call = db.getCall(callId);
    if (!call) return null;

    const transition = await CallFsm.transition(call.id, 'SUBMIT_DISPO', {
      disposition_code: req.disposition_code,
      notes: req.notes,
      follow_up_date: req.follow_up_date,
      band_score: req.band_score,
      band_reasons: req.band_reasons,
    });

    if (!transition.success) {
      return null;
    }

    if (req.add_to_dnc || req.disposition_code === 'DNC') {
      db.addSuppression(call.organization_id, call.phone_dialed, 'Agent Requested DNC');
      db.updateContactStatus(call.campaign_contact_id, 'dnc');
    } else {
      db.updateContactStatus(call.campaign_contact_id, 'completed');
    }

    const session = db.getSession(call.session_id);
    if (session && session.status === 'active') {
      setTimeout(() => {
        this.dispatchNextBatch(session.id);
      }, 1000);
    }

    this.broadcastSessionState(call.session_id);
    if (session) {
      this.broadcastQueueUpdate(session.id, session.campaign_id, session.organization_id);
    }
    return transition.call;
  }

  private checkAndAdvanceSession(sessionId: string): void {
    const session = db.getSession(sessionId);
    if (!session || session.status !== 'active') {
      this.broadcastSessionState(sessionId);
      return;
    }
    const activeCalls = db.getActiveCallsForSession(sessionId);
    const pendingActive = activeCalls.filter(
      (c) =>
        c.state === 'INITIATED' ||
        c.state === 'DIALING' ||
        c.state === 'RINGING' ||
        c.state === 'CONNECTED' ||
        c.state === 'DISPO_PENDING'
    );
    if (pendingActive.length === 0) {
      setTimeout(() => {
        this.dispatchNextBatch(sessionId);
      }, 800);
    }
    this.broadcastSessionState(sessionId);
    this.broadcastQueueUpdate(sessionId, session.campaign_id, session.organization_id);
  }

  private async handleCallFailed(callId: string, error: string): Promise<void> {
    const call = db.getCall(callId);
    if (!call) return;
    await CallFsm.transition(callId, 'PROVIDER_ERROR', { error });
    db.updateContactStatus(call.campaign_contact_id, 'retry');
    this.checkAndAdvanceSession(call.session_id);
  }

  private broadcastSessionState(sessionId: string): void {
    const session = db.getSession(sessionId);
    if (!session) return;
    const activeCalls = db.getActiveCallsForSession(sessionId);
    const enrichedCalls = activeCalls.map((c) => {
      const contact = db.getCampaignContact(c.campaign_contact_id);
      return {
        ...c,
        contactName: contact?.name || 'Unknown',
        contactMetadata: contact?.metadata || {},
      };
    });
    const dispositionStats = db.getSessionDispositionStats(sessionId);
    dialerWsServer.broadcastToSession(sessionId, {
      type: 'SESSION_STATE',
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {
        session,
        activeCalls: enrichedCalls,
        dispositionStats,
      },
    });
  }

  private broadcastActiveContact(sessionId: string, call: Call): void {
    const contact = db.getCampaignContact(call.campaign_contact_id);
    if (!contact) return;
    dialerWsServer.broadcastToSession(sessionId, {
      type: 'ACTIVE_CONTACT',
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {
        call,
        contact,
      },
    });
  }

  private broadcastQueueUpdate(sessionId: string, campaignId: string, orgId: string): void {
    const counts = db.getCampaignContactsCount(campaignId, orgId);
    dialerWsServer.broadcastToSession(sessionId, {
      type: 'QUEUE_UPDATE',
      sessionId,
      timestamp: new Date().toISOString(),
      payload: counts,
    });
  }
}

export const dialerEngine = new DialerEngine();