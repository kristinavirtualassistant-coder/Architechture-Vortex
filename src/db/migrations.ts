/**
 * Vortex One Dialer - Production PostgreSQL Migration Engine
 * 
 * Provides automated, version-controlled, transactional DDL migrations for Google Cloud SQL PostgreSQL.
 * Ensures strict schema guarantees:
 * - Version tracking in `schema_migrations`
 * - Transactional migration execution (`BEGIN ... COMMIT`)
 * - PostgreSQL advisory locking (`pg_advisory_xact_lock`) for zero race conditions across multi-replica deployments
 * - Strict multi-tenant isolation, primary keys, foreign keys, unique constraints, and optimized indexes
 * - Idempotency for webhooks and DNC suppression
 * - Non-destructive execution protecting existing property-intelligence tables
 */

import pg from 'pg';

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: Date;
  checksum?: string;
  execution_time_ms: number;
}

export interface MigrationDefinition {
  version: number;
  name: string;
  description: string;
  sql: string;
}

/**
 * Ordered, deterministic migrations for Vortex One Dialer.
 * All migrations are transactional and safe to run repeatedly.
 */
export const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    name: '001_initial_extensions_and_tenancy',
    description: 'Install PostgreSQL extensions and bootstrap tenant/user foundation',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pg_trgm";

      -- 1. Organizations (Tenant Root)
      CREATE TABLE IF NOT EXISTS organizations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- 2. Users (Agent & Supervisors)
      CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'supervisor', 'agent')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
    `,
  },
  {
    version: 2,
    name: '002_campaign_and_contacts_schema',
    description: 'Create campaign and campaign_contact tables with queuing indexes and multi-tenant constraints',
    sql: `
      -- 3. Campaigns
      CREATE TABLE IF NOT EXISTS campaigns (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
          lines_per_agent INT NOT NULL DEFAULT 1 CHECK (lines_per_agent BETWEEN 1 AND 4),
          dial_mode VARCHAR(50) NOT NULL DEFAULT 'power' CHECK (dial_mode IN ('power', 'preview')),
          skip_dnc BOOLEAN NOT NULL DEFAULT TRUE,
          skip_invalid BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(organization_id);
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(organization_id, status);

      -- 4. Campaign Contacts
      CREATE TABLE IF NOT EXISTS campaign_contacts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          external_contact_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          phone VARCHAR(50) NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dialing', 'connected', 'completed', 'skipped', 'dnc', 'retry')),
          attempts INT NOT NULL DEFAULT 0,
          last_dialed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_contacts_queue ON campaign_contacts (campaign_id, status, attempts);
      CREATE INDEX IF NOT EXISTS idx_campaign_contacts_org ON campaign_contacts (organization_id);
      CREATE INDEX IF NOT EXISTS idx_campaign_contacts_phone ON campaign_contacts (phone);

      -- Singular views for alias compatibility
      CREATE OR REPLACE VIEW campaign AS SELECT * FROM campaigns;
      CREATE OR REPLACE VIEW campaign_contact AS SELECT * FROM campaign_contacts;
    `,
  },
  {
    version: 3,
    name: '003_dialing_session_and_calls_schema',
    description: 'Create dialing_session and call tables with FSM state constraints and timing indexes',
    sql: `
      -- 5. Dialing Sessions
      CREATE TABLE IF NOT EXISTS dialing_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          agent_id UUID NOT NULL REFERENCES users(id),
          status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
          lines_count INT NOT NULL DEFAULT 1 CHECK (lines_count BETWEEN 1 AND 4),
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_dialing_sessions_org ON dialing_sessions (organization_id);
      CREATE INDEX IF NOT EXISTS idx_dialing_sessions_agent ON dialing_sessions (agent_id, status);

      -- 6. Calls
      CREATE TABLE IF NOT EXISTS calls (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          session_id UUID NOT NULL REFERENCES dialing_sessions(id) ON DELETE CASCADE,
          campaign_contact_id UUID REFERENCES campaign_contacts(id) ON DELETE SET NULL,
          provider_name VARCHAR(50) NOT NULL,
          provider_call_id VARCHAR(255),
          line_number INT NOT NULL DEFAULT 1,
          phone_dialed VARCHAR(50) NOT NULL,
          state VARCHAR(50) NOT NULL CHECK (state IN ('INITIATED', 'DIALING', 'RINGING', 'CONNECTED', 'BUSY', 'FAILED', 'NO_ANSWER', 'DISPO_PENDING', 'TERMINATED')),
          duration_seconds INT NOT NULL DEFAULT 0,
          disposition_code VARCHAR(100),
          agent_notes TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          connected_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_calls_provider_call_id ON calls (provider_call_id);
      CREATE INDEX IF NOT EXISTS idx_calls_session ON calls (session_id);
      CREATE INDEX IF NOT EXISTS idx_calls_org ON calls (organization_id);
      CREATE INDEX IF NOT EXISTS idx_calls_state ON calls (state);
      CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls (started_at DESC);

      -- Singular views for alias compatibility
      CREATE OR REPLACE VIEW dialing_session AS SELECT * FROM dialing_sessions;
      CREATE OR REPLACE VIEW call AS SELECT * FROM calls;
    `,
  },
  {
    version: 4,
    name: '004_call_events_and_notes_schema',
    description: 'Create call_event immutable sequence audit log and call_note collaborative notes table',
    sql: `
      -- 7. Call Events (FSM Immutable Sequence Audit Log)
      CREATE TABLE IF NOT EXISTS call_events (
          id BIGSERIAL PRIMARY KEY,
          call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
          from_state VARCHAR(50) NOT NULL,
          to_state VARCHAR(50) NOT NULL,
          event VARCHAR(100) NOT NULL,
          payload JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_call_events_call_seq ON call_events (call_id, id ASC);
      CREATE INDEX IF NOT EXISTS idx_call_events_created ON call_events (created_at DESC);

      -- 8. Call Notes
      CREATE TABLE IF NOT EXISTS call_notes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
          author VARCHAR(255) NOT NULL DEFAULT 'Agent',
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_call_notes_call_id ON call_notes (call_id, created_at ASC);

      -- Singular views for alias compatibility
      CREATE OR REPLACE VIEW call_event AS SELECT * FROM call_events;
      CREATE OR REPLACE VIEW call_note AS SELECT * FROM call_notes;
    `,
  },
  {
    version: 5,
    name: '005_compliance_suppression_and_idempotency',
    description: 'Create suppression_records (DNC) and processed_events (webhook deduplication) with unique constraints',
    sql: `
      -- 9. Suppression Records (DNC Guard)
      CREATE TABLE IF NOT EXISTS suppression_records (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          phone VARCHAR(50) NOT NULL,
          reason VARCHAR(100) DEFAULT 'DNC',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_suppression_org_phone UNIQUE (organization_id, phone)
      );
      CREATE INDEX IF NOT EXISTS idx_suppression_lookup ON suppression_records (organization_id, phone);

      -- 10. Processed Events (Webhook Idempotency)
      CREATE TABLE IF NOT EXISTS processed_events (
          id BIGSERIAL PRIMARY KEY,
          provider_name VARCHAR(50) NOT NULL,
          provider_event_id VARCHAR(255) NOT NULL,
          call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
          event_type VARCHAR(100) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_processed_events_provider_event UNIQUE (provider_name, provider_event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_processed_events_provider ON processed_events (provider_name, provider_event_id);

      -- Compatibility Views
      CREATE OR REPLACE VIEW suppression_record AS SELECT * FROM suppression_records;
      CREATE OR REPLACE VIEW suppression_list AS SELECT * FROM suppression_records;
    `,
  },
  {
    version: 6,
    name: '006_property_platform_integration_safeguards',
    description: 'Verify and link property intelligence tables without destructively modifying existing datasets',
    sql: `
      -- Ensure property platform tables if they exist remain untouched and indexed
      DO $$
      BEGIN
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'property') THEN
              CREATE INDEX IF NOT EXISTS idx_property_org_lookup ON property (organization_id);
          END IF;
          IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lead') THEN
              CREATE INDEX IF NOT EXISTS idx_lead_org_lookup ON lead (organization_id);
          END IF;
      END $$;
    `,
  },
];

/**
 * Migration Manager Class
 */
export class MigrationManager {
  private static readonly ADVISORY_LOCK_ID = 74839201; // Unique integer lock ID for Vortex One dialer migrations

  /**
   * Initializes the `schema_migrations` tracking table if it doesn't already exist.
   */
  public static async ensureMigrationTable(client: pg.PoolClient | pg.Pool): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
          version INT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          checksum VARCHAR(64),
          execution_time_ms INT NOT NULL DEFAULT 0
      );
    `);
  }

  /**
   * Retrieves all applied migration records ordered by version.
   */
  public static async getAppliedMigrations(client: pg.PoolClient | pg.Pool): Promise<MigrationRecord[]> {
    await this.ensureMigrationTable(client);
    const res = await client.query<MigrationRecord>(
      'SELECT version, name, applied_at, checksum, execution_time_ms FROM schema_migrations ORDER BY version ASC;'
    );
    return res.rows;
  }

  /**
   * Executes all pending migrations in sequential, transactional order.
   * Utilizes PostgreSQL advisory locking to prevent concurrent migration execution.
   */
  public static async runMigrations(pool: pg.Pool): Promise<{
    applied: MigrationDefinition[];
    totalApplied: number;
    currentVersion: number;
  }> {
    const client = await pool.connect();
    const appliedList: MigrationDefinition[] = [];

    try {
      // 1. Acquire transactional advisory lock to prevent multiple app instances from racing
      console.log('🔒 Acquiring PostgreSQL advisory lock for migration execution...');
      await client.query('SELECT pg_advisory_lock($1);', [this.ADVISORY_LOCK_ID]);

      try {
        await this.ensureMigrationTable(client);

        const applied = await this.getAppliedMigrations(client);
        const appliedVersions = new Set(applied.map((m) => m.version));

        for (const migration of MIGRATIONS) {
          if (!appliedVersions.has(migration.version)) {
            console.log(`📦 [Migration ${migration.version}] Running: ${migration.name} (${migration.description})...`);
            const startTime = Date.now();

            // Run migration inside a strict transaction
            await client.query('BEGIN');
            try {
              await client.query(migration.sql);

              const duration = Date.now() - startTime;
              await client.query(
                `INSERT INTO schema_migrations (version, name, applied_at, execution_time_ms)
                 VALUES ($1, $2, NOW(), $3);`,
                [migration.version, migration.name, duration]
              );

              await client.query('COMMIT');
              appliedList.push(migration);
              console.log(`✅ [Migration ${migration.version}] Successfully applied in ${duration}ms.`);
            } catch (migrationErr: any) {
              await client.query('ROLLBACK');
              console.error(`❌ [Migration ${migration.version}] Failed:`, migrationErr.message);
              throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${migrationErr.message}`);
            }
          } else {
            // Already applied
          }
        }

        const latest = await this.getAppliedMigrations(client);
        const currentVersion = latest.length > 0 ? latest[latest.length - 1].version : 0;

        console.log(`✨ Database schema is up to date (Current Version: ${currentVersion}, Newly Applied: ${appliedList.length}).`);

        return {
          applied: appliedList,
          totalApplied: latest.length,
          currentVersion,
        };
      } finally {
        // Release advisory lock
        await client.query('SELECT pg_advisory_unlock($1);', [this.ADVISORY_LOCK_ID]);
        console.log('🔓 Released PostgreSQL advisory lock.');
      }
    } finally {
      client.release();
    }
  }

  /**
   * Validates that all required dialer tables and views exist in the database.
   */
  public static async validateSchema(pool: pg.Pool): Promise<{
    valid: boolean;
    missingTables: string[];
    existingTables: string[];
  }> {
    const requiredTables = [
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
      'schema_migrations',
    ];

    const client = await pool.connect();
    try {
      const res = await client.query<{ table_name: string }>(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type IN ('BASE TABLE', 'VIEW');
      `);

      const found = new Set(res.rows.map((r) => r.table_name.toLowerCase()));
      const missing = requiredTables.filter((t) => !found.has(t.toLowerCase()));

      return {
        valid: missing.length === 0,
        missingTables: missing,
        existingTables: Array.from(found),
      };
    } finally {
      client.release();
    }
  }
}
