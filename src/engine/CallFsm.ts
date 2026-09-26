import { FsmCallState, FsmTriggerEvent, Call, CallEvent } from '../types/dialer.js';
import { db, transitionCallStateAtomic } from '../db/db.js';

export interface TransitionResult {
  success: boolean;
  fromState: FsmCallState;
  toState: FsmCallState;
  event: FsmTriggerEvent;
  call: Call;
  callEvent?: CallEvent;
  error?: string;
}

export class CallFsm {
  public static readonly TRANSITION_TABLE: Record<FsmCallState, Partial<Record<FsmTriggerEvent, FsmCallState>>> = {
    INITIATED: {
      DISPATCH: 'DIALING',
      CANCEL_PARALLEL: 'TERMINATED',
      PROVIDER_ERROR: 'FAILED',
      HANGUP: 'TERMINATED',
    },
    DIALING: {
      RECV_RINGING: 'RINGING',
      RECV_ANSWERED: 'CONNECTED',
      RECV_BUSY: 'BUSY',
      RECV_FAILED: 'FAILED',
      CANCEL_PARALLEL: 'TERMINATED',
      PROVIDER_ERROR: 'FAILED',
      HANGUP: 'TERMINATED',
    },
    RINGING: {
      RECV_ANSWERED: 'CONNECTED',
      TIMEOUT_NO_ANSWER: 'NO_ANSWER',
      RECV_BUSY: 'BUSY',
      RECV_FAILED: 'FAILED',
      CANCEL_PARALLEL: 'TERMINATED',
      PROVIDER_ERROR: 'FAILED',
      HANGUP: 'TERMINATED',
    },
    CONNECTED: {
      HANGUP: 'DISPO_PENDING',
      PROVIDER_ERROR: 'DISPO_PENDING',
    },
    DISPO_PENDING: {
      SUBMIT_DISPO: 'TERMINATED',
    },
    BUSY: {},
    FAILED: {},
    NO_ANSWER: {},
    TERMINATED: {},
  };

  public static transition(
    callId: string,
    event: FsmTriggerEvent,
    payload: Record<string, any> = {}
  ): TransitionResult | Promise<TransitionResult> {
    const call = db.getCall(callId);
    if (!call) {
      return {
        success: false,
        fromState: 'INITIATED',
        toState: 'INITIATED',
        event,
        call: null as any,
        error: `Call with ID ${callId} not found`,
      };
    }

    const currentState = call.state;
    const allowedTransitions = this.TRANSITION_TABLE[currentState];
    const nextState = allowedTransitions ? allowedTransitions[event] : undefined;

    if (!nextState) {
      return {
        success: false,
        fromState: currentState,
        toState: currentState,
        event,
        call,
        error: `Invalid transition: cannot transition from ${currentState} via ${event}`,
      };
    }

    const updates: Partial<Call> = {
      state: nextState,
    };

    if (nextState === 'CONNECTED' && !call.connected_at) {
      updates.connected_at = new Date().toISOString();
    }

    if (
      nextState === 'DISPO_PENDING' ||
      nextState === 'TERMINATED' ||
      nextState === 'BUSY' ||
      nextState === 'FAILED' ||
      nextState === 'NO_ANSWER'
    ) {
      updates.ended_at = new Date().toISOString();
      if (call.connected_at) {
        const duration = Math.max(0, Math.floor((Date.now() - new Date(call.connected_at).getTime()) / 1000));
        updates.duration_seconds = duration;
      }
    }

    if (event === 'SUBMIT_DISPO') {
      if (payload.disposition_code) updates.disposition_code = payload.disposition_code;
      if (payload.notes) updates.agent_notes = payload.notes;
      if (payload.band_score !== undefined) updates.band_score = payload.band_score;
      if (payload.band_reasons) updates.band_reasons = payload.band_reasons;
    }

    // Atomic DB execution if PostgreSQL pool is active
    const pool = db.getPool ? db.getPool() : null;
    if (db.isUsingPostgres() && pool) {
      return (async () => {
        const result = await transitionCallStateAtomic(pool, {
          callId,
          expectedCurrentState: currentState,
          targetState: nextState,
          triggerEvent: event,
          payload,
          updates,
        });

        if (!result.success || !result.call) {
          return {
            success: false,
            fromState: currentState,
            toState: currentState,
            event,
            call,
            error: result.error || 'Failed to execute atomic DB transition',
          };
        }

        // Sync memory Map cache and merge active session calls from DB response to maintain UI consistency
        db.calls.set(callId, result.call);
        if (result.call.session_id) {
          try {
            const activeRes = await pool.query('SELECT * FROM calls WHERE session_id = $1 AND state NOT IN (\'TERMINATED\', \'BUSY\', \'FAILED\', \'NO_ANSWER\')', [result.call.session_id]);
            for (const row of activeRes.rows) {
              const existing = db.calls.get(row.id);
              db.calls.set(row.id, { ...(existing || {}), ...(row as Call) } as Call);
            }
          } catch {
            // Fallback gracefully if active fetch query fails
          }
        }

        return {
          success: true,
          fromState: currentState,
          toState: nextState,
          event,
          call: result.call,
        };
      })();
    }

    // In-memory fallback (synchronous)
    const updatedCall = db.updateCall(callId, updates)!;
    const callEvent = db.logCallEvent(callId, currentState, nextState, event, payload);

    return {
      success: true,
      fromState: currentState,
      toState: nextState,
      event,
      call: updatedCall,
      callEvent,
    };
  }

  public static isTerminal(state: FsmCallState): boolean {
    return state === 'TERMINATED' || state === 'BUSY' || state === 'FAILED' || state === 'NO_ANSWER';
  }

  public static canTransition(currentState: FsmCallState, event: FsmTriggerEvent): boolean {
    return Boolean(this.TRANSITION_TABLE[currentState]?.[event]);
  }
}