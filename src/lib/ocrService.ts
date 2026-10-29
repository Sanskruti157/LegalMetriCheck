import type { OcrExtractedFields, ComplianceRule } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';

export interface OcrResponse {
  raw_text: string;
  extracted_fields: Partial<OcrExtractedFields>;
  fields_not_found: string[];
  ocr_error?: string;
}

export interface PotentialFinding {
  rule_id: string;
  rule_code: string;
  rule_name: string;
  legal_reference?: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  finding_type: 'potential' | 'manual_review' | 'confirmed';
  evidence_text: string | null;
  recommended_action?: string;
}

export interface OcrImageInput {
  storagePath: string;
  imageUrl?: string | null;
  imageBase64?: string | null;
  label?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function callOcrExtract(input: OcrImageInput | string): Promise<OcrResponse> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocr-extract`;
  const headers = await getAuthHeaders();

  const payload = typeof input === 'string'
    ? { storagePath: input }
    : {
        storagePath: input.storagePath,
        imageUrl: input.imageUrl ?? undefined,
        imageBase64: input.imageBase64 ?? undefined,
      };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OCR request failed (${response.status}): ${errorText.slice(0, 100)}`);
  }

  const data = await response.json();
  return {
    raw_text: data.raw_text ?? '',
    extracted_fields: data.extracted_fields ?? {},
    fields_not_found: data.fields_not_found ?? [],
    ocr_error: data.ocr_error,
  };
}

export async function callOcrExtractMultiple(inputs: (OcrImageInput | string)[]): Promise<OcrResponse> {
  if (inputs.length === 0) {
    return { raw_text: '', extracted_fields: {}, fields_not_found: [] };
  }

  // Run OCR on all images in parallel
  const results = await Promise.allSettled(
    inputs.map((inp) => callOcrExtract(inp)),
  );

  const mergedFields: Partial<OcrExtractedFields> = {};
  const allRawTextChunks: string[] = [];
  const allFieldKeys: (keyof OcrExtractedFields)[] = [
    'brand_name',
    'product_name',
    'manufacturer_name',
    'address',
    'net_quantity',
    'mrp',
    'mfg_date',
    'consumer_care',
    'batch_number',
  ];
  const foundFields = new Set<string>();
  let firstError: string | undefined;

  for (let idx = 0; idx < results.length; idx++) {
    const res = results[idx];
    const inp = inputs[idx];
    const label = typeof inp === 'object' && inp.label ? inp.label.replace(/_/g, ' ') : `Image ${idx + 1}`;

    if (res.status === 'fulfilled') {
      if (res.value.ocr_error && !firstError) {
        firstError = res.value.ocr_error;
      }
      if (res.value.raw_text && res.value.raw_text.trim().length > 0) {
        allRawTextChunks.push(`--- [${label.toUpperCase()}] ---\n${res.value.raw_text.trim()}`);
      }
      console.log(`OCR response for ${label}:`, res.value);
      const fields = res.value.extracted_fields;
      for (const key of allFieldKeys) {
        const val = fields[key];
        if (val && val.trim().length >= 1 && !foundFields.has(key)) {
          mergedFields[key] = val.trim();
          foundFields.add(key);
        }
      }
    } else {
      if (!firstError) {
        firstError = res.reason instanceof Error ? res.reason.message : 'OCR extraction failed';
      }
    }
  }

  const fieldsNotFound = allFieldKeys.filter((k) => !foundFields.has(k));

  return {
    raw_text: allRawTextChunks.join('\n\n').substring(0, 10000),
    extracted_fields: mergedFields,
    fields_not_found: fieldsNotFound,
    ocr_error: firstError,
  };
}

const LEGAL_REFERENCES: Record<string, string> = {
  product_name: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(b)',
  manufacturer_name: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(a)',
  address: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(a)',
  net_quantity: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(c), Rule 12 & Rule 13',
  mrp: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(e)',
  mfg_date: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(d)',
  consumer_care: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(da)',
  batch_number: 'Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(g)',
};

function runLocalComplianceCheck(
  extractedFields: Partial<OcrExtractedFields>,
  rules: ComplianceRule[],
): PotentialFinding[] {
  const findings: PotentialFinding[] = [];

  for (const rule of rules) {
    const fieldValue = (extractedFields as Record<string, string | undefined>)[rule.required_field]?.trim();
    const legalRef = LEGAL_REFERENCES[rule.required_field] ?? 'Legal Metrology (Packaged Commodities) Rules, 2011';

    if (!fieldValue || fieldValue.length === 0) {
      findings.push({
        rule_id: rule.id,
        rule_code: rule.rule_code,
        rule_name: rule.rule_name,
        legal_reference: legalRef,
        description: `${rule.rule_name} was not detected by OCR. Legal Metrology requires this mandatory declaration on packaged commodities. Verify if the declaration is physically printed on the package or genuinely missing.`,
        severity: rule.severity,
        finding_type: 'manual_review',
        evidence_text: null,
        recommended_action: 'Inspect packaging visually. If present, enter value in OCR Review. If absent, confirm violation under Section 36 of Legal Metrology Act, 2009.',
      });
    } else if (rule.required_field === 'mrp') {
      const hasCurrency = /(?:rs\.?|₹|inr)/i.test(fieldValue);
      const hasDigits = /\d/.test(fieldValue);
      const hasTaxClause = /(?:incl(?:usive)?\.?\s*of\s*all\s*taxes|incl\.?\s*taxes)/i.test(fieldValue);

      if (!hasDigits || !hasCurrency) {
        findings.push({
          rule_id: rule.id,
          rule_code: rule.rule_code,
          rule_name: rule.rule_name,
          legal_reference: legalRef,
          description: `The detected MRP value "${fieldValue}" does not specify a valid price with standard currency symbol (₹ or Rs.) as mandated by Rule 6(1)(e).`,
          severity: 'critical',
          finding_type: 'potential',
          evidence_text: fieldValue,
          recommended_action: 'Verify whether MRP is unambiguously printed with Rs. or ₹ symbol.',
        });
      } else if (!hasTaxClause) {
        findings.push({
          rule_id: rule.id,
          rule_code: rule.rule_code,
          rule_name: 'MRP Tax Inclusion Declaration',
          legal_reference: legalRef,
          description: `The detected MRP "${fieldValue}" does not contain the mandatory statement "(inclusive of all taxes)" or "(incl. of all taxes)" required by Rule 6(1)(e).`,
          severity: 'major',
          finding_type: 'potential',
          evidence_text: fieldValue,
          recommended_action: "Check package label to verify whether '(inclusive of all taxes)' is printed alongside the MRP.",
        });
      }
    } else if (rule.required_field === 'net_quantity') {
      const hasMetricUnit = /\b(?:g|gm|gram|grams|kg|kgs|kilogram|kilograms|ml|milliliter|millilitre|l|litre|liter|litres|mg|n|unit|units|pcs|pieces)\b/i.test(fieldValue);
      const hasDigits = /\d/.test(fieldValue);

      if (!hasDigits || !hasMetricUnit) {
        findings.push({
          rule_id: rule.id,
          rule_code: rule.rule_code,
          rule_name: 'Net Quantity Standard Metric Units',
          legal_reference: legalRef,
          description: `The net quantity declaration "${fieldValue}" does not appear to declare quantity in standard metric units (g, kg, ml, L, N) as required under Rules 12 and 13.`,
          severity: 'critical',
          finding_type: 'potential',
          evidence_text: fieldValue,
          recommended_action: 'Verify if net quantity is declared with correct metric symbols without non-standard abbreviations.',
        });
      }
    } else if (rule.required_field === 'address') {
      const hasPinCode = /\b\d{6}\b/.test(fieldValue);
      if (!hasPinCode && fieldValue.length < 25) {
        findings.push({
          rule_id: rule.id,
          rule_code: rule.rule_code,
          rule_name: 'Complete Address Declaration',
          legal_reference: legalRef,
          description: `The detected address "${fieldValue}" may be incomplete. Rule 6(1)(a) requires the complete postal address including premises/street and postal PIN code.`,
          severity: 'major',
          finding_type: 'potential',
          evidence_text: fieldValue,
          recommended_action: 'Verify whether the complete postal address with postal PIN code is declared on the label.',
        });
      }
    } else if (rule.required_field === 'consumer_care') {
      const hasPhone = /\b(?:\+?91[-\s]?)?\d{10}\b|\b1800[-\s]?\d{3}[-\s]?\d{3,4}\b/.test(fieldValue);
      const hasEmail = /@/.test(fieldValue);
      if (!hasPhone && !hasEmail) {
        findings.push({
          rule_id: rule.id,
          rule_code: rule.rule_code,
          rule_name: 'Consumer Care Contact Means',
          legal_reference: legalRef,
          description: `Consumer care details "${fieldValue}" do not appear to contain a telephone number or email address as required under Rule 6(1)(da).`,
          severity: 'minor',
          finding_type: 'potential',
          evidence_text: fieldValue,
          recommended_action: 'Verify whether telephone number and email address are provided for consumer grievance redressal.',
        });
      }
    }
  }

  return findings;
}

export async function callComplianceCheck(
  extractedFields: Partial<OcrExtractedFields>,
  rules: ComplianceRule[],
): Promise<PotentialFinding[]> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compliance-check`;
    const headers = await getAuthHeaders();

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ extractedFields, rules }),
    });

    if (!response.ok) {
      return runLocalComplianceCheck(extractedFields, rules);
    }

    const data = await response.json();
    if (data.error || !data.findings) {
      return runLocalComplianceCheck(extractedFields, rules);
    }
    return data.findings;
  } catch {
    return runLocalComplianceCheck(extractedFields, rules);
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
