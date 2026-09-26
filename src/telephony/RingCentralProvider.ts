/**
 * Vortex One Dialer - RingCentral Telephony Provider
 * Production adapter for RingCentral REST API and Telephony Session Webhook normalization.
 */

import crypto from 'crypto';
import {
  ITelephonyProvider,
  TelephonyCallRequest,
  TelephonyCallResult,
  NormalizedCallEvent,
} from '../types/dialer.js';

export interface RingCentralConfig {
  clientId?: string;
  clientSecret?: string;
  serverUrl?: string;
  jwtToken?: string;
  webhookSecret?: string;
}

export class RingCentralProvider implements ITelephonyProvider {
  public readonly providerName = 'ringcentral';
  private config: RingCentralConfig = {};
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config?: RingCentralConfig) {
    this.config = {
      clientId: config?.clientId || process.env.RINGCENTRAL_CLIENT_ID || '',
      clientSecret: config?.clientSecret || process.env.RINGCENTRAL_CLIENT_SECRET || '',
      serverUrl: config?.serverUrl || process.env.RINGCENTRAL_SERVER_URL || 'https://platform.ringcentral.com',
      jwtToken: config?.jwtToken || process.env.RINGCENTRAL_JWT || '',
      webhookSecret: config?.webhookSecret || process.env.RINGCENTRAL_WEBHOOK_SECRET || '',
    };
  }

  public isConfigured(): boolean {
    return Boolean(this.config.jwtToken && this.config.clientId && this.config.clientSecret);
  }

  public async initialize(credentials?: Record<string, any>): Promise<void> {
    if (credentials) {
      this.config = { ...this.config, ...credentials };
    }
    if (this.isConfigured()) {
      await this.authenticate();
    }
  }

  private async authenticate(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    if (!this.config.jwtToken || !this.config.clientId || !this.config.clientSecret) {
      return null;
    }

    try {
      const authHeader = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
      const response = await fetch(`${this.config.serverUrl}/restapi/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: this.config.jwtToken,
        }).toString(),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[RingCentral Auth Error] Status ${response.status}:`, errText);
        return null;
      }

      const data: any = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      return this.accessToken;
    } catch (err: any) {
      console.error('[RingCentral Auth Network Error]:', err.message);
      return null;
    }
  }

  public async placeOutboundCall(request: TelephonyCallRequest): Promise<TelephonyCallResult> {
    if (!this.isConfigured()) {
      return {
        providerCallId: `rc_sim_${request.callId}`,
        status: 'failed',
        error: 'RingCentral credentials not configured (Set RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_JWT)',
      };
    }

    const token = await this.authenticate();
    if (!token) {
      return {
        providerCallId: `rc_sim_${request.callId}`,
        status: 'failed',
        error: 'RingCentral OAuth authentication failed',
      };
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/restapi/v1.0/account/~/extension/~/ring-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          from: { phoneNumber: request.fromPhone },
          to: { phoneNumber: request.toPhone },
          playPrompt: false,
          country: { id: '1' },
        }),
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({ message: response.statusText }));
        return {
          providerCallId: `rc_err_${request.callId}`,
          status: 'failed',
          error: errorData.message || `RingCentral API error: ${response.status}`,
          rawResponse: errorData,
        };
      }

      const data: any = await response.json();
      // RingOut returns an ID that correlates with the session status
      const providerCallId = String(data.id || data.sessionId);

      return {
        providerCallId,
        status: 'initiated',
        rawResponse: data,
      };
    } catch (err: any) {
      return {
        providerCallId: `rc_err_${request.callId}`,
        status: 'failed',
        error: err.message || 'RingCentral outbound request failed',
      };
    }
  }

  public async hangupCall(providerCallId: string): Promise<boolean> {
    if (!this.isConfigured() || !providerCallId || providerCallId.startsWith('rc_sim_')) {
      return true;
    }

    const token = await this.authenticate();
    if (!token) return false;

    try {
      // If providerCallId is a numeric RingOut ID, terminate via RingOut endpoint
      if (/^\d+$/.test(providerCallId)) {
        const response = await fetch(
          `${this.config.serverUrl}/restapi/v1.0/account/~/extension/~/ring-out/${providerCallId}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        return response.ok;
      }

      // Otherwise terminate via Telephony Session endpoint
      const response = await fetch(
        `${this.config.serverUrl}/restapi/v1.0/account/~/telephony/sessions/${providerCallId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  public async muteCall(providerCallId: string, mute: boolean): Promise<boolean> {
    if (!this.isConfigured() || !providerCallId) return true;
    const token = await this.authenticate();
    if (!token) return false;

    try {
      const response = await fetch(
        `${this.config.serverUrl}/restapi/v1.0/account/~/telephony/sessions/${providerCallId}/parties/~/mute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ muted: mute }),
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Normalizes incoming RingCentral Webhook notifications into strict NormalizedCallEvent.
   * Accurately parses RingCentral Telephony Session Notifications (/telephony/sessions).
   */
  public parseWebhookEvent(headers: Record<string, any>, body: any): NormalizedCallEvent | null {
    if (!body) return null;

    // 1. Validation Token Handshake
    if (headers['validation-token']) {
      return {
        providerName: this.providerName,
        providerCallId: 'handshake',
        eventType: 'initiated',
        timestamp: new Date().toISOString(),
        rawPayload: { validationToken: headers['validation-token'] },
        signatureValid: true,
      };
    }

    // 2. Webhook Signature Validation (if secret is configured)
    let signatureValid = true;
    if (this.config.webhookSecret && headers['x-ringcentral-signature']) {
      const signature = headers['x-ringcentral-signature'];
      const calculated = crypto
        .createHmac('sha256', this.config.webhookSecret)
        .update(JSON.stringify(body))
        .digest('hex');
      signatureValid = signature === calculated;
    }

    const sessionBody = body.body || body;
    const sessionId = sessionBody.telephonySessionId || sessionBody.sessionId || sessionBody.id || body.uuid;
    if (!sessionId) return null;

    // 3. Extract Prospect/Customer Party Leg
    const parties: any[] = sessionBody.parties || [];
    // Prioritize party with direction === 'Outbound' or callee role
    const prospectParty =
      parties.find((p) => p.direction === 'Outbound' || p.to?.phoneNumber) ||
      parties[0] ||
      {};

    const statusCode = (
      prospectParty.status?.code ||
      sessionBody.telephonyStatus ||
      sessionBody.status ||
      ''
    ).toLowerCase();

    let eventType: NormalizedCallEvent['eventType'] = 'initiated';
    if (statusCode === 'setup' || statusCode === 'initiating') {
      eventType = 'initiated';
    } else if (statusCode === 'proceeding' || statusCode === 'ringing') {
      eventType = 'ringing';
    } else if (statusCode === 'answered' || statusCode === 'callconnected' || statusCode === 'connected') {
      eventType = 'answered';
    } else if (statusCode === 'busy') {
      eventType = 'busy';
    } else if (statusCode === 'noanswer' || statusCode === 'rejected') {
      eventType = 'no_answer';
    } else if (
      statusCode === 'disconnected' ||
      statusCode === 'gone' ||
      statusCode === 'hangup' ||
      statusCode === 'completed'
    ) {
      eventType = 'hangup';
    } else if (statusCode === 'voicemail') {
      eventType = 'answered';
    }

    return {
      providerName: this.providerName,
      providerCallId: String(sessionId),
      eventType,
      durationSeconds: sessionBody.duration || 0,
      timestamp: body.timestamp || new Date().toISOString(),
      rawPayload: body,
      signatureValid,
    };
  }
}