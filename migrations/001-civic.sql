-- CivicQuill application schema. Engine tables are referenced, never altered.
-- Account-scoped rows use dge.account_id; workspace rows use dge.tenant_id;
-- reviewer actions run only after a platform-administrator check and declare
-- dge.worker='civic-review'.
CREATE SCHEMA app_civic;
REVOKE ALL ON SCHEMA app_civic FROM PUBLIC;
GRANT USAGE ON SCHEMA app_civic TO dge_identity_runtime;

CREATE TABLE app_civic.official_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  level text NOT NULL CHECK (level IN ('federal','state','local')),
  role text NOT NULL CHECK (role IN ('elected-official','authorized-staff')),
  jurisdiction text NOT NULL CHECK (char_length(jurisdiction) BETWEEN 1 AND 200),
  office text NOT NULL CHECK (char_length(office) BETWEEN 1 AND 200),
  district text CHECK (district IS NULL OR char_length(district) <= 120),
  principal_name text CHECK (principal_name IS NULL OR char_length(principal_name) <= 200),
  term_start date NOT NULL,
  term_end date NOT NULL CHECK (term_end > term_start),
  evidence_url text NOT NULL CHECK (evidence_url ~ '^https://' AND char_length(evidence_url) <= 500),
  public_badge boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  reviewed_by uuid REFERENCES dge_identity.accounts(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK ((status IN ('pending','withdrawn')) = (reviewed_at IS NULL))
);
CREATE UNIQUE INDEX official_one_open_request ON app_civic.official_requests(account_id) WHERE status='pending';

CREATE TABLE app_civic.trust_attestations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES dge_identity.accounts(id),
  tier text NOT NULL CHECK (tier IN ('email-verified','verified-person','constituent')),
  jurisdiction text CHECK (jurisdiction IS NULL OR char_length(jurisdiction) <= 200),
  method text NOT NULL CHECK (char_length(method) BETWEEN 1 AND 120),
  evidence_digest char(64) NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  issued_by uuid NOT NULL REFERENCES dge_identity.accounts(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  revoked_at timestamptz,
  CHECK (tier <> 'constituent' OR jurisdiction IS NOT NULL)
);
CREATE INDEX trust_by_account ON app_civic.trust_attestations(account_id);

CREATE TABLE app_civic.bill_profiles (
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL,
  jurisdiction_id text NOT NULL CHECK (jurisdiction_id IN ('us-federal','us-state','us-local')),
  template_parts text[] NOT NULL,
  sponsor_display text CHECK (sponsor_display IS NULL OR char_length(sponsor_display) <= 200),
  created_by uuid NOT NULL REFERENCES dge_identity.accounts(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, document_id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES dge_documents.documents(tenant_id, id)
);

-- Sponsor responses are append-only versions; the latest is current.
CREATE TABLE app_civic.sponsor_responses (
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('incorporated','partially-incorporated','declined','noted','deferred')),
  explanation text NOT NULL CHECK (char_length(explanation) BETWEEN 1 AND 2000),
  responder uuid NOT NULL REFERENCES dge_identity.accounts(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, document_id, proposal_id, version),
  FOREIGN KEY (tenant_id, document_id, proposal_id) REFERENCES dge_proposals.proposals(tenant_id, document_id, id)
);

-- Revised consultations are separately identified documents in a series.
CREATE TABLE app_civic.consultation_editions (
  series_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 1000),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL UNIQUE,
  summary_of_changes text CHECK (summary_of_changes IS NULL OR char_length(summary_of_changes) <= 4000),
  created_by uuid NOT NULL REFERENCES dge_identity.accounts(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (series_id, sequence),
  FOREIGN KEY (tenant_id, document_id) REFERENCES dge_documents.documents(tenant_id, id)
);

CREATE TABLE app_civic.research_groups (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES dge_identity.tenants(id),
  kind text NOT NULL CHECK (kind IN ('class','thesis','project','lab')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  institution text CHECK (institution IS NULL OR char_length(institution) <= 200),
  affiliation_disclosure text NOT NULL CHECK (char_length(affiliation_disclosure) BETWEEN 1 AND 1000),
  funding_disclosure text CHECK (funding_disclosure IS NULL OR char_length(funding_disclosure) <= 1000),
  created_by uuid NOT NULL REFERENCES dge_identity.accounts(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE app_civic.evidence_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES app_civic.research_groups(id),
  document_id uuid,
  kind text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 2000),
  authors text, publisher text, published_on text, pinpoint text,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  quote text CHECK (quote IS NULL OR char_length(quote) <= 2000),
  added_by uuid NOT NULL REFERENCES dge_identity.accounts(id),
  added_at timestamptz NOT NULL
);
CREATE INDEX evidence_by_document ON app_civic.evidence_items(document_id) WHERE document_id IS NOT NULL;

DO $$ DECLARE target text; BEGIN
  FOREACH target IN ARRAY ARRAY['official_requests','trust_attestations','bill_profiles','sponsor_responses','consultation_editions','research_groups','evidence_items'] LOOP
    EXECUTE format('ALTER TABLE app_civic.%I ENABLE ROW LEVEL SECURITY',target);
    EXECUTE format('ALTER TABLE app_civic.%I FORCE ROW LEVEL SECURITY',target);
    EXECUTE format('CREATE POLICY reviewer ON app_civic.%I TO dge_identity_runtime USING (current_setting(''dge.worker'',true)=''civic-review'') WITH CHECK (current_setting(''dge.worker'',true)=''civic-review'')',target);
  END LOOP;
  FOREACH target IN ARRAY ARRAY['official_requests','trust_attestations'] LOOP
    EXECUTE format('CREATE POLICY own_read ON app_civic.%I FOR SELECT TO dge_identity_runtime USING (account_id::text=current_setting(''dge.account_id'',true))',target);
  END LOOP;
  FOREACH target IN ARRAY ARRAY['bill_profiles','sponsor_responses','consultation_editions','research_groups','evidence_items'] LOOP
    EXECUTE format('CREATE POLICY tenant_scope ON app_civic.%I TO dge_identity_runtime USING (tenant_id::text=current_setting(''dge.tenant_id'',true)) WITH CHECK (tenant_id::text=current_setting(''dge.tenant_id'',true))',target);
  END LOOP;
  -- Public civic records about public documents.
  FOREACH target IN ARRAY ARRAY['bill_profiles','sponsor_responses','consultation_editions','evidence_items'] LOOP
    EXECUTE format('CREATE POLICY public_document ON app_civic.%I FOR SELECT TO dge_identity_runtime USING (document_id::text=current_setting(''dge.public_document_id'',true))',target);
  END LOOP;
END $$;
-- Applicants may file and withdraw their own requests; trust attestations are
-- issued only by reviewers, never self-asserted.
CREATE POLICY own_request ON app_civic.official_requests FOR INSERT TO dge_identity_runtime
  WITH CHECK (account_id::text=current_setting('dge.account_id',true) AND status='pending' AND reviewed_by IS NULL);
CREATE POLICY own_withdrawal ON app_civic.official_requests FOR UPDATE TO dge_identity_runtime
  USING (account_id::text=current_setting('dge.account_id',true) AND status='pending')
  WITH CHECK (account_id::text=current_setting('dge.account_id',true) AND status='withdrawn' AND reviewed_by IS NULL);
CREATE POLICY public_badges ON app_civic.official_requests FOR SELECT TO dge_identity_runtime
  USING (public_badge AND status='approved' AND current_setting('dge.public_directory',true)='officials');
CREATE POLICY public_research_groups ON app_civic.research_groups FOR SELECT TO dge_identity_runtime
  USING (id IN (SELECT group_id FROM app_civic.evidence_items WHERE document_id::text=current_setting('dge.public_document_id',true)));

GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA app_civic TO dge_identity_runtime;
GRANT UPDATE (status, review_note, reviewed_by, reviewed_at) ON app_civic.official_requests TO dge_identity_runtime;
GRANT UPDATE (revoked_at) ON app_civic.trust_attestations TO dge_identity_runtime;

CREATE FUNCTION app_civic.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'CivicQuill history is append-only';
END $$;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app_civic.sponsor_responses FOR EACH ROW EXECUTE FUNCTION app_civic.reject_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app_civic.consultation_editions FOR EACH ROW EXECUTE FUNCTION app_civic.reject_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON app_civic.evidence_items FOR EACH ROW EXECUTE FUNCTION app_civic.reject_change();
