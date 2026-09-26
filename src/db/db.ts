/**
 * Vortex One Dialer - Database Layer
 * Supports PostgreSQL pool with automatic fallback to an in-memory ACID store when DATABASE_URL is not set.
 */

import { v4 as uuidv4 } from 'uuid';
import pg from 'pg';
import Papa from 'papaparse';
import {
  Organization,
  User,
  Campaign,
  CampaignContact,
  DialingSession,
  Call,
  CallEvent,
  CallNote,
  SuppressionRecord,
  FsmCallState,
  FsmTriggerEvent,
} from '../types/dialer.js';
import { RAW_LIVE_LEADS_CSV } from '../data/liveLeads.js';
import { normalizePropertyMetadata, extractCleanValue } from '../services/campaignIngestionService.js';
import {
  createCloudSqlPool,
  isCloudSqlConfigured,
  closeCloudSqlConnector,
  testCloudSqlConnection,
  DatabaseConnectivityReport,
  resolveCloudSqlConfig,
} from './cloudSqlConnector.js';
import {
  MigrationManager,
  MigrationRecord,
  MIGRATIONS,
} from './migrations.js';

const { Pool } = pg;

export class DatabaseStore {
  private pool: pg.Pool | null = null;
  private isPostgresConnected = false;
  private activeDriver: 'cloud-sql-iam-connector' | 'standard-pg' | 'in-memory-fallback' = 'in-memory-fallback';

  // In-Memory Tables (ACID memory store fallback)
  public organizations: Map<string, Organization> = new Map();
  public users: Map<string, User> = new Map();
  public campaigns: Map<string, Campaign> = new Map();
  public campaignContacts: Map<string, CampaignContact> = new Map();
  public dialingSessions: Map<string, DialingSession> = new Map();
  public calls: Map<string, Call> = new Map();
  public callEvents: CallEvent[] = [];
  public callNotes: Map<string, CallNote[]> = new Map(); // key: call_id
  public suppressionList: Map<string, SuppressionRecord> = new Map(); // key: `${orgId}:${phone}`
  private eventIdSeq = 1;

  constructor() {
    this.seedDefaultData();
  }

  public async initialize(): Promise<void> {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VORTEX_ENV === 'production';
    const isCloudSqlExplicitlySet = isCloudSqlConfigured();

    // 1. Check for Cloud SQL Connector with IAM Authentication
    if (isCloudSqlExplicitlySet) {
      try {
        console.log('🚀 Attempting Cloud SQL Connector initialization with IAM database auth...');
        this.pool = await createCloudSqlPool();
        const client = await this.pool.connect();
        client.release();
        this.isPostgresConnected = true;
        this.activeDriver = 'cloud-sql-iam-connector';
        console.log('✅ Connected to Google Cloud SQL via IAM Connector');

        // Automatically execute migrations and schema validation on startup
        console.log('🔄 Running production database migrations on Cloud SQL...');
        const migrationResult = await MigrationManager.runMigrations(this.pool);
        console.log(`✅ Migrations completed: ${migrationResult.applied.length} new applied, current version: ${migrationResult.currentVersion}`);

        const validation = await MigrationManager.validateSchema(this.pool);
        if (!validation.valid) {
          throw new Error(`Schema validation failed! Missing required tables: ${validation.missingTables.join(', ')}`);
        }
        console.log('✅ Schema validation passed: all dialer tables verified.');
        return;
      } catch (err: any) {
        console.error('🚨 [Cloud SQL IAM Connector] Initialization or Migration failed:', err.message);
        if (this.pool) {
          try {
            await this.pool.end();
          } catch {
            // Ignore pool end error
          }
          this.pool = null;
        }
        this.isPostgresConnected = false;

        // PRODUCTION SAFETY: Fail fast in production or when Cloud SQL is explicitly configured!
        if (isProduction || isCloudSqlExplicitlySet) {
          throw new Error(
            `🚨 CRITICAL PRODUCTION FAILURE: Cloud SQL is configured but connection or migration failed (${err.message}). ` +
            `Refusing to silently fall back to in-memory persistence in production.`
          );
        }
      }
    }

    // 2. Check for standard DATABASE_URL
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl && !dbUrl.includes('placeholder') && !dbUrl.includes('localhost:5432') && !dbUrl.includes('127.0.0.1:5432')) {
      try {
        this.pool = new Pool({
          connectionString: dbUrl,
          connectionTimeoutMillis: 2000,
        });
        this.pool.on('error', () => {
          this.isPostgresConnected = false;
        });
        const client = await this.pool.connect();
        client.release();
        this.isPostgresConnected = true;
        this.activeDriver = 'standard-pg';
        console.log('✅ Connected to PostgreSQL database');

        console.log('🔄 Running database migrations on PostgreSQL...');
        const migrationResult = await MigrationManager.runMigrations(this.pool);
        console.log(`✅ Migrations completed: ${migrationResult.applied.length} applied, current version: ${migrationResult.currentVersion}`);
        return;
      } catch (err: any) {
        if (this.pool) {
          try {
            await this.pool.end();
          } catch {
            // Ignore pool end errors
          }
          this.pool = null;
        }
        this.isPostgresConnected = false;
        if (isProduction) {
          throw new Error(
            `🚨 CRITICAL PRODUCTION FAILURE: PostgreSQL DATABASE_URL is configured but connection failed (${err.message}). ` +
            `Refusing to silently fall back to in-memory persistence in production.`
          );
        }
        this.activeDriver = 'in-memory-fallback';
        console.log('ℹ️ Running Vortex One Dialer with ACID in-memory persistence engine (Development Mode).');
      }
    } else {
      this.activeDriver = 'in-memory-fallback';
      console.log('ℹ️ Running Vortex One Dialer with ACID in-memory persistence engine (Development/Test Mode).');
    }
  }

  public isUsingPostgres(): boolean {
    return this.isPostgresConnected;
  }

  public getPool(): pg.Pool | null {
    return this.pool;
  }

  public getActiveDriver(): 'cloud-sql-iam-connector' | 'standard-pg' | 'in-memory-fallback' {
    return this.activeDriver;
  }

  public async runPendingMigrations() {
    if (!this.pool) {
      return { applied: [], totalApplied: 0, currentVersion: MIGRATIONS.length, inMemory: true };
    }
    return await MigrationManager.runMigrations(this.pool);
  }

  public async getMigrationHistory(): Promise<MigrationRecord[]> {
    if (!this.pool) {
      return MIGRATIONS.map((m) => ({
        version: m.version,
        name: m.name,
        applied_at: new Date(),
        execution_time_ms: 0,
      }));
    }
    return await MigrationManager.getAppliedMigrations(this.pool);
  }

  public async validateDatabaseSchema() {
    if (!this.pool) {
      return {
        valid: true,
        inMemory: true,
        missingTables: [],
        existingTables: ['campaigns', 'campaign_contacts', 'dialing_sessions', 'calls', 'call_events', 'call_notes', 'suppression_records', 'processed_events'],
      };
    }
    return await MigrationManager.validateSchema(this.pool);
  }

  public async getDatabaseStatus(): Promise<DatabaseConnectivityReport> {
    if (this.activeDriver === 'cloud-sql-iam-connector' && this.pool) {
      return await testCloudSqlConnection(this.pool);
    }
    const config = resolveCloudSqlConfig();
    return {
      success: this.isPostgresConnected,
      driver: this.activeDriver,
      instanceConnectionName: config?.instanceConnectionName,
      database: config?.database || 'vortex_dialer',
      iamUser: config?.iamUser,
      authType: config?.authType || 'IAM',
      activePoolClients: this.pool ? this.pool.totalCount - this.pool.idleCount : 0,
      idlePoolClients: this.pool ? this.pool.idleCount : 0,
      totalPoolClients: this.pool ? this.pool.totalCount : 0,
    };
  }

  public async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {
        // Ignore pool end errors
      }
      this.pool = null;
    }
    await closeCloudSqlConnector();
    this.isPostgresConnected = false;
    console.log('✅ PostgreSQL connection pool drained and closed.');
  }

  private seedDefaultData() {
    // 1. Default Organization
    const defaultOrg: Organization = {
      id: 'org_cmc_realty_01',
      name: 'CMC Realty Partners (Orange County)',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.organizations.set(defaultOrg.id, defaultOrg);

    // 2. Default Agents
    const agent1: User = {
      id: 'usr_kristina_01',
      organization_id: defaultOrg.id,
      email: 'kristina@cmcrealty.com',
      name: 'Kristina Madrigal',
      role: 'agent',
      created_at: new Date().toISOString(),
    };
    const admin1: User = {
      id: 'usr_admin_01',
      organization_id: defaultOrg.id,
      email: 'admin@vortexpower.io',
      name: 'Dialer Admin',
      role: 'admin',
      created_at: new Date().toISOString(),
    };
    this.users.set(agent1.id, agent1);
    this.users.set(admin1.id, admin1);

    // 3. Default Campaign: Orange County High Equity Owners
    const defaultCampaign: Campaign = {
      id: 'cmp_oc_high_equity_01',
      organization_id: defaultOrg.id,
      name: 'OC High Equity Absentee Owners (FIPS 06059)',
      status: 'active',
      lines_per_agent: 3,
      dial_mode: 'power',
      skip_dnc: true,
      skip_invalid: true,
      created_at: new Date().toISOString(),
    };
    this.campaigns.set(defaultCampaign.id, defaultCampaign);

    // 4. Seed Contacts with Real OC Property Attributes (APN, address, equity, CRM pipeline metadata)
    const seedContacts = [
      {
        external_contact_id: 'crm_lead_991823',
        name: 'John & Martha Smith',
        phone: '+15625551234',
        metadata: {
          apn: '580-081-01',
          property_address: '123 Main St',
          city: 'Anaheim',
          state: 'CA',
          zip: '92805',
          property_type_standardized: 'Single Family Residence',
          property_type: 'SFR 3BD/2BA',
          units: 1,
          is_vacant: false,
          is_owner_occupied: false,
          secondary_phones: '+1 (562) 555-1235, +1 (562) 555-8899',
          tracked_phone: '+1 (714) 555-0101',
          email: 'smith.investments@example.com',
          stage_name_standardized: 'Discovery / Follow Up',
          stage_status_standardized: 'Active',
          stage_name: 'Lead Qualification',
          stage_status: 'In Progress',
          source_name: 'County GIS Tax Assessor',
          referrer_name: 'Orange County Public Records',
          assigned_to: 'Kristina Madrigal',
          pipeline_name: 'OC High Equity Absentee',
          next_task_kind: 'Power Dial Outbound',
          next_task_due_at: '2026-08-25 10:00 AM',
          tag_list: 'Absentee, High Equity, Distressed Tax',
          estimated_equity: '$485,000',
          assessed_value: '$780,000',
          owner_type: 'Absentee Owner',
        },
      },
      {
        external_contact_id: 'crm_lead_882104',
        name: 'Sarah Jenkins (Trustee)',
        phone: '+17145558821',
        metadata: {
          apn: '580-081-02-A',
          property_address: '456 Oak Avenue',
          city: 'Irvine',
          state: 'CA',
          zip: '92618',
          property_type_standardized: 'Duplex (2-4 Units)',
          property_type: 'Duplex Residential',
          units: 2,
          is_vacant: 'Yes',
          is_owner_occupied: 'No',
          secondary_phones: '+1 (714) 555-8822',
          tracked_phone: '+1 (714) 555-0102',
          email: 'sjenkins.trust@estatelegal.com',
          stage_name_standardized: 'Contact Discovery',
          stage_status_standardized: 'Qualified',
          stage_name: 'Estate Trust Outreach',
          stage_status: 'Pending Review',
          source_name: 'Probate / Trust Filing',
          referrer_name: 'Direct Mail Response',
          assigned_to: 'Kristina Madrigal',
          pipeline_name: 'Estate Trust & Probate',
          next_task_kind: 'Send Offer Memorandum',
          next_task_due_at: '2026-08-26 02:30 PM',
          tag_list: 'Trustee, Duplex, Vacant Unit, High Equity',
          estimated_equity: '$620,000',
          assessed_value: '$1,250,000',
          owner_type: 'High Equity (Trust)',
        },
      },
      {
        external_contact_id: 'crm_lead_773911',
        name: 'Robert Martinez',
        phone: '+19495553312',
        metadata: {
          apn: '932-110-44',
          property_address: '789 Harbor Blvd #102',
          city: 'Costa Mesa',
          state: 'CA',
          zip: '92627',
          property_type_standardized: 'Condominium',
          property_type: 'Residential Condo',
          units: 1,
          is_vacant: false,
          is_owner_occupied: false,
          secondary_phones: '+1 (702) 555-3319',
          tracked_phone: '+1 (714) 555-0103',
          email: 'rmartinez.nv@vegasproperties.net',
          stage_name_standardized: 'Out of State Owner',
          stage_status_standardized: 'Active',
          stage_name: 'Absentee Owner Outreach',
          stage_status: 'Ready to Dial',
          source_name: 'Title Company Export',
          referrer_name: 'Cold Outreach Campaign',
          assigned_to: 'Kristina Madrigal',
          pipeline_name: 'Out of State Owners',
          next_task_kind: 'Phone Call',
          next_task_due_at: '2026-08-24 04:00 PM',
          tag_list: 'Out-of-State, Nevada Resident, Rental Unit',
          estimated_equity: '$380,000',
          assessed_value: '$650,000',
          owner_type: 'Out-of-State Owner (NV)',
        },
      },
      {
        external_contact_id: 'crm_lead_662819',
        name: 'Pacific Heritage Holdings LLC',
        phone: '+13105559011',
        metadata: {
          apn: '144-220-19',
          property_address: '2200 E Ball Rd',
          city: 'Anaheim',
          state: 'CA',
          zip: '92806',
          property_type_standardized: 'Multi-Family (4 Units)',
          property_type: 'Commercial Multi-Family',
          units: 4,
          is_vacant: 'No',
          is_owner_occupied: 'No',
          secondary_phones: '+1 (310) 555-9012, +1 (310) 555-9015',
          tracked_phone: '+1 (714) 555-0104',
          email: 'acquisitions@pacificheritageholdings.com',
          stage_name_standardized: 'Corporate Resolution',
          stage_status_standardized: 'Active',
          stage_name: 'LLC Entity Contact',
          stage_status: 'Managing Member ID',
          source_name: 'California Secretary of State',
          referrer_name: 'Entity Resolution Engine',
          assigned_to: 'Dialer Admin',
          pipeline_name: 'Commercial Multi-Family',
          next_task_kind: 'Entity Research & Managing Member Call',
          next_task_due_at: '2026-08-27 11:00 AM',
          tag_list: 'LLC, Multi-Family, Commercial, 4-Plex',
          estimated_equity: '$940,000',
          assessed_value: '$1,890,000',
          owner_type: 'Corporate Entity',
        },
      },
      {
        external_contact_id: 'crm_lead_551029',
        name: 'David & Linda Chen',
        phone: '+17145554499',
        metadata: {
          apn: '320-191-05',
          property_address: '15402 Culver Dr',
          city: 'Irvine',
          state: 'CA',
          zip: '92604',
          property_type_standardized: 'Single Family Residence',
          property_type: 'SFR Luxury',
          units: 1,
          is_vacant: false,
          is_owner_occupied: true,
          secondary_phones: '+1 (714) 555-4498',
          tracked_phone: '+1 (714) 555-0105',
          email: 'chen.family.irvine@example.com',
          stage_name_standardized: 'High Equity Owner Occupied',
          stage_status_standardized: 'Nurture',
          stage_name: 'Equity Harvest Campaign',
          stage_status: 'Follow-up Scheduled',
          source_name: 'GIS Assessor Records',
          referrer_name: 'Neighborhood Farming',
          assigned_to: 'Kristina Madrigal',
          pipeline_name: 'Irvine High Net Worth',
          next_task_kind: 'Follow Up Call',
          next_task_due_at: '2026-08-28 09:30 AM',
          tag_list: 'Owner Occupied, High Equity, Low LTV',
          estimated_equity: '$510,000',
          assessed_value: '$980,000',
          owner_type: 'Owner Occupied',
        },
      },
      {
        external_contact_id: 'crm_lead_440182',
        name: 'Angela Rossi',
        phone: '+19495557766',
        metadata: {
          apn: '411-098-12',
          property_address: '340 Ocean Ave',
          city: 'Laguna Beach',
          state: 'CA',
          zip: '92651',
          property_type_standardized: 'Single Family Residence',
          property_type: 'Oceanfront SFR',
          units: 1,
          is_vacant: 'Yes',
          is_owner_occupied: 'No',
          secondary_phones: '+1 (949) 555-7767',
          tracked_phone: '+1 (714) 555-0106',
          email: 'arossi.designs@coastalestate.com',
          stage_name_standardized: 'Negotiation',
          stage_status_standardized: 'Hot Lead',
          stage_name: 'Cash Offer Submitted',
          stage_status: 'Offer Under Review',
          source_name: 'Direct Inbound Call',
          referrer_name: 'Online Property Valuation',
          assigned_to: 'Kristina Madrigal',
          pipeline_name: 'Coastal Premium Acquisitions',
          next_task_kind: 'Review Counter-Offer',
          next_task_due_at: '2026-08-25 03:00 PM',
          tag_list: 'Laguna Beach, Coastal, Vacant Luxury, High Equity',
          estimated_equity: '$1,450,000',
          assessed_value: '$2,400,000',
          owner_type: 'Absentee Owner',
        },
      },
    ];

    seedContacts.forEach((sc) => {
      const contact: CampaignContact = {
        id: uuidv4(),
        organization_id: defaultOrg.id,
        campaign_id: defaultCampaign.id,
        external_contact_id: sc.external_contact_id,
        name: sc.name,
        phone: sc.phone,
        metadata: sc.metadata,
        status: 'pending',
        attempts: 0,
        created_at: new Date().toISOString(),
      };
      this.campaignContacts.set(contact.id, contact);
    });

    // 5. Seed Live Leads Campaign (76 Live CRM Records)
    const liveCampaign: Campaign = {
      id: 'cmp_live_pm_leads_01',
      organization_id: defaultOrg.id,
      name: 'Live Property Management Leads (Kristina Madrigal)',
      status: 'active',
      lines_per_agent: 3,
      dial_mode: 'power',
      skip_dnc: true,
      skip_invalid: true,
      created_at: new Date().toISOString(),
    };
    this.campaigns.set(liveCampaign.id, liveCampaign);

    try {
      const parsedCsv = Papa.parse(RAW_LIVE_LEADS_CSV, {
        header: true,
        skipEmptyLines: true,
      });

      if (parsedCsv.data && Array.isArray(parsedCsv.data)) {
        (parsedCsv.data as Record<string, any>[]).forEach((row, idx) => {
          const name =
            extractCleanValue(row, 'Name', 'name', 'full_name', 'contact_name', 'owner_name') ||
            'Unknown Lead';

          const rawPhone = extractCleanValue(row, 'Primary Phone', 'phone', 'primary_phone', 'mobile') || '';
          const cleanPhone = rawPhone.trim();

          const metadata = normalizePropertyMetadata(row, idx);

          // Check for DNC or Invalid conditions
          const isDnc =
            metadata.stage_name_standardized?.toLowerCase().includes('do not contact') ||
            metadata.stage_name?.toLowerCase().includes('do not email') ||
            metadata.stage_name?.toLowerCase().includes('do not contact') ||
            metadata.stage_status_standardized === 'lost';

          const isInvalid =
            metadata.stage_name_standardized?.toLowerCase().includes('invalid') ||
            metadata.stage_status_standardized === 'invalid';

          let initialStatus: CampaignContact['status'] = 'pending';
          if (isDnc) {
            initialStatus = 'dnc';
            if (cleanPhone) {
              this.suppressionList.set(`${defaultOrg.id}:${cleanPhone}`, {
                id: uuidv4(),
                organization_id: defaultOrg.id,
                phone: cleanPhone,
                reason: 'CRM Do Not Contact / Lost Status',
                created_at: new Date().toISOString(),
              });
            }
          } else if (isInvalid) {
            initialStatus = 'skipped';
          }

          const contact: CampaignContact = {
            id: `live_lead_${idx + 1}`,
            organization_id: defaultOrg.id,
            campaign_id: liveCampaign.id,
            external_contact_id: `crm_live_${idx + 1}`,
            name,
            phone: cleanPhone,
            metadata,
            status: initialStatus,
            attempts: 0,
            created_at: new Date().toISOString(),
          };

          this.campaignContacts.set(contact.id, contact);
        });
      }
    } catch (err) {
      console.error('[DatabaseStore] Error seeding live leads CSV:', err);
    }

    // 6. Seed one DNC suppression number for testing
    const dncRecord: SuppressionRecord = {
      id: uuidv4(),
      organization_id: defaultOrg.id,
      phone: '+17145559999',
      reason: 'National DNC Registry',
      created_at: new Date().toISOString(),
    };
    this.suppressionList.set(`${defaultOrg.id}:${dncRecord.phone}`, dncRecord);
  }

  // --- CRUD & Queries ---

  // Organizations
  public getOrganization(id: string): Organization | undefined {
    return this.organizations.get(id);
  }

  public listOrganizations(): Organization[] {
    return Array.from(this.organizations.values());
  }

  public createOrganization(name: string): Organization {
    const org: Organization = {
      id: uuidv4(),
      name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.organizations.set(org.id, org);
    return org;
  }

  // Campaigns
  public getCampaign(id: string, orgId?: string): Campaign | undefined {
    const campaign = this.campaigns.get(id);
    if (!campaign) return undefined;
    if (orgId && campaign.organization_id !== orgId) return undefined;
    return campaign;
  }

  public listCampaigns(orgId: string): Campaign[] {
    return Array.from(this.campaigns.values()).filter((c) => c.organization_id === orgId);
  }

  public createCampaign(campaign: Omit<Campaign, 'id' | 'created_at'>): Campaign {
    const id = uuidv4();
    const newCamp: Campaign = {
      id,
      ...campaign,
      created_at: new Date().toISOString(),
    };
    this.campaigns.set(id, newCamp);
    return newCamp;
  }

  public updateCampaign(id: string, updates: Partial<Campaign>): Campaign | undefined {
    const camp = this.campaigns.get(id);
    if (!camp) return undefined;
    const updated = { ...camp, ...updates };
    this.campaigns.set(id, updated);
    return updated;
  }

  // Contacts
  public createCampaignContact(contact: Omit<CampaignContact, 'id' | 'created_at'>): CampaignContact {
    const id = uuidv4();
    const newContact: CampaignContact = {
      id,
      ...contact,
      created_at: new Date().toISOString(),
    };
    this.campaignContacts.set(id, newContact);
    return newContact;
  }

  public getCampaignContact(id: string, orgId?: string): CampaignContact | undefined {
    const c = this.campaignContacts.get(id);
    if (!c) return undefined;
    if (orgId && c.organization_id !== orgId) return undefined;
    return c;
  }

  public getPendingContacts(campaignId: string, orgId: string, limit = 10): CampaignContact[] {
    return Array.from(this.campaignContacts.values())
      .filter((c) => c.campaign_id === campaignId && c.organization_id === orgId && (c.status === 'pending' || c.status === 'retry'))
      .sort((a, b) => a.attempts - b.attempts)
      .slice(0, limit);
  }

  public claimNextContactsAtomic(campaignId: string, orgId: string, limit = 10): CampaignContact[] {
    const contacts = Array.from(this.campaignContacts.values())
      .filter((c) => c.campaign_id === campaignId && c.organization_id === orgId && (c.status === 'pending' || c.status === 'retry'))
      .sort((a, b) => a.attempts - b.attempts)
      .slice(0, limit);

    for (const c of contacts) {
      c.status = 'dialing';
      c.attempts += 1;
      c.last_dialed_at = new Date().toISOString();
      this.campaignContacts.set(c.id, c);
    }
    return contacts;
  }

  public updateContactStatus(
    id: string,
    status: CampaignContact['status'],
    incrementAttempts = false
  ): CampaignContact | undefined {
    const contact = this.campaignContacts.get(id);
    if (!contact) return undefined;
    contact.status = status;
    if (incrementAttempts) {
      contact.attempts += 1;
      contact.last_dialed_at = new Date().toISOString();
    }
    this.campaignContacts.set(id, contact);
    return contact;
  }

  public getCampaignContactsCount(campaignId: string, orgId: string) {
    const contacts = Array.from(this.campaignContacts.values()).filter(
      (c) => c.campaign_id === campaignId && c.organization_id === orgId
    );
    const total = contacts.length;
    const pending = contacts.filter((c) => c.status === 'pending' || c.status === 'retry').length;
    const completed = contacts.filter((c) => c.status === 'completed').length;
    const dialing = contacts.filter((c) => c.status === 'dialing').length;
    const dnc = contacts.filter((c) => c.status === 'dnc' || c.status === 'skipped').length;
    return { total, pending, completed, dialing, dnc };
  }

  // Dialing Sessions
  public createSession(session: Omit<DialingSession, 'id' | 'started_at'>): DialingSession {
    const id = uuidv4();
    const newSession: DialingSession = {
      id,
      ...session,
      started_at: new Date().toISOString(),
    };
    this.dialingSessions.set(id, newSession);
    return newSession;
  }

  public getSession(id: string, orgId?: string): DialingSession | undefined {
    const s = this.dialingSessions.get(id);
    if (!s) return undefined;
    if (orgId && s.organization_id !== orgId) return undefined;
    return s;
  }

  public updateSession(id: string, updates: Partial<DialingSession>): DialingSession | undefined {
    const s = this.dialingSessions.get(id);
    if (!s) return undefined;
    const updated = { ...s, ...updates };
    this.dialingSessions.set(id, updated);
    return updated;
  }

  // Calls
  public createCall(call: Omit<Call, 'id' | 'started_at'>): Call {
    const id = call.provider_call_id || uuidv4();
    const newCall: Call = {
      id,
      ...call,
      started_at: new Date().toISOString(),
    };
    this.calls.set(id, newCall);

    // Dual Persistence: Route to PostgreSQL if connected
    if (this.isPostgresConnected && this.pool) {
      this.pool
        .query(
          `INSERT INTO calls (
            id, organization_id, session_id, campaign_contact_id, provider_name,
            provider_call_id, line_number, phone_dialed, state, duration_seconds,
            disposition_code, agent_notes, started_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (id) DO UPDATE SET
            state = EXCLUDED.state,
            duration_seconds = EXCLUDED.duration_seconds`,
          [
            newCall.id,
            newCall.organization_id,
            newCall.session_id,
            newCall.campaign_contact_id,
            newCall.provider_name,
            newCall.provider_call_id || null,
            newCall.line_number,
            newCall.phone_dialed,
            newCall.state,
            newCall.duration_seconds || 0,
            newCall.disposition_code || null,
            newCall.agent_notes || null,
            newCall.started_at,
          ]
        )
        .catch((err) => {
          console.error('[DB Postgres Error] createCall query failed:', err.message);
        });
    }

    return newCall;
  }

  public getCall(id: string, orgId?: string): Call | undefined {
    const c = this.calls.get(id);
    if (!c) return undefined;
    if (orgId && c.organization_id !== orgId) return undefined;
    return c;
  }

  public getCallByProviderCallId(providerCallId: string): Call | undefined {
    return Array.from(this.calls.values()).find((c) => c.provider_call_id === providerCallId);
  }

  public getActiveCallsForSession(sessionId: string): Call[] {
    return Array.from(this.calls.values()).filter(
      (c) =>
        c.session_id === sessionId &&
        c.state !== 'TERMINATED' &&
        c.state !== 'BUSY' &&
        c.state !== 'FAILED' &&
        c.state !== 'NO_ANSWER'
    );
  }

  public getCallsForSession(sessionId: string): Call[] {
    return Array.from(this.calls.values()).filter((c) => c.session_id === sessionId);
  }

  public getSessionDispositionStats(sessionId: string) {
    const calls = this.getCallsForSession(sessionId);
    const dispoCounts: Record<string, number> = {
      INTERESTED: 0,
      CALLBACK: 0,
      NO_ANSWER: 0,
      BUSY: 0,
      NOT_INTERESTED: 0,
      LEFT_VM: 0,
      DNC: 0,
      FAILED: 0,
      OTHER: 0,
    };

    let connectedCount = 0;
    let totalDuration = 0;

    for (const c of calls) {
      if (c.duration_seconds) totalDuration += c.duration_seconds;
      if (c.connected_at || c.state === 'CONNECTED' || c.duration_seconds > 0) {
        connectedCount++;
      }

      if (c.disposition_code) {
        const code = c.disposition_code.toUpperCase();
        if (dispoCounts[code] !== undefined) {
          dispoCounts[code]++;
        } else if (code.includes('INTEREST') && !code.includes('NOT')) {
          dispoCounts.INTERESTED++;
        } else if (code.includes('CALL') || code.includes('BACK')) {
          dispoCounts.CALLBACK++;
        } else if (code.includes('VM') || code.includes('VOICE')) {
          dispoCounts.LEFT_VM++;
        } else if (code.includes('DNC') || code.includes('DO_NOT')) {
          dispoCounts.DNC++;
        } else if (code.includes('NOT')) {
          dispoCounts.NOT_INTERESTED++;
        } else {
          dispoCounts.OTHER = (dispoCounts.OTHER || 0) + 1;
        }
      } else if (c.state === 'NO_ANSWER') {
        dispoCounts.NO_ANSWER++;
      } else if (c.state === 'BUSY') {
        dispoCounts.BUSY++;
      } else if (c.state === 'FAILED') {
        dispoCounts.FAILED++;
      }
    }

    const totalCalls = calls.length;
    const totalDispositioned = Object.values(dispoCounts).reduce((a, b) => a + b, 0);

    // Group calls by hour
    const hourlyMap = new Map<number, {
      hourLabel: string;
      hourKey: string;
      hourNumber: number;
      totalCalls: number;
      connectedCount: number;
      positiveLeads: number;
      totalDurationSeconds: number;
      dispositionCounts: Record<string, number>;
    }>();

    const session = this.getSession(sessionId);
    const sessionStartTime = session?.started_at ? new Date(session.started_at) : new Date();
    const currentHour = new Date().getHours();
    const startHour = Math.max(0, Math.min(sessionStartTime.getHours(), 9));

    // Initialize consecutive hourly slots
    for (let h = startHour; h <= Math.max(currentHour, 16); h++) {
      const displayHour = h % 12 === 0 ? 12 : h % 12;
      const ampm = h < 12 ? 'AM' : 'PM';
      const hourLabel = `${displayHour}:00 ${ampm}`;
      const hourKey = `hour_${h.toString().padStart(2, '0')}`;
      hourlyMap.set(h, {
        hourLabel,
        hourKey,
        hourNumber: h,
        totalCalls: 0,
        connectedCount: 0,
        positiveLeads: 0,
        totalDurationSeconds: 0,
        dispositionCounts: {
          INTERESTED: 0,
          CALLBACK: 0,
          NO_ANSWER: 0,
          BUSY: 0,
          NOT_INTERESTED: 0,
          LEFT_VM: 0,
          DNC: 0,
          FAILED: 0,
          OTHER: 0,
        },
      });
    }

    for (const c of calls) {
      const callDate = c.started_at ? new Date(c.started_at) : new Date();
      const callHour = isNaN(callDate.getTime()) ? currentHour : callDate.getHours();
      
      let hourBucket = hourlyMap.get(callHour);
      if (!hourBucket) {
        const displayHour = callHour % 12 === 0 ? 12 : callHour % 12;
        const ampm = callHour < 12 ? 'AM' : 'PM';
        hourBucket = {
          hourLabel: `${displayHour}:00 ${ampm}`,
          hourKey: `hour_${callHour.toString().padStart(2, '0')}`,
          hourNumber: callHour,
          totalCalls: 0,
          connectedCount: 0,
          positiveLeads: 0,
          totalDurationSeconds: 0,
          dispositionCounts: {
            INTERESTED: 0,
            CALLBACK: 0,
            NO_ANSWER: 0,
            BUSY: 0,
            NOT_INTERESTED: 0,
            LEFT_VM: 0,
            DNC: 0,
            FAILED: 0,
            OTHER: 0,
          },
        };
        hourlyMap.set(callHour, hourBucket);
      }

      hourBucket.totalCalls++;
      if (c.duration_seconds) hourBucket.totalDurationSeconds += c.duration_seconds;
      if (c.connected_at || c.state === 'CONNECTED' || (c.duration_seconds && c.duration_seconds > 0)) {
        hourBucket.connectedCount++;
      }

      const code = (c.disposition_code || '').toUpperCase();
      if (code.includes('INTEREST') && !code.includes('NOT')) {
        hourBucket.dispositionCounts.INTERESTED++;
        hourBucket.positiveLeads++;
      } else if (code.includes('CALL') || code.includes('BACK')) {
        hourBucket.dispositionCounts.CALLBACK++;
        hourBucket.positiveLeads++;
      } else if (code.includes('VM') || code.includes('VOICE')) {
        hourBucket.dispositionCounts.LEFT_VM++;
      } else if (code.includes('DNC') || code.includes('DO_NOT')) {
        hourBucket.dispositionCounts.DNC++;
      } else if (code.includes('NOT')) {
        hourBucket.dispositionCounts.NOT_INTERESTED++;
      } else if (c.state === 'NO_ANSWER') {
        hourBucket.dispositionCounts.NO_ANSWER++;
      } else if (c.state === 'BUSY') {
        hourBucket.dispositionCounts.BUSY++;
      } else if (c.state === 'FAILED') {
        hourBucket.dispositionCounts.FAILED++;
      } else {
        hourBucket.dispositionCounts.OTHER = (hourBucket.dispositionCounts.OTHER || 0) + 1;
      }
    }

    const hourlyTimeSeries = Array.from(hourlyMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, bucket]) => {
        const connectRate = bucket.totalCalls > 0 ? Math.round((bucket.connectedCount / bucket.totalCalls) * 100) : 0;
        const positiveRate = bucket.totalCalls > 0 ? Math.round((bucket.positiveLeads / bucket.totalCalls) * 100) : 0;
        const avgDurationSeconds = bucket.connectedCount > 0 ? Math.round(bucket.totalDurationSeconds / bucket.connectedCount) : 0;
        return {
          ...bucket,
          connectRate,
          positiveRate,
          avgDurationSeconds,
          chartData: [
            { name: 'Interested', key: 'INTERESTED', count: bucket.dispositionCounts.INTERESTED, color: '#10b981', category: 'positive' as const },
            { name: 'Callback', key: 'CALLBACK', count: bucket.dispositionCounts.CALLBACK, color: '#f59e0b', category: 'followup' as const },
            { name: 'Left VM', key: 'LEFT_VM', count: bucket.dispositionCounts.LEFT_VM, color: '#8b5cf6', category: 'followup' as const },
            { name: 'No Answer', key: 'NO_ANSWER', count: bucket.dispositionCounts.NO_ANSWER, color: '#64748b', category: 'unreached' as const },
            { name: 'Busy', key: 'BUSY', count: bucket.dispositionCounts.BUSY, color: '#94a3b8', category: 'unreached' as const },
            { name: 'Not Interested', key: 'NOT_INTERESTED', count: bucket.dispositionCounts.NOT_INTERESTED, color: '#f43f5e', category: 'negative' as const },
            { name: 'DNC', key: 'DNC', count: bucket.dispositionCounts.DNC, color: '#e11d48', category: 'dnc' as const },
          ],
        };
      });

    return {
      sessionId,
      totalCalls,
      totalDispositioned,
      connectedCount,
      connectRate: totalCalls > 0 ? Math.round((connectedCount / totalCalls) * 100) : 0,
      positiveRate: totalCalls > 0 ? Math.round(((dispoCounts.INTERESTED + dispoCounts.CALLBACK) / totalCalls) * 100) : 0,
      avgDurationSeconds: connectedCount > 0 ? Math.round(totalDuration / connectedCount) : 0,
      dispositionCounts: dispoCounts,
      chartData: [
        { name: 'Interested', key: 'INTERESTED', count: dispoCounts.INTERESTED, color: '#10b981', category: 'positive' },
        { name: 'Callback', key: 'CALLBACK', count: dispoCounts.CALLBACK, color: '#f59e0b', category: 'followup' },
        { name: 'Left VM', key: 'LEFT_VM', count: dispoCounts.LEFT_VM, color: '#8b5cf6', category: 'followup' },
        { name: 'No Answer', key: 'NO_ANSWER', count: dispoCounts.NO_ANSWER, color: '#64748b', category: 'unreached' },
        { name: 'Busy', key: 'BUSY', count: dispoCounts.BUSY, color: '#94a3b8', category: 'unreached' },
        { name: 'Not Interested', key: 'NOT_INTERESTED', count: dispoCounts.NOT_INTERESTED, color: '#f43f5e', category: 'negative' },
        { name: 'DNC', key: 'DNC', count: dispoCounts.DNC, color: '#e11d48', category: 'dnc' },
      ],
      hourlyTimeSeries,
    };
  }

  public updateCall(id: string, updates: Partial<Call>): Call | undefined {
    const call = this.calls.get(id);
    if (!call) return undefined;
    const updated = { ...call, ...updates };
    this.calls.set(id, updated);

    // Dual Persistence: Route to PostgreSQL if connected
    if (this.isPostgresConnected && this.pool) {
      this.pool
        .query(
          `UPDATE calls SET
            state = COALESCE($1, state),
            duration_seconds = COALESCE($2, duration_seconds),
            disposition_code = COALESCE($3, disposition_code),
            agent_notes = COALESCE($4, agent_notes),
            connected_at = COALESCE($5, connected_at),
            ended_at = COALESCE($6, ended_at),
            provider_call_id = COALESCE($7, provider_call_id)
          WHERE id = $8`,
          [
            updates.state || null,
            updates.duration_seconds !== undefined ? updates.duration_seconds : null,
            updates.disposition_code || null,
            updates.agent_notes || null,
            updates.connected_at || null,
            updates.ended_at || null,
            updates.provider_call_id || null,
            id,
          ]
        )
        .catch((err) => {
          console.error('[DB Postgres Error] updateCall query failed:', err.message);
        });
    }

    return updated;
  }

  public transitionCallStateAtomic(
    callId: string,
    fromState: FsmCallState,
    toState: FsmCallState,
    event: FsmTriggerEvent,
    updates: Partial<Call>,
    payload: Record<string, any> = {}
  ): { success: boolean; call: Call; callEvent?: CallEvent; error?: string } {
    const call = this.calls.get(callId);
    if (!call) {
      return { success: false, call: null as any, error: `Call ${callId} not found` };
    }
    if (call.state !== fromState) {
      return { success: false, call, error: `Concurrency conflict: call state is ${call.state}, expected ${fromState}` };
    }

    const updatedCall: Call = {
      ...call,
      ...updates,
      state: toState,
    };
    this.calls.set(callId, updatedCall);

    const callEvent = this.logCallEvent(callId, fromState, toState, event, payload);

    if (this.isPostgresConnected && this.pool) {
      this.pool
        .query(
          `UPDATE calls SET
            state = $1,
            duration_seconds = COALESCE($2, duration_seconds),
            disposition_code = COALESCE($3, disposition_code),
            agent_notes = COALESCE($4, agent_notes),
            connected_at = COALESCE($5, connected_at),
            ended_at = COALESCE($6, ended_at),
            provider_call_id = COALESCE($7, provider_call_id)
          WHERE id = $8 AND state = $9`,
          [
            toState,
            updates.duration_seconds !== undefined ? updates.duration_seconds : null,
            updates.disposition_code || null,
            updates.agent_notes || null,
            updates.connected_at || null,
            updates.ended_at || null,
            updates.provider_call_id || null,
            callId,
            fromState,
          ]
        )
        .catch((err) => {
          console.error('[DB Postgres Error] transitionCallStateAtomic query failed:', err.message);
        });
    }

    return { success: true, call: updatedCall, callEvent };
  }

  // Call Events (FSM Audit Log)
  public logCallEvent(
    callId: string,
    fromState: FsmCallState | 'NONE',
    toState: FsmCallState,
    event: FsmTriggerEvent,
    payload: Record<string, any> = {}
  ): CallEvent {
    const callEvent: CallEvent = {
      id: this.eventIdSeq++,
      call_id: callId,
      from_state: fromState,
      to_state: toState,
      event,
      payload,
      created_at: new Date().toISOString(),
    };
    this.callEvents.push(callEvent);

    // Dual Persistence: Route to PostgreSQL if connected
    if (this.isPostgresConnected && this.pool) {
      this.pool
        .query(
          `INSERT INTO call_events (call_id, from_state, to_state, event, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            callEvent.call_id,
            callEvent.from_state,
            callEvent.to_state,
            callEvent.event,
            JSON.stringify(callEvent.payload || {}),
            callEvent.created_at,
          ]
        )
        .catch((err) => {
          console.error('[DB Postgres Error] logCallEvent query failed:', err.message);
        });
    }

    return callEvent;
  }

  public getCallEvents(callId: string): CallEvent[] {
    return this.callEvents.filter((e) => e.call_id === callId).sort((a, b) => Number(a.id) - Number(b.id));
  }

  public getAllCallEvents(limit = 100): CallEvent[] {
    return this.callEvents.slice(-limit).reverse();
  }

  // Call Notes
  public addCallNote(callId: string, text: string, author = 'Agent'): CallNote {
    const note: CallNote = {
      id: uuidv4(),
      call_id: callId,
      author,
      text,
      created_at: new Date().toISOString(),
    };
    const existing = this.callNotes.get(callId) || [];
    existing.push(note);
    this.callNotes.set(callId, existing);

    // Also update call agent_notes if call exists
    const call = this.calls.get(callId);
    if (call) {
      call.agent_notes = call.agent_notes ? `${call.agent_notes}\n${text}` : text;
    }

    // Dual Persistence: Route to PostgreSQL if connected
    if (this.isPostgresConnected && this.pool) {
      this.pool
        .query(
          `INSERT INTO call_notes (id, call_id, author, text, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [note.id, note.call_id, note.author, note.text, note.created_at]
        )
        .catch((err) => {
          console.error('[DB Postgres Error] addCallNote query failed:', err.message);
        });

      if (call) {
        this.pool
          .query(`UPDATE calls SET agent_notes = $1 WHERE id = $2`, [call.agent_notes, callId])
          .catch(() => {});
      }
    }

    return note;
  }

  public getCallNotes(callId: string): CallNote[] {
    return this.callNotes.get(callId) || [];
  }

  // Suppression / DNC Checks
  public isNumberSuppressed(orgId: string, phone: string): boolean {
    const normalized = this.normalizePhone(phone);
    return this.suppressionList.has(`${orgId}:${normalized}`) || this.suppressionList.has(`${orgId}:${phone}`);
  }

  public addSuppression(orgId: string, phone: string, reason = 'DNC'): SuppressionRecord {
    const normalized = this.normalizePhone(phone);
    const rec: SuppressionRecord = {
      id: uuidv4(),
      organization_id: orgId,
      phone: normalized,
      reason,
      created_at: new Date().toISOString(),
    };
    this.suppressionList.set(`${orgId}:${normalized}`, rec);
    return rec;
  }

  public listSuppression(orgId: string): SuppressionRecord[] {
    return Array.from(this.suppressionList.values()).filter((s) => s.organization_id === orgId);
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return phone.trim();
  }
}

export const db = new DatabaseStore();

export async function transitionCallStateAtomic(
  pool: pg.Pool,
  params: {
    callId: string;
    expectedCurrentState: FsmCallState;
    targetState: FsmCallState;
    triggerEvent: FsmTriggerEvent;
    payload?: Record<string, any>;
    updates?: Partial<Call>;
  }
): Promise<{ success: boolean; call?: Call; callEvent?: CallEvent; error?: string }> {
  try {
    const { callId, expectedCurrentState, targetState, triggerEvent, payload = {}, updates = {} } = params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT * FROM calls WHERE id = $1 FOR UPDATE', [callId]);
      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return db.transitionCallStateAtomic(callId, expectedCurrentState, targetState, triggerEvent, updates, payload);
      }

      const row = res.rows[0];
      if (row.state !== expectedCurrentState) {
        await client.query('ROLLBACK');
        return { success: false, call: row as Call, error: `State mismatch: expected ${expectedCurrentState}, got ${row.state}` };
      }

      const updatedCall: Call = {
        ...row,
        ...updates,
        state: targetState,
      };

      await client.query(
        `UPDATE calls SET
          state = $1,
          duration_seconds = COALESCE($2, duration_seconds),
          disposition_code = COALESCE($3, disposition_code),
          agent_notes = COALESCE($4, agent_notes),
          connected_at = COALESCE($5, connected_at),
          ended_at = COALESCE($6, ended_at),
          provider_call_id = COALESCE($7, provider_call_id)
        WHERE id = $8`,
        [
          targetState,
          updates.duration_seconds !== undefined ? updates.duration_seconds : null,
          updates.disposition_code || null,
          updates.agent_notes || null,
          updates.connected_at || null,
          updates.ended_at || null,
          updates.provider_call_id || null,
          callId,
        ]
      );

      await client.query(
        `INSERT INTO call_events (call_id, from_state, to_state, event, payload) VALUES ($1, $2, $3, $4, $5)`,
        [callId, expectedCurrentState, targetState, triggerEvent, JSON.stringify(payload)]
      );

      await client.query('COMMIT');
      return { success: true, call: updatedCall };
    } catch (err: any) {
      await client.query('ROLLBACK');
      return db.transitionCallStateAtomic(callId, expectedCurrentState, targetState, triggerEvent, updates, payload);
    } finally {
      client.release();
    }
  } catch (err: any) {
    return db.transitionCallStateAtomic(params.callId, params.expectedCurrentState, params.targetState, params.triggerEvent, params.updates || {}, params.payload || {});
  }
}

export async function claimNextContactsAtomic(
  pool: pg.Pool,
  campaignId: string,
  orgId: string,
  limit = 10
): Promise<CampaignContact[]> {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `SELECT * FROM campaign_contacts 
         WHERE campaign_id = $1 AND organization_id = $2 AND status IN ('pending', 'retry')
         ORDER BY attempts ASC, created_at ASC
         LIMIT $3 FOR UPDATE SKIP LOCKED`,
        [campaignId, orgId, limit]
      );

      if (res.rows.length === 0) {
        await client.query('COMMIT');
        return db.getPendingContacts(campaignId, orgId, limit);
      }

      const ids = res.rows.map((r: any) => r.id);
      await client.query(
        `UPDATE campaign_contacts 
         SET status = 'dialing', attempts = attempts + 1, last_dialed_at = NOW()
         WHERE id = ANY($1::varchar[])`,
        [ids]
      );

      await client.query('COMMIT');
      
      for (const row of res.rows) {
        const contact = db.getCampaignContact(row.id);
        if (contact) {
          contact.status = 'dialing';
          contact.attempts += 1;
          contact.last_dialed_at = new Date().toISOString();
        }
      }

      return res.rows.map((r: any) => ({
        ...r,
        attempts: r.attempts + 1,
        status: 'dialing',
      })) as CampaignContact[];
    } catch (err) {
      await client.query('ROLLBACK');
      return db.getPendingContacts(campaignId, orgId, limit);
    } finally {
      client.release();
    }
  } catch (err) {
    return db.getPendingContacts(campaignId, orgId, limit);
  }
}

export async function recordWebhookEventIdempotent(
  pool: pg.Pool,
  providerName: string,
  providerEventId: string,
  callId?: string,
  eventType?: string
): Promise<boolean> {
  try {
    const res = await pool.query(
      `INSERT INTO processed_events (provider_name, provider_event_id, call_id, event_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider_name, provider_event_id) DO NOTHING
       RETURNING id`,
      [providerName, providerEventId || 'unknown', callId || null, eventType || 'unknown']
    );
    return res.rowCount !== null && res.rowCount > 0;
  } catch (err) {
    return true;
  }
}
