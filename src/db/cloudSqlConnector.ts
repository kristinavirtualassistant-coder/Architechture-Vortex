/**
 * Google Cloud SQL Node.js Connector - IAM-Based Authentication Module
 * 
 * Provides secure, passwordless connectivity to Google Cloud SQL PostgreSQL instances
 * using the official '@google-cloud/cloud-sql-connector' package with IAM database authentication.
 * 
 * Features:
 * - Automatic ephemeral SSL certificate generation & rotation
 * - Native IAM token-based authentication (no database passwords in code or environment)
 * - Integration with Node-postgres (pg.Pool) with connection pooling and error suppression
 * - Configurable IP types (PUBLIC, PRIVATE, PSC) and fallback handling
 * - Comprehensive diagnostic connectivity probing and health checks
 */

import { Connector, AuthTypes, IpAddressTypes, ConnectorOptions } from '@google-cloud/cloud-sql-connector';
import pg from 'pg';

const { Pool } = pg;

export interface CloudSqlConnectorConfig {
  /**
   * Cloud SQL instance connection name in format 'project-id:region:instance-name'
   * e.g., 'vortex-one:us-central1:vortex-one-pg'
   */
  instanceConnectionName: string;

  /**
   * PostgreSQL database name (defaults to 'vortex_dialer' or process.env.SQL_DB_NAME / DB_NAME)
   */
  database: string;

  /**
   * IAM database user (service account email or IAM user email/name)
   * e.g., 'vortex-dialer-sa@project-id.iam.gserviceaccount.com' or 'vortex-dialer-sa'
   */
  iamUser: string;

  /**
   * IP address type to connect with (PUBLIC, PRIVATE, PSC)
   */
  ipType?: 'PUBLIC' | 'PRIVATE' | 'PSC';

  /**
   * Authentication type (IAM or PASSWORD) - defaults to IAM
   */
  authType?: 'IAM' | 'PASSWORD';

  /**
   * Maximum connections in the pool
   */
  maxConnections?: number;

  /**
   * Idle connection timeout in milliseconds
   */
  idleTimeoutMillis?: number;

  /**
   * Connection acquisition timeout in milliseconds
   */
  connectionTimeoutMillis?: number;
}

export interface DatabaseConnectivityReport {
  success: boolean;
  driver: 'cloud-sql-iam-connector' | 'standard-pg' | 'in-memory-fallback';
  instanceConnectionName?: string;
  database?: string;
  iamUser?: string;
  authType?: string;
  ipType?: string;
  latencyMs?: number;
  serverVersion?: string;
  currentTime?: string;
  activePoolClients?: number;
  idlePoolClients?: number;
  totalPoolClients?: number;
  error?: string;
}

// Global cached singletons to persist across reloads
let globalConnector: Connector | null = null;
let globalPool: pg.Pool | null = null;
let activeConfig: CloudSqlConnectorConfig | null = null;

/**
 * Validates whether an instance connection name adheres to Google Cloud SQL requirements:
 * Format: "PROJECT:REGION:INSTANCE" (three non-empty colon-delimited components)
 * or a fully qualified domain name (for Private Service Connect / custom DNS).
 */
export function isValidInstanceConnectionName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed.includes('placeholder') ||
    trimmed.includes('MY_APP_URL') ||
    trimmed.includes('localhost') ||
    trimmed.includes('127.0.0.1')
  ) {
    return false;
  }

  // Cloud SQL standard format: PROJECT:REGION:INSTANCE
  const parts = trimmed.split(':');
  if (parts.length === 3 && parts.every((p) => p.trim().length > 0)) {
    return true;
  }

  // Valid domain name format (e.g. custom PSC endpoint domain)
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (domainRegex.test(trimmed) && !trimmed.includes(':')) {
    return true;
  }

  return false;
}

/**
 * Resolves Cloud SQL configuration from environment variables or custom overrides.
 */
export function resolveCloudSqlConfig(override?: Partial<CloudSqlConnectorConfig>): CloudSqlConnectorConfig | null {
  const instanceConnectionName =
    (
      override?.instanceConnectionName ||
      process.env.INSTANCE_CONNECTION_NAME ||
      process.env.CLOUDSQL_INSTANCE_CONNECTION_NAME ||
      process.env.SQL_INSTANCE_CONNECTION_NAME ||
      process.env.CLOUD_SQL_CONNECTION_NAME ||
      ''
    ).trim();

  if (!isValidInstanceConnectionName(instanceConnectionName)) {
    return null;
  }

  const database =
    override?.database ||
    process.env.DB_NAME ||
    process.env.SQL_DB_NAME ||
    process.env.POSTGRES_DB ||
    'vortex_dialer';

  const iamUser =
    override?.iamUser ||
    process.env.DB_IAM_USER ||
    process.env.SQL_IAM_USER ||
    process.env.SQL_USER ||
    process.env.DB_USER ||
    'postgres';

  const rawIpType = (override?.ipType || process.env.DB_IP_TYPE || 'PUBLIC').toUpperCase();
  const ipType: 'PUBLIC' | 'PRIVATE' | 'PSC' =
    rawIpType === 'PRIVATE' ? 'PRIVATE' : rawIpType === 'PSC' ? 'PSC' : 'PUBLIC';

  const rawAuthType = (override?.authType || process.env.DB_AUTH_TYPE || 'IAM').toUpperCase();
  const authType: 'IAM' | 'PASSWORD' = rawAuthType === 'PASSWORD' ? 'PASSWORD' : 'IAM';

  return {
    instanceConnectionName,
    database,
    iamUser,
    ipType,
    authType,
    maxConnections: override?.maxConnections || Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: override?.idleTimeoutMillis || 30000,
    connectionTimeoutMillis: override?.connectionTimeoutMillis || 10000,
  };
}

/**
 * Checks whether Cloud SQL Connector is configured in the environment.
 */
export function isCloudSqlConfigured(override?: Partial<CloudSqlConnectorConfig>): boolean {
  return resolveCloudSqlConfig(override) !== null;
}

/**
 * Obtains or creates the singleton Connector instance from '@google-cloud/cloud-sql-connector'.
 */
export function getCloudSqlConnectorInstance(opts?: ConnectorOptions): Connector {
  if (!globalConnector) {
    globalConnector = new Connector(opts);
  }
  return globalConnector;
}

/**
 * Creates and initializes a new pg.Pool using the Cloud SQL Node.js Connector with IAM Authentication.
 */
export async function createCloudSqlPool(configOverride?: Partial<CloudSqlConnectorConfig>): Promise<pg.Pool> {
  const config = resolveCloudSqlConfig(configOverride);
  if (!config) {
    throw new Error(
      'Cloud SQL configuration missing. Please provide INSTANCE_CONNECTION_NAME (e.g., "project:region:instance").'
    );
  }

  activeConfig = config;
  const connector = getCloudSqlConnectorInstance();

  const ipTypeEnum =
    config.ipType === 'PRIVATE'
      ? IpAddressTypes.PRIVATE
      : config.ipType === 'PSC'
      ? IpAddressTypes.PSC
      : IpAddressTypes.PUBLIC;

  const authTypeEnum = config.authType === 'PASSWORD' ? AuthTypes.PASSWORD : AuthTypes.IAM;

  console.log(
    `🔐 Initializing Cloud SQL Connector (Instance: ${config.instanceConnectionName}, Auth: ${config.authType}, User: ${config.iamUser}, DB: ${config.database})`
  );

  // Retrieve dynamic TLS stream options from connector
  const clientOpts = await connector.getOptions({
    instanceConnectionName: config.instanceConnectionName,
    authType: authTypeEnum,
    ipType: ipTypeEnum,
  });

  // Create node-postgres Pool wrapping the Connector's custom secure stream
  const pool = new Pool({
    ...clientOpts,
    user: config.iamUser,
    database: config.database,
    max: config.maxConnections || 10,
    idleTimeoutMillis: config.idleTimeoutMillis || 30000,
    connectionTimeoutMillis: config.connectionTimeoutMillis || 10000,
  });

  // Suppress unhandled idle client errors to prevent process crashes
  pool.on('error', (err) => {
    console.error('⚠️ [Cloud SQL Pool] Idle client error:', err.message);
  });

  globalPool = pool;
  return pool;
}

/**
 * Returns the cached Cloud SQL pg.Pool instance, or creates one if configured.
 */
export async function getCloudSqlPool(configOverride?: Partial<CloudSqlConnectorConfig>): Promise<pg.Pool | null> {
  if (globalPool) {
    return globalPool;
  }
  if (isCloudSqlConfigured(configOverride)) {
    try {
      return await createCloudSqlPool(configOverride);
    } catch (err: any) {
      console.warn('⚠️ Cloud SQL Pool initialization failed:', err.message);
      return null;
    }
  }
  return null;
}

/**
 * Probes the Cloud SQL database and returns a diagnostic connectivity report.
 */
export async function testCloudSqlConnection(poolInstance?: pg.Pool): Promise<DatabaseConnectivityReport> {
  const pool = poolInstance || globalPool;
  const config = activeConfig || resolveCloudSqlConfig();

  if (!pool || !config) {
    return {
      success: false,
      driver: 'in-memory-fallback',
      error: 'Cloud SQL Connector is not initialized or configured.',
    };
  }

  const startTime = Date.now();
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT NOW() as current_time, version() as server_version;');
      const latencyMs = Date.now() - startTime;
      const row = result.rows[0];

      return {
        success: true,
        driver: 'cloud-sql-iam-connector',
        instanceConnectionName: config.instanceConnectionName,
        database: config.database,
        iamUser: config.iamUser,
        authType: config.authType,
        ipType: config.ipType,
        latencyMs,
        serverVersion: row?.server_version?.split(' ')[0] + ' ' + (row?.server_version?.split(' ')[1] || ''),
        currentTime: row?.current_time?.toISOString ? row.current_time.toISOString() : String(row?.current_time),
        activePoolClients: pool.totalCount - pool.idleCount,
        idlePoolClients: pool.idleCount,
        totalPoolClients: pool.totalCount,
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return {
      success: false,
      driver: 'cloud-sql-iam-connector',
      instanceConnectionName: config.instanceConnectionName,
      database: config.database,
      iamUser: config.iamUser,
      authType: config.authType,
      ipType: config.ipType,
      latencyMs: Date.now() - startTime,
      error: err.message || String(err),
    };
  }
}

/**
 * Gracefully drains the connection pool and closes the Cloud SQL Connector.
 */
export async function closeCloudSqlConnector(): Promise<void> {
  if (globalPool) {
    try {
      await globalPool.end();
      console.log('✅ Cloud SQL connection pool drained.');
    } catch (err: any) {
      console.warn('⚠️ Error draining Cloud SQL connection pool:', err.message);
    }
    globalPool = null;
  }
  if (globalConnector) {
    try {
      globalConnector.close();
      console.log('✅ Cloud SQL Connector closed.');
    } catch (err: any) {
      console.warn('⚠️ Error closing Cloud SQL Connector:', err.message);
    }
    globalConnector = null;
  }
}
