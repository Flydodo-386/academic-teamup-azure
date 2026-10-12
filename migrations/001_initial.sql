CREATE TABLE users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  entra_object_id UUID NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  roles JSONB NOT NULL DEFAULT '[]',
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, entra_object_id)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE opportunities (
  id SERIAL PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('Grant', 'Paper')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]',
  seeking TEXT NOT NULL,
  deadline TEXT NOT NULL DEFAULT 'Open collaboration',
  stage TEXT NOT NULL DEFAULT 'New idea',
  visibility TEXT NOT NULL DEFAULT 'school' CHECK (visibility IN ('school', 'private')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX opportunities_owner_idx ON opportunities(owner_id);
CREATE INDEX opportunities_status_idx ON opportunities(status);

CREATE TABLE interests (
  id SERIAL PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, user_id)
);
CREATE INDEX interests_opportunity_idx ON interests(opportunity_id);

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  school TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  interests JSONB NOT NULL DEFAULT '[]',
  expertise JSONB NOT NULL DEFAULT '[]',
  collaboration_types JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE funding_opportunities (
  id SERIAL PRIMARY KEY,
  source_key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  date_added TEXT NOT NULL DEFAULT '',
  closing_date TEXT NOT NULL DEFAULT 'Check call',
  funder_url TEXT NOT NULL DEFAULT '',
  min_value TEXT NOT NULL DEFAULT '',
  max_value TEXT NOT NULL DEFAULT '',
  additional_info TEXT NOT NULL DEFAULT '',
  research_professional_url TEXT NOT NULL DEFAULT '',
  imported_by UUID NOT NULL REFERENCES users(id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX funding_closing_idx ON funding_opportunities(closing_date);

CREATE TABLE audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  record_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
