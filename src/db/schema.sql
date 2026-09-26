-- Vortex One Dialer - Production PostgreSQL Database DDL
-- Multi-Tenant Schema with ACID guarantees, foreign keys, and indexes

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(organization_id);

-- 4. Campaign Contacts (Ingested from CRM)
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_queue ON campaign_contacts (campaign_id, status, attempts);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_org ON campaign_contacts (organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_phone ON campaign_contacts (phone);

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
    campaign_contact_id UUID NOT NULL REFERENCES campaign_contacts(id),
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

-- 7. Call Events (FSM Sequence Immutable Audit Log)
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

-- 8. Call Notes
CREATE TABLE IF NOT EXISTS call_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    author VARCHAR(255) NOT NULL DEFAULT 'Agent',
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_notes_call_id ON call_notes (call_id, created_at ASC);

-- 9. Suppression List (DNC Guard)
CREATE TABLE IF NOT EXISTS suppression_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone VARCHAR(50) NOT NULL,
    reason VARCHAR(100) DEFAULT 'DNC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_suppression_org_phone UNIQUE (organization_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_suppression_lookup ON suppression_list (organization_id, phone);
