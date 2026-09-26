/**
 * Vortex One Dialer - REST API Routes
 * Implements campaign ingestion, session lifecycle, call controls, dispositions, and audit events.
 */

import { Router, Request, Response } from 'express';
import { db } from '../db/db.js';
import { dialerEngine } from '../engine/DialerEngine.js';
import { providerRegistry } from '../telephony/ProviderRegistry.js';
import { normalizeCampaignContacts } from '../services/campaignIngestionService.js';
import {
  IngestCampaignRequest,
  StartSessionRequest,
  SubmitDispositionRequest,
  NormalizedCallEvent,
} from '../types/dialer.js';

export const dialerApiRouter = Router();

// 1. Health check
dialerApiRouter.get('/health', async (_req: Request, res: Response) => {
  const dbStatus = await db.getDatabaseStatus();
  res.json({
    status: 'ok',
    service: 'vortex-one-dialer',
    version: '2.1.0',
    database_driver: db.getActiveDriver(),
    postgres: db.isUsingPostgres() ? 'connected' : 'in-memory-acid-mode',
    database_status: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// 1b. Cloud SQL Database Connectivity Status
dialerApiRouter.get('/dialer/database-status', async (_req: Request, res: Response) => {
  const status = await db.getDatabaseStatus();
  res.json({
    status,
  });
});

// 1c. Database Migrations Status & History
dialerApiRouter.get('/dialer/database/migrations', async (_req: Request, res: Response) => {
  try {
    const history = await db.getMigrationHistory();
    const validation = await db.validateDatabaseSchema();
    res.json({
      success: true,
      driver: db.getActiveDriver(),
      is_postgres: db.isUsingPostgres(),
      migrations: history,
      schema_validation: validation,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1d. Database Schema Validation
dialerApiRouter.get('/dialer/database/validate', async (_req: Request, res: Response) => {
  try {
    const validation = await db.validateDatabaseSchema();
    res.json({
      success: true,
      validation,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1e. Trigger Migration Run (Admin/Migration Ops)
dialerApiRouter.post('/dialer/database/migrate', async (_req: Request, res: Response) => {
  try {
    const result = await db.runPendingMigrations();
    res.json({
      success: true,
      result,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Organizations
dialerApiRouter.get('/dialer/organizations', (_req: Request, res: Response) => {
  const orgs = db.listOrganizations();
  res.json({ organizations: orgs });
});

// 3. Campaign Ingestion (CRM -> Dialer)
dialerApiRouter.post('/dialer/campaigns', (req: Request, res: Response) => {
  const body = req.body as IngestCampaignRequest;
  if (!body.organization_id || !body.campaign_name) {
    res.status(400).json({ error: 'organization_id and campaign_name are required', code: 'INVALID_INPUT' });
    return;
  }

  const campaign = db.createCampaign({
    organization_id: body.organization_id,
    name: body.campaign_name,
    status: 'active',
    lines_per_agent: body.dial_settings?.lines_per_agent || 1,
    dial_mode: body.dial_settings?.dial_mode || 'power',
    skip_dnc: body.dial_settings?.skip_dnc !== false,
    skip_invalid: body.dial_settings?.skip_invalid !== false,
  });

  let ingestedCount = 0;
  if (Array.isArray(body.contacts)) {
    const normalizedContacts = normalizeCampaignContacts(body.contacts);
    for (const c of normalizedContacts) {
      if (c.name && c.phone) {
        db.createCampaignContact({
          organization_id: body.organization_id,
          campaign_id: campaign.id,
          external_contact_id: c.external_contact_id || `ext_${Date.now()}_${ingestedCount}`,
          name: c.name,
          phone: c.phone,
          metadata: c.metadata,
          status: 'pending',
          attempts: 0,
        });
        ingestedCount++;
      }
    }
  }

  res.status(201).json({
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    ingested_contacts: ingestedCount,
    status: campaign.status,
    created_at: campaign.created_at,
  });
});

// 4. List Campaigns
dialerApiRouter.get('/dialer/campaigns', (req: Request, res: Response) => {
  const orgId = (req.query.org_id as string) || 'org_cmc_realty_01';
  const campaigns = db.listCampaigns(orgId);
  const enriched = campaigns.map((c) => {
    const counts = db.getCampaignContactsCount(c.id, orgId);
    return { ...c, counts };
  });
  res.json({ campaigns: enriched });
});

// 5. Get Campaign Details & Contacts
dialerApiRouter.get('/dialer/campaigns/:id', (req: Request, res: Response) => {
  const campaign = db.getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
    return;
  }
  const counts = db.getCampaignContactsCount(campaign.id, campaign.organization_id);
  res.json({ campaign, counts });
});

dialerApiRouter.get('/dialer/campaigns/:id/contacts', (req: Request, res: Response) => {
  const campaign = db.getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
    return;
  }
  const contacts = Array.from(db.campaignContacts.values()).filter(
    (c) => c.campaign_id === campaign.id
  );
  res.json({ contacts });
});

// 6. Start Dialing Session (Agent Workspace)
dialerApiRouter.post('/dialer/sessions/start', async (req: Request, res: Response) => {
  const body = req.body as StartSessionRequest;
  if (!body.organization_id || !body.campaign_id || !body.agent_id) {
    res.status(400).json({ error: 'Missing required session parameters', code: 'INVALID_INPUT' });
    return;
  }

  const campaign = db.getCampaign(body.campaign_id, body.organization_id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found', code: 'NOT_FOUND' });
    return;
  }

  const linesCount = Math.min(4, Math.max(1, body.requested_lines || campaign.lines_per_agent || 1));

  const session = db.createSession({
    organization_id: body.organization_id,
    campaign_id: body.campaign_id,
    agent_id: body.agent_id,
    status: 'active',
    lines_count: linesCount,
  });

  // Automatically dispatch initial batch
  const activeCalls = await dialerEngine.dispatchNextBatch(session.id);

  res.status(201).json({
    session_id: session.id,
    status: session.status,
    lines_count: session.lines_count,
    active_calls_count: activeCalls.length,
    started_at: session.started_at,
  });
});

// 7. Get Session Status
dialerApiRouter.get('/dialer/sessions/:id', (req: Request, res: Response) => {
  const session = db.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
    return;
  }

  const activeCalls = db.getActiveCallsForSession(session.id);
  const enrichedCalls = activeCalls.map((c) => {
    const contact = db.getCampaignContact(c.campaign_contact_id);
    return { ...c, contact };
  });
  const queueCounts = db.getCampaignContactsCount(session.campaign_id, session.organization_id);
  const dispositionStats = db.getSessionDispositionStats(session.id);

  res.json({
    session,
    active_calls: enrichedCalls,
    queue_counts: queueCounts,
    disposition_stats: dispositionStats,
  });
});

// 7b. Get Session Disposition Statistics (Real-time Chart Data)
dialerApiRouter.get('/dialer/sessions/:id/dispositions', (req: Request, res: Response) => {
  const session = db.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
    return;
  }
  const stats = db.getSessionDispositionStats(session.id);
  res.json(stats);
});

// 8. Session Controls (Pause, Resume, End)
dialerApiRouter.post('/dialer/sessions/:id/pause', (req: Request, res: Response) => {
  const session = db.updateSession(req.params.id, { status: 'paused' });
  if (!session) {
    res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ session_id: session.id, status: session.status });
});

dialerApiRouter.post('/dialer/sessions/:id/resume', async (req: Request, res: Response) => {
  const session = db.updateSession(req.params.id, { status: 'active' });
  if (!session) {
    res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
    return;
  }
  await dialerEngine.dispatchNextBatch(session.id);
  res.json({ session_id: session.id, status: session.status });
});

dialerApiRouter.post('/dialer/sessions/:id/lines', (req: Request, res: Response) => {
  const count = Number(req.body.lines_count);
  if (!count || count < 1 || count > 4) {
    res.status(400).json({ error: 'lines_count must be between 1 and 4' });
    return;
  }
  const session = db.updateSession(req.params.id, { lines_count: count });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session_id: session.id, lines_count: session.lines_count });
});

dialerApiRouter.post('/dialer/sessions/:id/end', (req: Request, res: Response) => {
  const session = db.updateSession(req.params.id, {
    status: 'ended',
    ended_at: new Date().toISOString(),
  });
  if (!session) {
    res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ session_id: session.id, status: session.status, ended_at: session.ended_at });
});

// 9. Submit Disposition
dialerApiRouter.post('/dialer/calls/:id/disposition', async (req: Request, res: Response) => {
  const body = req.body as SubmitDispositionRequest;
  if (!body.disposition_code) {
    res.status(400).json({ error: 'disposition_code is required', code: 'INVALID_INPUT' });
    return;
  }

  const call = await dialerEngine.submitDisposition(req.params.id, body);
  if (!call) {
    res.status(400).json({ error: 'Unable to submit disposition for call', code: 'DISPO_FAILED' });
    return;
  }

  res.json({
    call_id: call.id,
    state: call.state,
    disposition_code: call.disposition_code,
    agent_notes: call.agent_notes,
    duration_seconds: call.duration_seconds,
  });
});

// 9b. Call Notes Management (POST /api/v1/calls/:call_id/notes)
dialerApiRouter.post(['/calls/:id/notes', '/dialer/calls/:id/notes'], (req: Request, res: Response) => {
  const { notes, text, note, author } = req.body;
  const content = text || notes || note;
  if (!content || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'Note text is required', code: 'INVALID_INPUT' });
    return;
  }

  const newNote = db.addCallNote(req.params.id, content.trim(), author || 'Kristina Madrigal');
  const allNotes = db.getCallNotes(req.params.id);

  res.status(201).json({
    success: true,
    note: newNote,
    notes: allNotes,
    call_id: req.params.id,
  });
});

dialerApiRouter.get(['/calls/:id/notes', '/dialer/calls/:id/notes'], (req: Request, res: Response) => {
  const notes = db.getCallNotes(req.params.id);
  res.json({
    call_id: req.params.id,
    notes,
  });
});

// 10. Call Event Audit Stream
dialerApiRouter.get('/dialer/calls/:id/events', (req: Request, res: Response) => {
  const events = db.getCallEvents(req.params.id);
  res.json({ call_id: req.params.id, events });
});

dialerApiRouter.get('/dialer/events', (req: Request, res: Response) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const events = db.getAllCallEvents(limit);
  res.json({ events });
});

// 11. Suppression / DNC List Management
dialerApiRouter.get('/dialer/suppression', (req: Request, res: Response) => {
  const orgId = (req.query.org_id as string) || 'org_cmc_realty_01';
  const list = db.listSuppression(orgId);
  res.json({ suppression_list: list });
});

dialerApiRouter.post('/dialer/suppression', (req: Request, res: Response) => {
  const { organization_id, phone, reason } = req.body;
  if (!organization_id || !phone) {
    res.status(400).json({ error: 'organization_id and phone are required', code: 'INVALID_INPUT' });
    return;
  }
  const record = db.addSuppression(organization_id, phone, reason || 'Manual Entry');
  res.status(201).json({ record });
});

// 12. Telephony Providers Management
dialerApiRouter.get('/dialer/providers', (_req: Request, res: Response) => {
  res.json({ providers: providerRegistry.listProviders() });
});

dialerApiRouter.post('/dialer/providers/select', (req: Request, res: Response) => {
  const { name } = req.body;
  const ok = providerRegistry.setDefaultProvider(name);
  if (!ok) {
    res.status(400).json({ error: 'Unknown telephony provider', code: 'INVALID_PROVIDER' });
    return;
  }
  res.json({ default_provider: name, success: true });
});

// 13. Telephony Webhook Ingestion
dialerApiRouter.post('/dialer/webhooks/:provider', async (req: Request, res: Response) => {
  const providerName = req.params.provider;
  const provider = providerRegistry.getProvider(providerName);
  
  const headers = req.headers as Record<string, any>;
  const body = req.body;

  // Handle RingCentral validation-token handshake header if present
  if (headers['validation-token']) {
    res.setHeader('Validation-Token', headers['validation-token']);
    res.status(200).send();
    return;
  }

  const normalizedEvent: NormalizedCallEvent | null = provider.parseWebhookEvent(headers, body);
  if (!normalizedEvent) {
    res.status(400).json({ error: 'Unrecognized webhook payload structure' });
    return;
  }

  try {
    await dialerEngine.handleNormalizedTelephonyEvent(normalizedEvent);
    res.status(200).json({ received: true, event_type: normalizedEvent.eventType });
  } catch (err: any) {
    console.error(`[Webhook Error] Failed to process ${providerName} event:`, err.message);
    res.status(500).json({ error: 'Failed to process event', details: err.message });
  }
});