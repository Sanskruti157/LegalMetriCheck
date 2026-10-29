import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export type UserRole = 'officer' | 'supervisor';

export interface OfficerProfile {
  id: string;
  full_name: string;
  badge_number: string;
  jurisdiction: string | null;
  role: UserRole;
  supervisor_id: string | null;
  assigned_jurisdiction: string | null;
  created_at: string;
}

export type InspectionStatus =
  | 'draft'
  | 'ocr_review'
  | 'compliance_review'
  | 'submitted'
  | 'approved'
  | 'rejected';

export type Verdict = 'pass' | 'fail' | 'conditional';

export interface Inspection {
  id: string;
  officer_id: string;
  inspection_date: string;
  location_name: string | null;
  location_address: string | null;
  jurisdiction: string | null;
  product_name: string | null;
  manufacturer_name: string | null;
  barcode: string | null;
  status: InspectionStatus;
  overall_verdict: Verdict | null;
  officer_notes: string | null;
  supervisor_notes: string | null;
  supervisor_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  officer?: OfficerProfile;
}

export interface EvidenceImage {
  id: string;
  inspection_id: string;
  storage_path: string;
  image_url: string | null;
  label: string;
  uploaded_at: string;
}

export interface OcrExtractedFields {
  brand_name?: string;
  product_name?: string;
  manufacturer_name?: string;
  address?: string;
  net_quantity?: string;
  mrp?: string;
  mfg_date?: string;
  consumer_care?: string;
  batch_number?: string;
}

export interface OcrResult {
  id: string;
  inspection_id: string;
  evidence_id: string | null;
  raw_text: string | null;
  extracted_fields: OcrExtractedFields;
  fields_not_found: string[];
  officer_corrected: boolean;
  corrected_fields: Partial<OcrExtractedFields>;
  created_at: string;
}

export interface ComplianceRule {
  id: string;
  rule_code: string;
  rule_name: string;
  description: string;
  required_field: string;
  severity: 'critical' | 'major' | 'minor';
  category: string;
  is_active: boolean;
}

export interface ComplianceFinding {
  id: string;
  inspection_id: string;
  rule_id: string | null;
  finding_type: 'potential' | 'confirmed';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  evidence_text: string | null;
  officer_observation: string | null;
  status: 'open' | 'acknowledged' | 'dismissed';
  created_at: string;
  rule?: ComplianceRule;
}

// Legacy types kept for backward compatibility with existing report components
export type ComplianceStatus = 'compliant' | 'non_compliant' | 'warning' | 'pending';

export interface Violation {
  type: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
}

export interface Product {
  id: string;
  name: string;
  barcode: string | null;
  category: string | null;
  created_at: string;
}

export interface ComplianceCheck {
  id: string;
  officer_id: string;
  product_id: string | null;
  image_url: string | null;
  status: ComplianceStatus;
  violations: Violation[];
  notes: string | null;
  checked_at: string;
  product?: Product;
  officer?: OfficerProfile;
}
