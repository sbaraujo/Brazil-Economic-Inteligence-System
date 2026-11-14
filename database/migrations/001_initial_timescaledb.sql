-- SYGMA BRAZIL ECONOMIC INTELLIGENCE AI
-- PostgreSQL 16 + TimescaleDB 2.x Normalized Institutional Schema
-- Manufacturer: SYGMA AIS

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS market_data;
CREATE SCHEMA IF NOT EXISTS macroeconomic;
CREATE SCHEMA IF NOT EXISTS commodities;
CREATE SCHEMA IF NOT EXISTS news;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS forecasts;
CREATE SCHEMA IF NOT EXISTS risk;
CREATE SCHEMA IF NOT EXISTS intelligence;
CREATE SCHEMA IF NOT EXISTS audit;

-- CORE ENTITIES
CREATE TABLE IF NOT EXISTS core.providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  protocol TEXT NOT NULL,
  auth_status TEXT NOT NULL,
  license_status TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  documentation_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.provider_credentials (
  provider_id TEXT PRIMARY KEY REFERENCES core.providers(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  key_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.instruments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_pt TEXT NOT NULL,
  name_en TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  exchange TEXT,
  provider_id TEXT REFERENCES core.providers(id),
  external_symbol TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS core.economic_indicators (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_pt TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  frequency TEXT NOT NULL,
  freshness_threshold_hours INTEGER NOT NULL,
  provider_id TEXT REFERENCES core.providers(id),
  external_series_id TEXT NOT NULL,
  methodology_note TEXT NOT NULL,
  is_official BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS core.user_settings (
  user_id TEXT PRIMARY KEY,
  language TEXT NOT NULL DEFAULT 'pt-BR',
  theme TEXT NOT NULL DEFAULT 'dark',
  watchlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MACROECONOMIC & TIME-SERIES OBSERVATIONS (HYPERTABLE)
CREATE TABLE IF NOT EXISTS macroeconomic.observations (
  indicator_id TEXT NOT NULL REFERENCES core.economic_indicators(id),
  observed_at TIMESTAMPTZ NOT NULL,
  reference_period TEXT NOT NULL,
  raw_value DOUBLE PRECISION NOT NULL,
  normalized_value DOUBLE PRECISION NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision_count INTEGER NOT NULL DEFAULT 0,
  data_status TEXT NOT NULL,
  source_id TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  PRIMARY KEY (indicator_id, observed_at, revision_count)
);
SELECT create_hypertable('macroeconomic.observations', 'observed_at', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS macroeconomic.data_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  previous_value DOUBLE PRECISION NOT NULL,
  new_value DOUBLE PRECISION NOT NULL,
  source_id TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MARKET DATA HYPERTABLES
CREATE TABLE IF NOT EXISTS market_data.historical_prices (
  instrument_id TEXT NOT NULL REFERENCES core.instruments(id),
  ts TIMESTAMPTZ NOT NULL,
  open_price DOUBLE PRECISION,
  high_price DOUBLE PRECISION,
  low_price DOUBLE PRECISION,
  close_price DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION,
  data_status TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (instrument_id, ts)
);
SELECT create_hypertable('market_data.historical_prices', 'ts', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS market_data.exchange_rates (
  pair TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  ptax_ask DOUBLE PRECISION NOT NULL,
  ptax_bid DOUBLE PRECISION,
  source_id TEXT NOT NULL,
  data_status TEXT NOT NULL,
  PRIMARY KEY (pair, ts)
);
SELECT create_hypertable('market_data.exchange_rates', 'ts', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS market_data.interest_rates (
  rate_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  value_pct DOUBLE PRECISION NOT NULL,
  basis TEXT NOT NULL DEFAULT '252',
  source_id TEXT NOT NULL,
  PRIMARY KEY (rate_id, ts)
);

CREATE TABLE IF NOT EXISTS market_data.market_indices (
  index_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (index_id, ts)
);

CREATE TABLE IF NOT EXISTS commodities.commodity_prices (
  commodity_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL,
  unit TEXT NOT NULL,
  benchmark TEXT NOT NULL,
  data_status TEXT NOT NULL,
  PRIMARY KEY (commodity_id, ts)
);

-- NEWS & ECONOMIC CALENDAR
CREATE TABLE IF NOT EXISTS news.news_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_id TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  original_url TEXT NOT NULL,
  topic TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  dedup_hash CHAR(64) NOT NULL UNIQUE,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS macroeconomic.economic_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_at TIMESTAMPTZ NOT NULL,
  country CHAR(3) NOT NULL,
  institution TEXT NOT NULL,
  indicator_name TEXT NOT NULL,
  previous_value DOUBLE PRECISION,
  consensus_value DOUBLE PRECISION,
  actual_value DOUBLE PRECISION,
  importance TEXT NOT NULL
);

-- ANALYTICS, FORECASTS, RISK & TECHNICAL FEEDBACK
CREATE TABLE IF NOT EXISTS analytics.data_quality_records (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  affected_source TEXT NOT NULL,
  affected_indicator TEXT NOT NULL,
  description TEXT NOT NULL,
  statistical_evidence JSONB,
  status TEXT NOT NULL DEFAULT 'OPEN',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forecasts.model_registry (
  model_id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  version TEXT NOT NULL,
  methodology TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forecasts.forecast_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id TEXT NOT NULL,
  model_id TEXT REFERENCES forecasts.model_registry(model_id),
  trained_at TIMESTAMPTZ NOT NULL,
  validation_metrics JSONB NOT NULL,
  horizon_payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS risk.risk_scenarios (
  code TEXT PRIMARY KEY,
  name_pt TEXT NOT NULL,
  shock_definition JSONB NOT NULL,
  is_hypothetical BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS risk.risk_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seed BIGINT NOT NULL,
  simulations INTEGER NOT NULL,
  var_95 DOUBLE PRECISION NOT NULL,
  es_95 DOUBLE PRECISION NOT NULL,
  stress_summary JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE
);

-- IMMUTABLE CRYPTOGRAPHIC AUDIT LOG
CREATE TABLE IF NOT EXISTS audit.audit_events (
  seq BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL,
  service TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  outcome TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash CHAR(64) NOT NULL,
  hash CHAR(64) NOT NULL
);
