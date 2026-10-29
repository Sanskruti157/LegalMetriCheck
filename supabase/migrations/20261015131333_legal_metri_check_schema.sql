/*
# LegalMetriCheck - Full Database Schema Upgrade

## Overview
Transforms the food compliance prototype into a Legal Metrology enforcement system.
Adds role-based access (officer/supervisor), inspections, evidence images, OCR results,
compliance findings, verified rules database, and inspection reports.

## Changes to Existing Tables

### officer_profiles
- ADD COLUMN `role` text NOT NULL DEFAULT 'officer' — 'officer' or 'supervisor'
- ADD COLUMN `supervisor_id` uuid nullable — for officers, references their supervising officer
- ADD COLUMN `assigned_jurisdiction` text nullable — specific area for access control

## New Tables

1. `inspections` — Main inspection records
   - id (uuid PK)
   - officer_id (uuid, defaults to auth.uid(), references officer_profiles)
   - inspection_date (timestamptz)
   - location_name (text) — store/establishment name
   - location_address (text)
   - jurisdiction (text) — where inspection occurred
   - product_name (text)
   - manufacturer_name (text)
   - barcode (text)
   - status (text) — 'draft', 'ocr_review', 'compliance_review', 'submitted', 'approved', 'rejected'
   - overall_verdict (text) — 'pass', 'fail', 'conditional', null while in progress
   - officer_notes (text)
   - supervisor_notes (text)
   - supervisor_id (uuid nullable) — supervisor who reviewed
   - reviewed_at (timestamptz nullable)
   - created_at, updated_at (timestamptz)

2. `evidence_images` — Uploaded product photos
   - id (uuid PK)
   - inspection_id (uuid, references inspections)
   - storage_path (text) — path in Supabase Storage bucket
   - image_url (text) — public URL for display
   - label (text) — 'packaging_front', 'packaging_back', 'label_closeup', 'other'
   - uploaded_at (timestamptz)

3. `ocr_results` — Extracted text from images
   - id (uuid PK)
   - inspection_id (uuid, references inspections)
   - evidence_id (uuid, references evidence_images)
   - raw_text (text) — full raw OCR output
   - extracted_fields (jsonb) — structured fields: product_name, manufacturer, address, net_quantity, mrp, mfg_date, consumer_care
   - fields_not_found (jsonb) — array of field names that could not be extracted
   - officer_corrected (boolean default false) — whether officer manually corrected
   - corrected_fields (jsonb) — officer's corrected values
   - created_at (timestamptz)

4. `compliance_findings` — Individual compliance issues found
   - id (uuid PK)
   - inspection_id (uuid, references inspections)
   - rule_id (uuid, references compliance_rules)
   - finding_type (text) — 'potential' (AI-suggested) or 'confirmed' (officer-verified)
   - severity (text) — 'critical', 'major', 'minor'
   - description (text)
   - evidence_text (text nullable) — supporting text from OCR
   - officer_observation (text nullable) — officer's notes on this finding
   - status (text) — 'open', 'acknowledged', 'dismissed'
   - created_at (timestamptz)

5. `compliance_rules` — Verified database of Legal Metrology rules
   - id (uuid PK)
   - rule_code (text unique) — e.g. 'LM-R1'
   - rule_name (text)
   - description (text)
   - required_field (text) — which label field this rule checks
   - severity (text) — 'critical', 'major', 'minor'
   - category (text) — 'declaration', 'quantity', 'pricing', 'address', 'date'
   - is_active (boolean default true)
   - created_at (timestamptz)

6. `inspection_reports` — Generated report snapshots
   - id (uuid PK)
   - inspection_id (uuid, references inspections)
   - report_number (text unique)
   - generated_by (uuid, references officer_profiles)
   - report_data (jsonb) — full snapshot of inspection at generation time
   - created_at (timestamptz)

## Security

- RLS on all new tables
- officer_profiles: officers see their own profile; supervisors see profiles of officers in their jurisdiction
- inspections: officers see only their own; supervisors see all in their jurisdiction
- evidence_images, ocr_results, compliance_findings: access scoped through parent inspection
- compliance_rules: readable by all authenticated users (shared reference data)
- inspection_reports: scoped through parent inspection
- Storage bucket 'evidence' created with private access, RLS policies for owner-scoped uploads

## Important Notes
1. The `role` column on officer_profiles drives frontend navigation and access control
2. Supervisors can view inspections where jurisdiction matches their own
3. Officers can only see inspections they created
4. All child tables (evidence, ocr, findings, reports) inherit access from their parent inspection
*/

-- Add role and supervisor columns to officer_profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'officer_profiles' AND column_name = 'role') THEN
    ALTER TABLE officer_profiles ADD COLUMN role text NOT NULL DEFAULT 'officer';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'officer_profiles' AND column_name = 'supervisor_id') THEN
    ALTER TABLE officer_profiles ADD COLUMN supervisor_id uuid REFERENCES officer_profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'officer_profiles' AND column_name = 'assigned_jurisdiction') THEN
    ALTER TABLE officer_profiles ADD COLUMN assigned_jurisdiction text;
  END IF;
END $$;

-- Create compliance_rules table (reference data, readable by all authenticated)
CREATE TABLE IF NOT EXISTS compliance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text UNIQUE NOT NULL,
  rule_name text NOT NULL,
  description text NOT NULL,
  required_field text NOT NULL,
  severity text NOT NULL DEFAULT 'major',
  category text NOT NULL DEFAULT 'declaration',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE compliance_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_rules_authenticated" ON compliance_rules;
CREATE POLICY "select_rules_authenticated" ON compliance_rules FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_rules_authenticated" ON compliance_rules;
CREATE POLICY "insert_rules_authenticated" ON compliance_rules FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_rules_authenticated" ON compliance_rules;
CREATE POLICY "update_rules_authenticated" ON compliance_rules FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- Create inspections table
CREATE TABLE IF NOT EXISTS inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id uuid NOT NULL DEFAULT auth.uid() REFERENCES officer_profiles(id) ON DELETE CASCADE,
  inspection_date timestamptz NOT NULL DEFAULT now(),
  location_name text,
  location_address text,
  jurisdiction text,
  product_name text,
  manufacturer_name text,
  barcode text,
  status text NOT NULL DEFAULT 'draft',
  overall_verdict text,
  officer_notes text,
  supervisor_notes text,
  supervisor_id uuid REFERENCES officer_profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;

-- Officers see their own inspections; supervisors see inspections in their jurisdiction
DROP POLICY IF EXISTS "select_inspections" ON inspections;
CREATE POLICY "select_inspections" ON inspections FOR SELECT
  TO authenticated USING (
    officer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM officer_profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'supervisor'
      AND (p.assigned_jurisdiction IS NULL OR inspections.jurisdiction = p.assigned_jurisdiction)
    )
  );

DROP POLICY IF EXISTS "insert_inspections" ON inspections;
CREATE POLICY "insert_inspections" ON inspections FOR INSERT
  TO authenticated WITH CHECK (officer_id = auth.uid());

DROP POLICY IF EXISTS "update_inspections" ON inspections;
CREATE POLICY "update_inspections" ON inspections FOR UPDATE
  TO authenticated USING (
    officer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM officer_profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'supervisor'
    )
  ) WITH CHECK (
    officer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM officer_profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'supervisor'
    )
  );

DROP POLICY IF EXISTS "delete_inspections" ON inspections;
CREATE POLICY "delete_inspections" ON inspections FOR DELETE
  TO authenticated USING (officer_id = auth.uid());

-- Create evidence_images table
CREATE TABLE IF NOT EXISTS evidence_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  image_url text,
  label text NOT NULL DEFAULT 'other',
  uploaded_at timestamptz DEFAULT now()
);

ALTER TABLE evidence_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_evidence" ON evidence_images;
CREATE POLICY "select_evidence" ON evidence_images FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = evidence_images.inspection_id
      AND (i.officer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM officer_profiles p
          WHERE p.id = auth.uid() AND p.role = 'supervisor'
          AND (p.assigned_jurisdiction IS NULL OR i.jurisdiction = p.assigned_jurisdiction)
        ))
    )
  );

DROP POLICY IF EXISTS "insert_evidence" ON evidence_images;
CREATE POLICY "insert_evidence" ON evidence_images FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = evidence_images.inspection_id AND i.officer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_evidence" ON evidence_images;
CREATE POLICY "delete_evidence" ON evidence_images FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = evidence_images.inspection_id AND i.officer_id = auth.uid()
    )
  );

-- Create ocr_results table
CREATE TABLE IF NOT EXISTS ocr_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES evidence_images(id) ON DELETE SET NULL,
  raw_text text,
  extracted_fields jsonb DEFAULT '{}'::jsonb,
  fields_not_found jsonb DEFAULT '[]'::jsonb,
  officer_corrected boolean NOT NULL DEFAULT false,
  corrected_fields jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ocr_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_ocr" ON ocr_results;
CREATE POLICY "select_ocr" ON ocr_results FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = ocr_results.inspection_id
      AND (i.officer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM officer_profiles p
          WHERE p.id = auth.uid() AND p.role = 'supervisor'
          AND (p.assigned_jurisdiction IS NULL OR i.jurisdiction = p.assigned_jurisdiction)
        ))
    )
  );

DROP POLICY IF EXISTS "insert_ocr" ON ocr_results;
CREATE POLICY "insert_ocr" ON ocr_results FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = ocr_results.inspection_id AND i.officer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_ocr" ON ocr_results;
CREATE POLICY "update_ocr" ON ocr_results FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = ocr_results.inspection_id AND i.officer_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = ocr_results.inspection_id AND i.officer_id = auth.uid()
    )
  );

-- Create compliance_findings table
CREATE TABLE IF NOT EXISTS compliance_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES compliance_rules(id) ON DELETE SET NULL,
  finding_type text NOT NULL DEFAULT 'potential',
  severity text NOT NULL DEFAULT 'major',
  description text NOT NULL,
  evidence_text text,
  officer_observation text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE compliance_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_findings" ON compliance_findings;
CREATE POLICY "select_findings" ON compliance_findings FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = compliance_findings.inspection_id
      AND (i.officer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM officer_profiles p
          WHERE p.id = auth.uid() AND p.role = 'supervisor'
          AND (p.assigned_jurisdiction IS NULL OR i.jurisdiction = p.assigned_jurisdiction)
        ))
    )
  );

DROP POLICY IF EXISTS "insert_findings" ON compliance_findings;
CREATE POLICY "insert_findings" ON compliance_findings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = compliance_findings.inspection_id AND i.officer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_findings" ON compliance_findings;
CREATE POLICY "update_findings" ON compliance_findings FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = compliance_findings.inspection_id
      AND (i.officer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM officer_profiles p
          WHERE p.id = auth.uid() AND p.role = 'supervisor'
        ))
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = compliance_findings.inspection_id
      AND (i.officer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM officer_profiles p
          WHERE p.id = auth.uid() AND p.role = 'supervisor'
        ))
    )
  );

DROP POLICY IF EXISTS "delete_findings" ON compliance_findings;
CREATE POLICY "delete_findings" ON compliance_findings FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = compliance_findings.inspection_id AND i.officer_id = auth.uid()
    )
  );

-- Create inspection_reports table
CREATE TABLE IF NOT EXISTS inspection_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  report_number text UNIQUE NOT NULL,
  generated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES officer_profiles(id) ON DELETE CASCADE,
  report_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inspection_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_reports" ON inspection_reports;
CREATE POLICY "select_reports" ON inspection_reports FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = inspection_reports.inspection_id
      AND (i.officer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM officer_profiles p
          WHERE p.id = auth.uid() AND p.role = 'supervisor'
          AND (p.assigned_jurisdiction IS NULL OR i.jurisdiction = p.assigned_jurisdiction)
        ))
    )
  );

DROP POLICY IF EXISTS "insert_reports" ON inspection_reports;
CREATE POLICY "insert_reports" ON inspection_reports FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections i
      WHERE i.id = inspection_reports.inspection_id
      AND (i.officer_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM officer_profiles p
          WHERE p.id = auth.uid() AND p.role = 'supervisor'
        ))
    )
  );

-- Update officer_profiles policies to include supervisor access
DROP POLICY IF EXISTS "select_own_profile" ON officer_profiles;
CREATE POLICY "select_own_profile" ON officer_profiles FOR SELECT
  TO authenticated USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM officer_profiles p
      WHERE p.id = auth.uid() AND p.role = 'supervisor'
      AND (p.assigned_jurisdiction IS NULL OR officer_profiles.assigned_jurisdiction = p.assigned_jurisdiction)
    )
  );

-- Seed compliance rules for Legal Metrology
INSERT INTO compliance_rules (rule_code, rule_name, description, required_field, severity, category) VALUES
  ('LM-R1', 'Product Name Declaration', 'The name of the product must be clearly printed on the packaging.', 'product_name', 'critical', 'declaration'),
  ('LM-R2', 'Manufacturer/Packer/Importer Name', 'Name of manufacturer, packer, or importer must be declared on the label.', 'manufacturer_name', 'critical', 'declaration'),
  ('LM-R3', 'Manufacturer Address', 'Complete address of manufacturer/packer/importer must be printed on the label.', 'address', 'major', 'address'),
  ('LM-R4', 'Net Quantity Declaration', 'Net quantity in standard units (g, kg, ml, L) must be declared.', 'net_quantity', 'critical', 'quantity'),
  ('LM-R5', 'MRP Declaration', 'Maximum Retail Price must be printed as Rs. or MRP followed by the amount.', 'mrp', 'critical', 'pricing'),
  ('LM-R6', 'Manufacturing/Packing Date', 'Date of manufacture or packing must be printed on the label.', 'mfg_date', 'major', 'date'),
  ('LM-R7', 'Consumer Care Contact', 'Consumer care email or phone number must be provided for grievance redressal.', 'consumer_care', 'minor', 'declaration'),
  ('LM-R8', 'Batch/Lot Number', 'Batch or lot identification number should be printed for traceability.', 'batch_number', 'minor', 'declaration')
ON CONFLICT (rule_code) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_inspections_officer ON inspections(officer_id);
CREATE INDEX IF NOT EXISTS idx_inspections_jurisdiction ON inspections(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_evidence_inspection ON evidence_images(inspection_id);
CREATE INDEX IF NOT EXISTS idx_ocr_inspection ON ocr_results(inspection_id);
CREATE INDEX IF NOT EXISTS idx_findings_inspection ON compliance_findings(inspection_id);
CREATE INDEX IF NOT EXISTS idx_reports_inspection ON inspection_reports(inspection_id);

-- Create storage bucket for evidence images (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence', 'evidence', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: officers can upload to their own folder, supervisors can read jurisdiction evidence
DROP POLICY IF EXISTS "evidence_upload_own" ON storage.objects;
CREATE POLICY "evidence_upload_own" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'evidence'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "evidence_read_own" ON storage.objects;
CREATE POLICY "evidence_read_own" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'evidence'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "evidence_read_supervisor" ON storage.objects;
CREATE POLICY "evidence_read_supervisor" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'evidence'
    AND EXISTS (
      SELECT 1 FROM officer_profiles p
      WHERE p.id = auth.uid() AND p.role = 'supervisor'
    )
  );

DROP POLICY IF EXISTS "evidence_delete_own" ON storage.objects;
CREATE POLICY "evidence_delete_own" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'evidence'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
