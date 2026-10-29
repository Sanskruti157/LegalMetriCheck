const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ExtractedFields {
  product_name?: string;
  manufacturer_name?: string;
  address?: string;
  net_quantity?: string;
  mrp?: string;
  mfg_date?: string;
  consumer_care?: string;
  batch_number?: string;
}

interface ComplianceRule {
  id: string;
  rule_code: string;
  rule_name: string;
  description: string;
  required_field: string;
  severity: "critical" | "major" | "minor";
  category: string;
}

export interface PotentialFinding {
  rule_id: string;
  rule_code: string;
  rule_name: string;
  description: string;
  legal_reference: string;
  severity: "critical" | "major" | "minor";
  finding_type: "potential" | "manual_review" | "confirmed";
  evidence_text: string | null;
  recommended_action: string;
}

const LEGAL_REFERENCES: Record<string, string> = {
  product_name: "Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(b)",
  manufacturer_name: "Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(a)",
  address: "Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(a)",
  net_quantity: "Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(c), Rule 12 & Rule 13",
  mrp: "Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(e)",
  mfg_date: "Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(d)",
  consumer_care: "Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(da)",
  batch_number: "Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6(1)(g)",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { extractedFields, rules } = (await req.json()) as {
      extractedFields: ExtractedFields;
      rules: ComplianceRule[];
    };

    const findings: PotentialFinding[] = [];

    for (const rule of rules) {
      const fieldValue = (extractedFields as Record<string, string | undefined>)[rule.required_field]?.trim();
      const legalRef = LEGAL_REFERENCES[rule.required_field] ?? "Legal Metrology (Packaged Commodities) Rules, 2011";

      if (!fieldValue || fieldValue.length === 0) {
        // Field was not detected by OCR
        findings.push({
          rule_id: rule.id,
          rule_code: rule.rule_code,
          rule_name: rule.rule_name,
          legal_reference: legalRef,
          description: `${rule.rule_name} was not detected by OCR. Legal Metrology requires this mandatory declaration on packaged commodities. Verify if the declaration is physically printed on the package or genuinely missing.`,
          severity: rule.severity,
          finding_type: "manual_review",
          evidence_text: null,
          recommended_action: "Inspect packaging visually. If present, enter value in OCR Review. If absent, confirm violation under Section 36 of Legal Metrology Act, 2009.",
        });
      } else if (rule.required_field === "mrp") {
        // MRP format checks: currency symbol & inclusive of all taxes (Rule 6(1)(e))
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
            severity: "critical",
            finding_type: "potential",
            evidence_text: fieldValue,
            recommended_action: "Verify whether MRP is unambiguously printed with Rs. or ₹ symbol.",
          });
        } else if (!hasTaxClause) {
          findings.push({
            rule_id: rule.id,
            rule_code: rule.rule_code,
            rule_name: "MRP Tax Inclusion Declaration",
            legal_reference: legalRef,
            description: `The detected MRP "${fieldValue}" does not contain the mandatory statement "(inclusive of all taxes)" or "(incl. of all taxes)" required by Rule 6(1)(e).`,
            severity: "major",
            finding_type: "potential",
            evidence_text: fieldValue,
            recommended_action: "Check package label to verify whether '(inclusive of all taxes)' is printed alongside the MRP.",
          });
        }
      } else if (rule.required_field === "net_quantity") {
        // Net quantity checks: standard metric units (Rule 12 & 13)
        const hasMetricUnit = /\b(?:g|gm|gram|grams|kg|kgs|kilogram|kilograms|ml|milliliter|millilitre|l|litre|liter|litres|mg|n|unit|units|pcs|pieces)\b/i.test(
          fieldValue,
        );
        const hasDigits = /\d/.test(fieldValue);

        if (!hasDigits || !hasMetricUnit) {
          findings.push({
            rule_id: rule.id,
            rule_code: rule.rule_code,
            rule_name: "Net Quantity Standard Metric Units",
            legal_reference: legalRef,
            description: `The net quantity declaration "${fieldValue}" does not appear to declare quantity in standard metric units (g, kg, ml, L, N) as required under Rules 12 and 13.`,
            severity: "critical",
            finding_type: "potential",
            evidence_text: fieldValue,
            recommended_action: "Verify if net quantity is declared with correct metric symbols without non-standard abbreviations.",
          });
        }
      } else if (rule.required_field === "address") {
        // Complete address check: postal PIN code (Rule 6(1)(a))
        const hasPinCode = /\b\d{6}\b/.test(fieldValue);
        if (!hasPinCode && fieldValue.length < 25) {
          findings.push({
            rule_id: rule.id,
            rule_code: rule.rule_code,
            rule_name: "Complete Address Declaration",
            legal_reference: legalRef,
            description: `The detected address "${fieldValue}" may be incomplete. Rule 6(1)(a) requires the complete postal address including premises/street and postal PIN code.`,
            severity: "major",
            finding_type: "potential",
            evidence_text: fieldValue,
            recommended_action: "Verify whether the complete postal address with postal PIN code is declared on the label.",
          });
        }
      } else if (rule.required_field === "consumer_care") {
        // Consumer care details check: phone or email (Rule 6(1)(da))
        const hasPhone = /\b(?:\+?91[\-\s]?)?\d{10}\b|\b1800[\-\s]?\d{3}[\-\s]?\d{3,4}\b/.test(fieldValue);
        const hasEmail = /@/.test(fieldValue);
        if (!hasPhone && !hasEmail) {
          findings.push({
            rule_id: rule.id,
            rule_code: rule.rule_code,
            rule_name: "Consumer Care Contact Means",
            legal_reference: legalRef,
            description: `Consumer care details "${fieldValue}" do not appear to contain a telephone number or email address as required under Rule 6(1)(da).`,
            severity: "minor",
            finding_type: "potential",
            evidence_text: fieldValue,
            recommended_action: "Verify whether telephone number and email address are provided for consumer grievance redressal.",
          });
        }
      }
    }

    return new Response(JSON.stringify({ findings }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Compliance check failed";
    return new Response(
      JSON.stringify({ error: message, findings: [] }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
