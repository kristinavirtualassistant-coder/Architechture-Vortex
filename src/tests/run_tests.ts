/**
 * Vortex One Dialer - Automated Architecture & FSM Test Suite
 * Tests all 15 core architectural requirements.
 */

import { db } from '../db/db.js';
import { CallFsm } from '../engine/CallFsm.js';
import { DialerEngine } from '../engine/DialerEngine.js';
import { MockTelephonyProvider } from '../telephony/MockTelephonyProvider.js';
import { RingCentralProvider } from '../telephony/RingCentralProvider.js';
import { providerRegistry } from '../telephony/ProviderRegistry.js';
import {
  resolveCloudSqlConfig,
  isCloudSqlConfigured,
  testCloudSqlConnection,
  getCloudSqlConnectorInstance,
} from '../db/cloudSqlConnector.js';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(category: string, name: string, fn: () => Promise<void> | void) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, category, passed: true, durationMs: Date.now() - start });
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    results.push({ name, category, passed: false, error: err.message, durationMs: Date.now() - start });
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

export async function executeAllTests(): Promise<{ passed: number; failed: number; results: TestResult[] }> {
  console.log('\n======================================================');
  console.log('⚡ VORTEX ONE DIALER - AUTOMATED TEST SUITE EXECUTION');
  console.log('======================================================\n');

  // Group 1: Call FSM Authoritative State Machine Tests
  console.log('📦 1. Call FSM State Machine Tests');
  
  await runTest('Call FSM', 'Valid standard happy path: INITIATED -> DIALING -> RINGING -> CONNECTED -> DISPO_PENDING -> TERMINATED', async () => {
    const call = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_test_1',
      campaign_contact_id: 'c_test_1',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+15625551234',
      state: 'INITIATED',
      duration_seconds: 0,
    });

    assertEqual(call.state, 'INITIATED');

    const t1 = await CallFsm.transition(call.id, 'DISPATCH');
    assert(t1.success, 'DISPATCH must succeed');
    assertEqual(t1.toState, 'DIALING');

    const t2 = await CallFsm.transition(call.id, 'RECV_RINGING');
    assert(t2.success, 'RECV_RINGING must succeed');
    assertEqual(t2.toState, 'RINGING');

    const t3 = await CallFsm.transition(call.id, 'RECV_ANSWERED');
    assert(t3.success, 'RECV_ANSWERED must succeed');
    assertEqual(t3.toState, 'CONNECTED');
    assert(Boolean(t3.call.connected_at), 'connected_at timestamp must be set');

    const t4 = await CallFsm.transition(call.id, 'HANGUP');
    assert(t4.success, 'HANGUP must succeed');
    assertEqual(t4.toState, 'DISPO_PENDING');

    const t5 = await CallFsm.transition(call.id, 'SUBMIT_DISPO', { disposition_code: 'INTERESTED', notes: 'High equity owner' });
    assert(t5.success, 'SUBMIT_DISPO must succeed');
    assertEqual(t5.toState, 'TERMINATED');
    assertEqual(t5.call.disposition_code, 'INTERESTED');
    assertEqual(t5.call.agent_notes, 'High equity owner');
  });

  await runTest('Call FSM', 'Invalid transition rejection (cannot jump from INITIATED directly to CONNECTED or DISPO_PENDING)', async () => {
    const call = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_test_2',
      campaign_contact_id: 'c_test_2',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+15625551234',
      state: 'INITIATED',
      duration_seconds: 0,
    });

    const invalidTransition = await CallFsm.transition(call.id, 'SUBMIT_DISPO', { disposition_code: 'INTERESTED' });
    assert(!invalidTransition.success, 'Invalid transition must return success: false');
    assertEqual(call.state, 'INITIATED', 'State must remain unchanged');
  });

  await runTest('Call FSM', 'Busy failure path: DIALING -> BUSY', async () => {
    const call = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_test_3',
      campaign_contact_id: 'c_test_3',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+13105559011',
      state: 'INITIATED',
      duration_seconds: 0,
    });

    await CallFsm.transition(call.id, 'DISPATCH');
    const t = await CallFsm.transition(call.id, 'RECV_BUSY');
    assert(t.success, 'RECV_BUSY must transition to BUSY');
    assertEqual(t.toState, 'BUSY');
  });

  await runTest('Call FSM', 'No answer timeout path: RINGING -> NO_ANSWER', async () => {
    const call = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_test_4',
      campaign_contact_id: 'c_test_4',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+17145554499',
      state: 'INITIATED',
      duration_seconds: 0,
    });

    await CallFsm.transition(call.id, 'DISPATCH');
    await CallFsm.transition(call.id, 'RECV_RINGING');
    const t = await CallFsm.transition(call.id, 'TIMEOUT_NO_ANSWER');
    assert(t.success, 'TIMEOUT_NO_ANSWER must transition to NO_ANSWER');
    assertEqual(t.toState, 'NO_ANSWER');
  });

  await runTest('Call FSM', 'Early hangup and provider error transitions in pre-connected states', async () => {
    // 1. INITIATED -> HANGUP -> TERMINATED
    const callInit = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_early_hangup',
      campaign_contact_id: 'c_eh_1',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+19495551122',
      state: 'INITIATED',
      duration_seconds: 0,
    });
    const tInitHangup = await CallFsm.transition(callInit.id, 'HANGUP');
    assert(tInitHangup.success, 'INITIATED -> HANGUP must succeed');
    assertEqual(tInitHangup.toState, 'TERMINATED');

    // 2. INITIATED, DIALING, RINGING -> PROVIDER_ERROR -> FAILED
    const callDial = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_pe_test',
      campaign_contact_id: 'c_pe_1',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+19495551123',
      state: 'INITIATED',
      duration_seconds: 0,
    });
    await CallFsm.transition(callDial.id, 'DISPATCH');
    const tDialPE = await CallFsm.transition(callDial.id, 'PROVIDER_ERROR', { error: 'SIP 503 Service Unavailable' });
    assert(tDialPE.success, 'DIALING -> PROVIDER_ERROR must succeed');
    assertEqual(tDialPE.toState, 'FAILED');
  });

  await runTest('Call FSM', 'Immutable sequence audit log creation in call_events', async () => {
    const call = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_audit',
      campaign_contact_id: 'c_audit',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+15625551234',
      state: 'INITIATED',
      duration_seconds: 0,
    });

    await CallFsm.transition(call.id, 'DISPATCH', { meta: 'val1' });
    await CallFsm.transition(call.id, 'RECV_RINGING', { meta: 'val2' });
    await CallFsm.transition(call.id, 'RECV_ANSWERED', { meta: 'val3' });

    const events = db.getCallEvents(call.id);
    assert(events.length >= 3, 'Must record at least 3 sequence events');
    assertEqual(events[0].from_state, 'INITIATED');
    assertEqual(events[0].to_state, 'DIALING');
    assertEqual(events[1].from_state, 'DIALING');
    assertEqual(events[1].to_state, 'RINGING');
    assertEqual(events[2].from_state, 'RINGING');
    assertEqual(events[2].to_state, 'CONNECTED');
  });

  // Group 2: Multi-Line Dialing & Parallel Cancellation Tests
  console.log('\n📦 2. Multi-Line Dialing & Cancellation Tests');

  await runTest('Multi-Line Engine', 'Parallel line cancellation: when Line 2 answers, Line 1 and Line 3 are automatically cancelled', async () => {
    const testSession = db.createSession({
      organization_id: 'org_cmc_realty_01',
      campaign_id: 'cmp_oc_high_equity_01',
      agent_id: 'usr_kristina_01',
      status: 'active',
      lines_count: 3,
    });

    const call1 = db.createCall({
      organization_id: testSession.organization_id,
      session_id: testSession.id,
      campaign_contact_id: 'contact_1',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+15625550001',
      state: 'RINGING',
      duration_seconds: 0,
    });
    const call2 = db.createCall({
      organization_id: testSession.organization_id,
      session_id: testSession.id,
      campaign_contact_id: 'contact_2',
      provider_name: 'mock',
      line_number: 2,
      phone_dialed: '+15625550002',
      state: 'RINGING',
      duration_seconds: 0,
    });
    const call3 = db.createCall({
      organization_id: testSession.organization_id,
      session_id: testSession.id,
      campaign_contact_id: 'contact_3',
      provider_name: 'mock',
      line_number: 3,
      phone_dialed: '+15625550003',
      state: 'DIALING',
      duration_seconds: 0,
    });

    const engine = new DialerEngine();
    
    // Simulate line 2 answered
    await engine.handleNormalizedTelephonyEvent({
      providerName: 'mock',
      providerCallId: call2.id,
      callId: call2.id,
      eventType: 'answered',
      timestamp: new Date().toISOString(),
      rawPayload: {},
    });

    const updatedCall1 = db.getCall(call1.id)!;
    const updatedCall2 = db.getCall(call2.id)!;
    const updatedCall3 = db.getCall(call3.id)!;

    assertEqual(updatedCall2.state, 'CONNECTED', 'Winning call must be CONNECTED');
    assertEqual(updatedCall1.state, 'TERMINATED', 'Parallel Line 1 must be cancelled/TERMINATED');
    assertEqual(updatedCall3.state, 'TERMINATED', 'Parallel Line 3 must be cancelled/TERMINATED');
  });

  // Group 3: Compliance & Suppression DNC Checks
  console.log('\n📦 3. Compliance & DNC Suppression Tests');

  await runTest('Compliance', 'Suppression list check prevents dispatching DNC phone numbers', async () => {
    const orgId = 'org_cmc_realty_01';
    const dncPhone = '+17145559999';
    db.addSuppression(orgId, dncPhone, 'National DNC Registry');

    assert(db.isNumberSuppressed(orgId, dncPhone), 'Phone must be identified as suppressed');
    assert(!db.isNumberSuppressed(orgId, '+15625551234'), 'Clean number must not be suppressed');
  });

  // Group 4: Webhook Idempotency & Normalization Tests
  console.log('\n📦 4. Webhook Normalization & Idempotency Tests');

  await runTest('Webhooks', 'Webhook duplicate event deduplication (idempotency)', () => {
    const engine = new DialerEngine();
    const call = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_idem',
      campaign_contact_id: 'c_idem',
      provider_name: 'mock',
      provider_call_id: 'mock_idem_123',
      line_number: 1,
      phone_dialed: '+15625551234',
      state: 'DIALING',
      duration_seconds: 0,
    });

    const eventPayload = {
      providerName: 'mock',
      providerCallId: 'mock_idem_123',
      callId: call.id,
      eventType: 'ringing' as const,
      timestamp: new Date().toISOString(),
      rawPayload: {},
    };

    // First event
    engine.handleNormalizedTelephonyEvent(eventPayload);
    const eventCount1 = db.getCallEvents(call.id).length;

    // Duplicate event (same providerCallId + eventType)
    engine.handleNormalizedTelephonyEvent(eventPayload);
    const eventCount2 = db.getCallEvents(call.id).length;

    assertEqual(eventCount1, eventCount2, 'Duplicate webhook event must not create duplicate transitions or records');
  });

  await runTest('RingCentral', 'RingCentral webhook payload parsing and event normalization', () => {
    const rc = new RingCentralProvider();
    
    // Test Handshake
    const handshake = rc.parseWebhookEvent({ 'validation-token': 'abc-123-token' }, {});
    assert(Boolean(handshake), 'Handshake event must be parsed');
    assertEqual(handshake?.rawPayload.validationToken, 'abc-123-token');

    // Test Telephony Session Answered Event
    const rcBody = {
      sessionId: 'rc_session_992',
      telephonyStatus: 'CallConnected',
      parties: [{ id: 'p1', status: { code: 'Answered' } }],
    };
    const parsed = rc.parseWebhookEvent({}, rcBody);
    assert(Boolean(parsed), 'Telephony session event must be parsed');
    assertEqual(parsed?.eventType, 'answered');
    assertEqual(parsed?.providerCallId, 'rc_session_992');
  });

  // Group 5: Multi-Tenancy Isolation Tests
  console.log('\n📦 5. Multi-Tenancy Isolation Tests');

  await runTest('Multi-Tenancy', 'Strict organization isolation: campaigns and contacts belonging to Org A are invisible to Org B', () => {
    const orgA = db.getOrganization('org_cmc_realty_01')!;
    const orgB = db.createOrganization('Apex Commercial Real Estate');

    const campA = db.createCampaign({
      organization_id: orgA.id,
      name: 'Org A Exclusive Leads',
      status: 'active',
      lines_per_agent: 2,
      dial_mode: 'power',
      skip_dnc: true,
      skip_invalid: true,
    });

    const campB = db.createCampaign({
      organization_id: orgB.id,
      name: 'Org B Commercial Portfolio',
      status: 'active',
      lines_per_agent: 1,
      dial_mode: 'power',
      skip_dnc: true,
      skip_invalid: true,
    });

    const listA = db.listCampaigns(orgA.id);
    const listB = db.listCampaigns(orgB.id);

    assert(listA.some((c) => c.id === campA.id), 'Org A list must contain campA');
    assert(!listA.some((c) => c.id === campB.id), 'Org A list must NOT contain campB');
    assert(listB.some((c) => c.id === campB.id), 'Org B list must contain campB');
    assert(!listB.some((c) => c.id === campA.id), 'Org B list must NOT contain campA');
  });

  // Group 6: Call Notes Persistence Tests
  console.log('\n📦 6. Call Notes Persistence Tests');

  await runTest('Call Notes', 'Persisting and retrieving notes per call with author and timestamp audit', () => {
    const call = db.createCall({
      organization_id: 'org_cmc_realty_01',
      session_id: 'sess_notes_test',
      campaign_contact_id: 'c_notes_1',
      provider_name: 'mock',
      line_number: 1,
      phone_dialed: '+15625557788',
      state: 'CONNECTED',
      duration_seconds: 45,
    });

    const note1 = db.addCallNote(call.id, 'Owner interested in 1031 exchange', 'Kristina Madrigal');
    assert(Boolean(note1.id), 'Note must have unique ID');
    assertEqual(note1.author, 'Kristina Madrigal');
    assertEqual(note1.text, 'Owner interested in 1031 exchange');

    const note2 = db.addCallNote(call.id, 'Follow up scheduled for Thursday 2pm', 'Kristina Madrigal');
    const notes = db.getCallNotes(call.id);

    assertEqual(notes.length, 2, 'Call must have 2 saved notes');
    assertEqual(notes[0].text, 'Owner interested in 1031 exchange');
    assertEqual(notes[1].text, 'Follow up scheduled for Thursday 2pm');

    const updatedCall = db.getCall(call.id)!;
    assert(updatedCall.agent_notes?.includes('1031 exchange') || false, 'Call agent_notes should be updated');
  });

  // Group 7: Google Cloud SQL Node.js Connector & IAM Auth Tests
  console.log('📦 7. Google Cloud SQL Connector & IAM Authentication Tests');

  await runTest('Cloud SQL Connector', 'Configuration resolution correctly parses IAM auth and instance connection names', () => {
    const config = resolveCloudSqlConfig({
      instanceConnectionName: 'vortex-one:us-central1:vortex-one-pg',
      database: 'vortex_dialer',
      iamUser: 'vortex-dialer-sa@vortex-one.iam.gserviceaccount.com',
      ipType: 'PUBLIC',
      authType: 'IAM',
    });

    assert(Boolean(config), 'Config should resolve properly');
    assertEqual(config?.instanceConnectionName, 'vortex-one:us-central1:vortex-one-pg');
    assertEqual(config?.database, 'vortex_dialer');
    assertEqual(config?.iamUser, 'vortex-dialer-sa@vortex-one.iam.gserviceaccount.com');
    assertEqual(config?.authType, 'IAM');
    assertEqual(config?.ipType, 'PUBLIC');
  });

  await runTest('Cloud SQL Connector', 'isCloudSqlConfigured returns false for empty or unconfigured instances', () => {
    const isConfiguredEmpty = isCloudSqlConfigured({ instanceConnectionName: '' });
    assertEqual(isConfiguredEmpty, false, 'Should be unconfigured when instance name is empty');
    const isConfiguredMalformed = isCloudSqlConfigured({ instanceConnectionName: 'invalid-single-token' });
    assertEqual(isConfiguredMalformed, false, 'Should be unconfigured when instance name is malformed');
    const isConfiguredPartial = isCloudSqlConfigured({ instanceConnectionName: 'project:region' });
    assertEqual(isConfiguredPartial, false, 'Should be unconfigured when instance name lacks 3 parts');
  });

  await runTest('Cloud SQL Connector', 'Connector singleton is instantiated and cached correctly', () => {
    const connector1 = getCloudSqlConnectorInstance();
    const connector2 = getCloudSqlConnectorInstance();
    assert(connector1 === connector2, 'Connector instance must be cached as singleton');
  });

  await runTest('Cloud SQL Connector', 'Database status diagnostic reports active engine and health state without throwing', async () => {
    const status = await db.getDatabaseStatus();
    assert(typeof status.success === 'boolean', 'status.success should be a boolean');
    assert(typeof status.driver === 'string', 'status.driver should be reported');
    assert(typeof status.database === 'string', 'status.database should be reported');
  });

  // Group 8: PostgreSQL DDL Migration Engine & Fail-Fast Production Guardrails
  console.log('\n📦 8. Migration Engine & Production Schema Validation Tests');

  await runTest('Migrations', 'Migration definitions are ordered, versioned, and complete for all required dialer tables', async () => {
    const { MIGRATIONS } = await import('../db/migrations.js');
    assert(Array.isArray(MIGRATIONS), 'MIGRATIONS must be an array');
    assert(MIGRATIONS.length >= 6, 'Must contain at least 6 structured migrations');

    // Verify ascending versions
    for (let i = 0; i < MIGRATIONS.length; i++) {
      assertEqual(MIGRATIONS[i].version, i + 1, `Migration index ${i} must have sequential version ${i + 1}`);
      assert(Boolean(MIGRATIONS[i].name), `Migration ${i + 1} must have a descriptive name`);
      assert(Boolean(MIGRATIONS[i].sql), `Migration ${i + 1} must contain valid DDL SQL`);
    }

    const fullSql = MIGRATIONS.map((m) => m.sql).join('\n');
    const requiredEntities = [
      'organizations',
      'users',
      'campaigns',
      'campaign_contacts',
      'dialing_sessions',
      'calls',
      'call_events',
      'call_notes',
      'suppression_records',
      'processed_events',
    ];

    for (const entity of requiredEntities) {
      assert(fullSql.includes(entity), `Migrations must define required dialer entity: ${entity}`);
    }
  });

  await runTest('Migrations', 'Database migration status and history API returns structured records', async () => {
    const history = await db.getMigrationHistory();
    assert(Array.isArray(history), 'Migration history must return an array');
    assert(history.length > 0, 'Migration history should report available migrations');
    assert(typeof history[0].version === 'number', 'Migration record version must be numeric');
    assert(typeof history[0].name === 'string', 'Migration record name must be string');
  });

  await runTest('Migrations', 'Schema validation verifies all dialer core tables and views', async () => {
    const validation = await db.validateDatabaseSchema();
    assert(typeof validation.valid === 'boolean', 'Validation result must report boolean validity');
    assert(validation.valid === true, 'Default schema validation must pass');
    assert(Array.isArray(validation.existingTables), 'Existing tables must be an array');
    assert(validation.existingTables.includes('calls'), 'Calls table must be present');
    assert(validation.existingTables.includes('processed_events'), 'Processed events table must be present');
    assert(validation.existingTables.includes('suppression_records'), 'Suppression records table must be present');
  });

  await runTest('Migrations', 'Fail-fast production safeguard throws error if Cloud SQL connection fails in production mode', async () => {
    const { DatabaseStore } = await import('../db/db.js');
    const testStore = new DatabaseStore();

    // Temporarily simulate production environment with an unresolvable Cloud SQL instance
    const origNodeEnv = process.env.NODE_ENV;
    const origConnName = process.env.INSTANCE_CONNECTION_NAME;

    try {
      process.env.NODE_ENV = 'production';
      process.env.INSTANCE_CONNECTION_NAME = 'invalid-proj:us-central1:invalid-inst';

      let threwError = false;
      try {
        await testStore.initialize();
      } catch (err: any) {
        threwError = true;
        assert(err.message.includes('CRITICAL PRODUCTION FAILURE'), 'Error message must reflect fail-fast policy');
      }

      assert(threwError, 'DatabaseStore.initialize must fail fast and throw in production instead of silent in-memory fallback');
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      process.env.INSTANCE_CONNECTION_NAME = origConnName;
    }
  });

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n======================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  return { passed, failed, results };
}

// Auto-run if executed directly via tsx
if (process.argv[1]?.endsWith('run_tests.ts')) {
  executeAllTests().then((res) => {
    if (res.failed > 0) {
      process.exit(1);
    }
  });
}
