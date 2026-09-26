/**
 * Vortex One Dialer - Mock Telephony Provider
 * Deterministic simulator for ringing, pickups, busy signals, failures, timeouts, and delays.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ITelephonyProvider,
  TelephonyCallRequest,
  TelephonyCallResult,
  NormalizedCallEvent,
} from '../types/dialer.js';

export interface MockSimulationScenario {
  outcome: 'answered' | 'busy' | 'failed' | 'no_answer';
  ringDelayMs?: number;
  answerDelayMs?: number;
  durationSeconds?: number;
}

export class MockTelephonyProvider implements ITelephonyProvider {
  public readonly providerName = 'mock';
  private activeCalls: Map<string, { request: TelephonyCallRequest; scenario: MockSimulationScenario; timer?: NodeJS.Timeout }> = new Map();
  private eventCallback?: (event: NormalizedCallEvent) => void;

  // Configurable default behavior for testing
  private defaultScenario: MockSimulationScenario = {
    outcome: 'answered',
    ringDelayMs: 600,
    answerDelayMs: 1500,
    durationSeconds: 30,
  };

  constructor(eventCallback?: (event: NormalizedCallEvent) => void) {
    this.eventCallback = eventCallback;
  }

  public setEventCallback(callback: (event: NormalizedCallEvent) => void): void {
    this.eventCallback = callback;
  }

  public setDefaultScenario(scenario: Partial<MockSimulationScenario>): void {
    this.defaultScenario = { ...this.defaultScenario, ...scenario };
  }

  public async initialize(_credentials?: Record<string, any>): Promise<void> {
    // Mock initialization is always successful
    return Promise.resolve();
  }

  public async placeOutboundCall(request: TelephonyCallRequest): Promise<TelephonyCallResult> {
    const providerCallId = `mock_call_${uuidv4().substring(0, 8)}`;
    
    // Check if a specific scenario was requested in metadata
    let scenario = { ...this.defaultScenario };
    if (request.metadata?.scenario) {
      scenario = { ...scenario, ...request.metadata.scenario };
    } else {
      // Deterministic rules based on phone number suffix for repeatable tests:
      // ..1234 -> Answered
      // ..8821 -> Answered
      // ..3312 -> Answered
      // ..9011 -> Busy
      // ..4499 -> No Answer
      // ..7766 -> Failed/Invalid
      const last4 = request.toPhone.replace(/\D/g, '').slice(-4);
      if (last4 === '9011') {
        scenario.outcome = 'busy';
      } else if (last4 === '4499') {
        scenario.outcome = 'no_answer';
        scenario.ringDelayMs = 400;
        scenario.answerDelayMs = 3000;
      } else if (last4 === '7766') {
        scenario.outcome = 'failed';
        scenario.ringDelayMs = 200;
      }
    }

    this.activeCalls.set(providerCallId, { request, scenario });

    // Simulate async network progression
    this.scheduleCallProgression(providerCallId, request, scenario);

    return {
      providerCallId,
      status: 'initiated',
      rawResponse: {
        mock_provider: true,
        scenario: scenario.outcome,
        timestamp: new Date().toISOString(),
      },
    };
  }

  public async hangupCall(providerCallId: string): Promise<boolean> {
    const active = this.activeCalls.get(providerCallId);
    if (active?.timer) {
      clearTimeout(active.timer);
    }
    this.activeCalls.delete(providerCallId);

    this.emitEvent({
      providerName: this.providerName,
      providerCallId,
      callId: active?.request.callId,
      eventType: 'hangup',
      durationSeconds: 5,
      timestamp: new Date().toISOString(),
      rawPayload: { reason: 'hangup_requested' },
    });

    return true;
  }

  public async muteCall(_providerCallId: string, _mute: boolean): Promise<boolean> {
    return true;
  }

  public parseWebhookEvent(headers: Record<string, any>, body: any): NormalizedCallEvent | null {
    if (!body || !body.providerCallId) return null;
    return {
      providerName: this.providerName,
      providerCallId: body.providerCallId,
      callId: body.callId,
      eventType: body.eventType || 'initiated',
      durationSeconds: body.durationSeconds || 0,
      timestamp: body.timestamp || new Date().toISOString(),
      rawPayload: body,
      signatureValid: true,
    };
  }

  private scheduleCallProgression(
    providerCallId: string,
    request: TelephonyCallRequest,
    scenario: MockSimulationScenario
  ) {
    const ringDelay = scenario.ringDelayMs ?? 600;
    const answerDelay = scenario.answerDelayMs ?? 1500;

    // 1. Emit Ringing Event
    setTimeout(() => {
      if (!this.activeCalls.has(providerCallId)) return; // Already cancelled or answered elsewhere

      this.emitEvent({
        providerName: this.providerName,
        providerCallId,
        callId: request.callId,
        eventType: 'ringing',
        timestamp: new Date().toISOString(),
        rawPayload: { status: 'ringing', lineIndex: request.lineIndex },
      });

      // 2. Next outcome based on scenario
      setTimeout(() => {
        if (!this.activeCalls.has(providerCallId)) return;

        if (scenario.outcome === 'answered') {
          this.emitEvent({
            providerName: this.providerName,
            providerCallId,
            callId: request.callId,
            eventType: 'answered',
            timestamp: new Date().toISOString(),
            rawPayload: { status: 'connected', lineIndex: request.lineIndex },
          });
        } else if (scenario.outcome === 'busy') {
          this.emitEvent({
            providerName: this.providerName,
            providerCallId,
            callId: request.callId,
            eventType: 'busy',
            timestamp: new Date().toISOString(),
            rawPayload: { status: 'busy', lineIndex: request.lineIndex },
          });
          this.activeCalls.delete(providerCallId);
        } else if (scenario.outcome === 'failed') {
          this.emitEvent({
            providerName: this.providerName,
            providerCallId,
            callId: request.callId,
            eventType: 'failed',
            timestamp: new Date().toISOString(),
            rawPayload: { status: 'failed', error: 'Destination unreachable' },
          });
          this.activeCalls.delete(providerCallId);
        } else if (scenario.outcome === 'no_answer') {
          this.emitEvent({
            providerName: this.providerName,
            providerCallId,
            callId: request.callId,
            eventType: 'no_answer',
            timestamp: new Date().toISOString(),
            rawPayload: { status: 'no_answer', timeout: true },
          });
          this.activeCalls.delete(providerCallId);
        }
      }, answerDelay);
    }, ringDelay);
  }

  private emitEvent(event: NormalizedCallEvent) {
    if (this.eventCallback) {
      this.eventCallback(event);
    }
  }
}
