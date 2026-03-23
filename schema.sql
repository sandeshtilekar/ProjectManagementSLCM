-- ============================================================
--  GridBase  —  Production MySQL Schema
--  Engine: InnoDB  |  Charset: utf8mb4  |  MySQL 5.7+
-- ============================================================

CREATE DATABASE IF NOT EXISTS gridbase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gridbase;

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE users (
  id            CHAR(12)      NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  full_name     VARCHAR(120)  NOT NULL,
  avatar_url    VARCHAR(500)  DEFAULT NULL,
  is_verified     TINYINT(1)    NOT NULL DEFAULT 0,
  failed_attempts SMALLINT      NOT NULL DEFAULT 0,
  locked_until    DATETIME      DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- ── REFRESH TOKENS ──────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id         CHAR(36)     NOT NULL,
  user_id    CHAR(12)     NOT NULL,
  token_hash CHAR(64)     NOT NULL,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rt_user (user_id),
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── WORKSPACES ───────────────────────────────────────────────
CREATE TABLE workspaces (
  id         CHAR(12)     NOT NULL,
  name       VARCHAR(120) NOT NULL,
  slug       VARCHAR(80)  NOT NULL,
  owner_id   CHAR(12)     NOT NULL,
  plan       ENUM('free','pro','team','enterprise') NOT NULL DEFAULT 'free',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ws_slug (slug),
  KEY idx_ws_owner (owner_id),
  CONSTRAINT fk_ws_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── WORKSPACE MEMBERS ────────────────────────────────────────
CREATE TABLE workspace_members (
  workspace_id CHAR(12)    NOT NULL,
  user_id      CHAR(12)    NOT NULL,
  role         ENUM('owner','admin','editor','viewer') NOT NULL DEFAULT 'editor',
  invited_by   CHAR(12)    DEFAULT NULL,
  joined_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  KEY idx_wm_user (user_id),
  CONSTRAINT fk_wm_ws   FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_wm_user FOREIGN KEY (user_id)      REFERENCES users(id)      ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── BASES (Airtable "Base") ──────────────────────────────────
CREATE TABLE bases (
  id           CHAR(12)     NOT NULL,
  workspace_id CHAR(12)     NOT NULL,
  name         VARCHAR(120) NOT NULL,
  color        VARCHAR(20)  DEFAULT '#5b7ffc',
  icon         VARCHAR(10)  DEFAULT '⊞',
  created_by   CHAR(12)     NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bases_ws (workspace_id),
  CONSTRAINT fk_bases_ws   FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_bases_user FOREIGN KEY (created_by)   REFERENCES users(id)
) ENGINE=InnoDB;

-- ── TABLES ───────────────────────────────────────────────────
CREATE TABLE `tables` (
  id          CHAR(12)     NOT NULL,
  base_id     CHAR(12)     NOT NULL,
  name        VARCHAR(120) NOT NULL,
  order_index INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tables_base (base_id),
  CONSTRAINT fk_tables_base FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── FIELDS ───────────────────────────────────────────────────
CREATE TABLE fields (
  id          CHAR(12)     NOT NULL,
  table_id    CHAR(12)     NOT NULL,
  name        VARCHAR(120) NOT NULL,
  type        ENUM('text','number','singleSelect','multiSelect','date','checkbox',
                   'email','url','phone','rating','attachment','formula') NOT NULL DEFAULT 'text',
  options     JSON         DEFAULT NULL,   -- select options, formula expr, etc.
  width       SMALLINT     NOT NULL DEFAULT 150,
  order_index INT          NOT NULL DEFAULT 0,
  is_primary  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fields_table (table_id),
  CONSTRAINT fk_fields_table FOREIGN KEY (table_id) REFERENCES `tables`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── RECORDS ──────────────────────────────────────────────────
CREATE TABLE records (
  id         CHAR(12)  NOT NULL,
  table_id   CHAR(12)  NOT NULL,
  order_index INT      NOT NULL DEFAULT 0,
  created_by CHAR(12)  DEFAULT NULL,
  created_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_records_table (table_id),
  CONSTRAINT fk_records_table FOREIGN KEY (table_id) REFERENCES `tables`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── CELL VALUES ──────────────────────────────────────────────
-- Single table, typed columns.  Queries use only the relevant value column.
CREATE TABLE cell_values (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  record_id    CHAR(12)        NOT NULL,
  field_id     CHAR(12)        NOT NULL,
  value_text   TEXT            DEFAULT NULL,
  value_num    DOUBLE          DEFAULT NULL,
  value_bool   TINYINT(1)      DEFAULT NULL,
  value_json   JSON            DEFAULT NULL,   -- arrays, objects
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cell (record_id, field_id),
  KEY idx_cv_field (field_id),
  CONSTRAINT fk_cv_record FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE,
  CONSTRAINT fk_cv_field  FOREIGN KEY (field_id)  REFERENCES fields(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── ATTACHMENTS ──────────────────────────────────────────────
CREATE TABLE attachments (
  id            CHAR(12)     NOT NULL,
  record_id     CHAR(12)     NOT NULL,
  field_id      CHAR(12)     NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  url           VARCHAR(500) NOT NULL,
  uploaded_by   CHAR(12)     DEFAULT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_att_record (record_id),
  CONSTRAINT fk_att_record FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── VIEWS ────────────────────────────────────────────────────
CREATE TABLE views (
  id         CHAR(12)     NOT NULL,
  table_id   CHAR(12)     NOT NULL,
  name       VARCHAR(120) NOT NULL,
  type       ENUM('grid','kanban','gallery','calendar') NOT NULL DEFAULT 'grid',
  config     JSON         DEFAULT NULL,  -- sort, filter, hidden fields, group-by field
  created_by CHAR(12)     DEFAULT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_views_table (table_id),
  CONSTRAINT fk_views_table FOREIGN KEY (table_id) REFERENCES `tables`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── ACTIVITY LOG ─────────────────────────────────────────────
CREATE TABLE activity_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id CHAR(12)        NOT NULL,
  user_id      CHAR(12)        DEFAULT NULL,
  entity_type  ENUM('record','field','table','base','workspace') NOT NULL,
  entity_id    CHAR(12)        NOT NULL,
  action       ENUM('create','update','delete','upload') NOT NULL,
  diff         JSON            DEFAULT NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_al_ws   (workspace_id),
  KEY idx_al_user (user_id),
  KEY idx_al_time (created_at)
) ENGINE=InnoDB;

-- ── SEED: default views for new tables (created by trigger) ──
-- (Views are inserted server-side on table creation instead)

-- ============================================================
--  INTEGRATIONS — ServiceNow & Snowflake
--  Added in v1.1.0
-- ============================================================

-- ── INTEGRATION CONFIGS ──────────────────────────────────────
-- One row per integration instance (a workspace can have one SNOW
-- and one Snowflake integration, or multiple of the same type).
CREATE TABLE integrations (
  id              CHAR(12)      NOT NULL,
  workspace_id    CHAR(12)      NOT NULL,
  type            ENUM('servicenow','snowflake') NOT NULL,
  name            VARCHAR(120)  NOT NULL,
  -- Encrypted JSON config blob (AES-256-GCM, key from env)
  -- For ServiceNow: { instance, client_id, client_secret, oauth_token, token_expiry }
  -- For Snowflake:  { account, username, private_key_pem, warehouse, database, schema }
  config_encrypted TEXT         NOT NULL,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_by      CHAR(12)      DEFAULT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_int_ws (workspace_id),
  KEY idx_int_type (type),
  CONSTRAINT fk_int_ws FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── INTEGRATION FIELD MAPPINGS ───────────────────────────────
-- Maps a DataGrid field to a ServiceNow field or Snowflake column.
CREATE TABLE integration_field_maps (
  id               CHAR(12)     NOT NULL,
  integration_id   CHAR(12)     NOT NULL,
  table_id         CHAR(12)     NOT NULL,
  datagrid_field_id CHAR(12)    NOT NULL,
  external_field   VARCHAR(255) NOT NULL,   -- SNOW: field name e.g. 'short_description'
                                             -- Snowflake: column name e.g. 'STATUS'
  direction        ENUM('push','pull','both') NOT NULL DEFAULT 'both',
  transform        VARCHAR(500) DEFAULT NULL, -- optional JS expression as string
  PRIMARY KEY (id),
  KEY idx_ifm_int (integration_id),
  CONSTRAINT fk_ifm_int   FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ifm_table FOREIGN KEY (table_id)       REFERENCES `tables`(id)     ON DELETE CASCADE,
  CONSTRAINT fk_ifm_field FOREIGN KEY (datagrid_field_id) REFERENCES fields(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── RECORD INTEGRATION LINKS ─────────────────────────────────
-- Links a DataGrid record to its external counterpart.
CREATE TABLE record_integration_links (
  id               CHAR(12)     NOT NULL,
  record_id        CHAR(12)     NOT NULL,
  integration_id   CHAR(12)     NOT NULL,
  external_id      VARCHAR(255) NOT NULL,   -- SNOW sys_id or Snowflake row key
  external_type    VARCHAR(80)  DEFAULT NULL, -- 'incident','change_request','problem'
  external_url     VARCHAR(500) DEFAULT NULL,
  last_synced_at   DATETIME     DEFAULT NULL,
  sync_status      ENUM('ok','error','pending') NOT NULL DEFAULT 'pending',
  sync_error       TEXT         DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ril (record_id, integration_id),
  KEY idx_ril_ext (external_id, integration_id),
  CONSTRAINT fk_ril_record FOREIGN KEY (record_id)      REFERENCES records(id)      ON DELETE CASCADE,
  CONSTRAINT fk_ril_int    FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── SYNC JOBS ────────────────────────────────────────────────
CREATE TABLE sync_jobs (
  id               CHAR(12)      NOT NULL,
  integration_id   CHAR(12)      NOT NULL,
  table_id         CHAR(12)      DEFAULT NULL,
  direction        ENUM('push','pull') NOT NULL,
  status           ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  triggered_by     ENUM('manual','schedule','webhook','auto_status') NOT NULL DEFAULT 'manual',
  records_processed INT UNSIGNED  NOT NULL DEFAULT 0,
  records_failed    INT UNSIGNED  NOT NULL DEFAULT 0,
  watermark        DATETIME      DEFAULT NULL,   -- last updated_at processed (incremental sync)
  error_summary    TEXT          DEFAULT NULL,
  started_at       DATETIME      DEFAULT NULL,
  finished_at      DATETIME      DEFAULT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sj_int    (integration_id),
  KEY idx_sj_status (status),
  KEY idx_sj_time   (created_at),
  CONSTRAINT fk_sj_int   FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  CONSTRAINT fk_sj_table FOREIGN KEY (table_id)       REFERENCES `tables`(id)     ON DELETE SET NULL
) ENGINE=InnoDB;

-- ── WEBHOOK EVENTS LOG ───────────────────────────────────────
-- Stores raw inbound webhook payloads for replay / audit.
CREATE TABLE webhook_events (
  id               CHAR(12)      NOT NULL,
  integration_id   CHAR(12)      DEFAULT NULL,
  source           ENUM('servicenow','snowflake','unknown') NOT NULL DEFAULT 'unknown',
  event_type       VARCHAR(120)  DEFAULT NULL,   -- e.g. 'incident.updated'
  payload          MEDIUMTEXT    NOT NULL,
  hmac_valid       TINYINT(1)    DEFAULT NULL,   -- NULL = not checked, 1 = valid, 0 = invalid
  processed        TINYINT(1)    NOT NULL DEFAULT 0,
  process_error    TEXT          DEFAULT NULL,
  received_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at     DATETIME      DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_we_int  (integration_id),
  KEY idx_we_time (received_at),
  KEY idx_we_proc (processed)
) ENGINE=InnoDB;
