import type { Inspection, EvidenceImage, OcrExtractedFields, ComplianceFinding, OfficerProfile } from '@/lib/supabase';

export interface InspectionReportPayload {
  reportNumber: string;
  inspection: Inspection;
  officer: OfficerProfile | null;
  evidence: EvidenceImage[];
  ocrFields: Partial<OcrExtractedFields>;
  rawOcrText?: string;
  findings: ComplianceFinding[];
  evidenceUrls?: Record<string, string>;
}

export function generateReportNumber(inspectionId: string): string {
  const shortId = inspectionId.slice(0, 8).toUpperCase();
  const year = new Date().getFullYear();
  return `LMR-${year}-${shortId}`;
}

export function generateLegalMetrologyReportHTML(data: InspectionReportPayload): string {
  const { inspection, officer, evidence, ocrFields, findings, evidenceUrls = {}, reportNumber } = data;

  const dateFormatted = new Date(inspection.inspection_date).toLocaleString('en-IN', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const verdict = inspection.overall_verdict ?? 'conditional';
  const verdictConfig = {
    pass: { title: 'COMPLIANT (PASS)', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    fail: { title: 'NON-COMPLIANT (FAIL)', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
    conditional: { title: 'PENDING / CONDITIONAL REVIEW', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  }[verdict];

  const confirmedFindings = findings.filter((f) => f.finding_type === 'confirmed');
  const potentialFindings = findings.filter((f) => f.finding_type !== 'confirmed');

  const findingsRows = findings.length > 0
    ? findings.map((f, i) => {
        const isConfirmed = f.finding_type === 'confirmed';
        const typeBadge = isConfirmed
          ? '<span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">CONFIRMED VIOLATION</span>'
          : '<span style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">NEEDS VERIFICATION</span>';

        const severityBadge = {
          critical: '<span style="background:#fecaca;color:#991b1b;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">CRITICAL</span>',
          major: '<span style="background:#ffedd5;color:#9a3412;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">MAJOR</span>',
          minor: '<span style="background:#fef9c3;color:#854d0e;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">MINOR</span>',
        }[f.severity] ?? '';

        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:600;text-align:center;">${i + 1}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;">
              <div style="font-weight:700;color:#1e293b;">${f.rule?.rule_name ?? f.description.split(':')[0]}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;">${f.rule?.rule_code ?? 'Legal Metrology PC Rules, 2011'}</div>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;">${severityBadge}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;">${typeBadge}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;">
              ${f.description}
              ${f.officer_observation ? `<div style="margin-top:4px;font-size:11px;color:#047857;background:#ecfdf5;padding:4px 8px;border-radius:4px;"><strong>Officer Observation:</strong> ${f.officer_observation}</div>` : ''}
            </td>
          </tr>
        `;
      }).join('')
    : `<tr><td colspan="5" style="text-align:center;padding:24px;color:#059669;font-weight:600;font-size:13px;">No compliance issues or violations identified. All statutory declarations verified under Legal Metrology (Packaged Commodities) Rules, 2011.</td></tr>`;

  const evidenceThumbs = evidence.map((img) => {
    const url = evidenceUrls[img.id] || img.image_url;
    const label = img.label.replace(/_/g, ' ').toUpperCase();
    return `
      <div style="flex:1;min-width:180px;max-width:220px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#f8fafc;">
        ${url ? `<img src="${url}" style="width:100%;height:140px;object-fit:cover;display:block;" alt="${label}" />` : '<div style="height:140px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">Image Stored</div>'}
        <div style="padding:6px 10px;background:#0f172a;color:#fff;font-size:10px;font-weight:700;letter-spacing:0.5px;text-align:center;">${label}</div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Legal Metrology Inspection Report — ${reportNumber}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #fff; color: #0f172a; line-height: 1.4; padding: 20px; }
    .report-card { max-width: 850px; margin: 0 auto; border: 2px solid #cbd5e1; border-radius: 12px; overflow: hidden; }
    .header { background: #064e3b; color: #fff; padding: 24px; border-bottom: 4px solid #10b981; }
    .gov-badge { display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; background: rgba(255,255,255,0.15); padding: 4px 12px; border-radius: 9999px; margin-bottom: 8px; }
    .header h1 { font-size: 20px; font-weight: 800; letter-spacing: 0.5px; }
    .header p { font-size: 13px; opacity: 0.9; margin-top: 3px; }
    .meta-bar { display: flex; justify-content: space-between; background: #047857; color: #fff; padding: 10px 24px; font-size: 12px; font-weight: 600; }
    .content { padding: 24px; }
    .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #0f172a; margin-top: 20px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }
    .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; }
    .info-box .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
    .info-box .value { font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px; }
    .verdict-box { padding: 16px 20px; border-radius: 8px; margin: 16px 0; display: flex; align-items: center; justify-content: space-between; }
    .declarations-table, .findings-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .declarations-table th, .findings-table th { background: #f1f5f9; padding: 8px 12px; font-size: 11px; font-weight: 700; text-align: left; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
    .declarations-table td { padding: 8px 12px; font-size: 12px; border-bottom: 1px solid #e2e8f0; }
    .declarations-table tr:nth-child(even) { background: #f8fafc; }
    .sign-area { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; border-top: 1px dashed #cbd5e1; }
    .sign-box { text-align: center; width: 220px; }
    .sign-line { border-bottom: 1px solid #0f172a; height: 40px; margin-bottom: 8px; }
    .sign-title { font-size: 11px; font-weight: 700; color: #334155; }
    .sign-sub { font-size: 10px; color: #64748b; }
    @media print {
      body { padding: 0; background: #fff; }
      .report-card { border: none; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="report-card">
    <div class="header">
      <div class="gov-badge">Government Enforcement Inspection Report</div>
      <h1>LEGAL METROLOGY (PACKAGED COMMODITIES) RULES, 2011</h1>
      <p>Inspection & Compliance Assessment Record under The Legal Metrology Act, 2009</p>
    </div>
    
    <div class="meta-bar">
      <span>Report No: <strong>${reportNumber}</strong></span>
      <span>Date: <strong>${dateFormatted}</strong></span>
      <span>Jurisdiction: <strong>${inspection.jurisdiction || officer?.assigned_jurisdiction || 'State Enforcement Wing'}</strong></span>
    </div>

    <div class="content">
      <!-- Verdict Banner -->
      <div class="verdict-box" style="background:${verdictConfig.bg};border:2px solid ${verdictConfig.border};color:${verdictConfig.color};">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.8;">Statutory Assessment Verdict</div>
          <div style="font-size:22px;font-weight:900;letter-spacing:0.5px;">${verdictConfig.title}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;font-weight:700;">Violations Confirmed: ${confirmedFindings.length}</div>
          <div style="font-size:11px;opacity:0.8;">Manual Verification Needed: ${potentialFindings.length}</div>
        </div>
      </div>

      <!-- Inspection & Officer Details -->
      <div class="section-title">1. Inspection & Officer Information</div>
      <div class="info-grid">
        <div class="info-box">
          <div class="label">Establishment / Store</div>
          <div class="value">${inspection.location_name || 'Retail Outlet'}</div>
        </div>
        <div class="info-box">
          <div class="label">Store Location / Address</div>
          <div class="value">${inspection.location_address || 'As recorded in field log'}</div>
        </div>
        <div class="info-box">
          <div class="label">Inspecting Officer</div>
          <div class="value">${officer?.full_name || 'Enforcement Officer'}</div>
        </div>
        <div class="info-box">
          <div class="label">Officer Badge / Jurisdiction</div>
          <div class="value">${officer?.badge_number || 'LM-OFFICER'} · ${officer?.jurisdiction || inspection.jurisdiction || 'Assigned Division'}</div>
        </div>
      </div>

      <!-- Product Identification -->
      <div class="section-title">2. Product Identification</div>
      <div class="info-grid">
        <div class="info-box">
          <div class="label">Product / Commodity Name</div>
          <div class="value">${ocrFields.product_name || inspection.product_name || 'Unidentified Commodity'}</div>
        </div>
        <div class="info-box">
          <div class="label">Manufacturer / Packer / Importer</div>
          <div class="value">${ocrFields.manufacturer_name || inspection.manufacturer_name || 'Not Declared'}</div>
        </div>
        <div class="info-box">
          <div class="label">Declared Net Quantity</div>
          <div class="value">${ocrFields.net_quantity || 'Not Declared'}</div>
        </div>
        <div class="info-box">
          <div class="label">Maximum Retail Price (MRP)</div>
          <div class="value">${ocrFields.mrp || 'Not Declared'}</div>
        </div>
      </div>

      <!-- Photographic Evidence -->
      ${evidence.length > 0 ? `
        <div class="section-title">3. Photographic Evidence Captured on Field</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
          ${evidenceThumbs}
        </div>
      ` : ''}

      <!-- Verified Declarations Table -->
      <div class="section-title">4. Mandatory Label Declarations (Rule 6, PC Rules 2011)</div>
      <table class="declarations-table">
        <thead>
          <tr>
            <th style="width:25%;">Statutory Declaration</th>
            <th style="width:35%;">Legal Provision</th>
            <th style="width:40%;">Verified Value on Label</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Product Name</strong></td>
            <td>Rule 6(1)(b) — Generic Name of Commodity</td>
            <td>${ocrFields.product_name ? `<span style="color:#047857;font-weight:600;">${ocrFields.product_name}</span>` : '<span style="color:#dc2626;font-weight:600;">Not Detected (Needs Verification)</span>'}</td>
          </tr>
          <tr>
            <td><strong>Manufacturer/Packer</strong></td>
            <td>Rule 6(1)(a) — Name of Mfg/Packer/Importer</td>
            <td>${ocrFields.manufacturer_name ? `<span style="color:#047857;font-weight:600;">${ocrFields.manufacturer_name}</span>` : '<span style="color:#dc2626;font-weight:600;">Not Detected (Needs Verification)</span>'}</td>
          </tr>
          <tr>
            <td><strong>Complete Address</strong></td>
            <td>Rule 6(1)(a) — Address with Postal PIN Code</td>
            <td>${ocrFields.address ? `<span style="color:#047857;font-weight:600;">${ocrFields.address}</span>` : '<span style="color:#dc2626;font-weight:600;">Not Detected (Needs Verification)</span>'}</td>
          </tr>
          <tr>
            <td><strong>Net Quantity</strong></td>
            <td>Rule 6(1)(c), Rules 12 & 13 — Standard Units</td>
            <td>${ocrFields.net_quantity ? `<span style="color:#047857;font-weight:600;">${ocrFields.net_quantity}</span>` : '<span style="color:#dc2626;font-weight:600;">Not Detected (Needs Verification)</span>'}</td>
          </tr>
          <tr>
            <td><strong>Maximum Retail Price</strong></td>
            <td>Rule 6(1)(e) — MRP incl. of all taxes</td>
            <td>${ocrFields.mrp ? `<span style="color:#047857;font-weight:600;">${ocrFields.mrp}</span>` : '<span style="color:#dc2626;font-weight:600;">Not Detected (Needs Verification)</span>'}</td>
          </tr>
          <tr>
            <td><strong>Date of Mfg/Packing</strong></td>
            <td>Rule 6(1)(d) — Month & Year of Mfg/Pack</td>
            <td>${ocrFields.mfg_date ? `<span style="color:#047857;font-weight:600;">${ocrFields.mfg_date}</span>` : '<span style="color:#dc2626;font-weight:600;">Not Detected (Needs Verification)</span>'}</td>
          </tr>
          <tr>
            <td><strong>Consumer Care</strong></td>
            <td>Rule 6(1)(da) — Name, Tel & Email for complaints</td>
            <td>${ocrFields.consumer_care ? `<span style="color:#047857;font-weight:600;">${ocrFields.consumer_care}</span>` : '<span style="color:#dc2626;font-weight:600;">Not Detected (Needs Verification)</span>'}</td>
          </tr>
          <tr>
            <td><strong>Batch / Lot Number</strong></td>
            <td>Rule 6(1)(g) — Batch or Code Number</td>
            <td>${ocrFields.batch_number ? `<span style="color:#047857;font-weight:600;">${ocrFields.batch_number}</span>` : '<span style="color:#dc2626;font-weight:600;">Not Detected (Needs Verification)</span>'}</td>
          </tr>
        </tbody>
      </table>

      <!-- Compliance Findings Table -->
      <div class="section-title">5. Compliance Assessment Findings & Violations</div>
      <table class="findings-table">
        <thead>
          <tr>
            <th style="width:5%;text-align:center;">#</th>
            <th style="width:28%;">Rule & Code</th>
            <th style="width:12%;">Severity</th>
            <th style="width:18%;">Status</th>
            <th style="width:37%;">Finding & Corrective Action</th>
          </tr>
        </thead>
        <tbody>
          ${findingsRows}
        </tbody>
      </table>

      ${inspection.officer_notes ? `
        <div class="section-title">6. Inspecting Officer's Field Notes</div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12px;color:#334155;line-height:1.5;">
          ${inspection.officer_notes}
        </div>
      ` : ''}

      ${inspection.supervisor_notes ? `
        <div class="section-title">7. Supervisor Review & Regulatory Orders</div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;font-size:12px;color:#1e3a8a;line-height:1.5;">
          ${inspection.supervisor_notes}
        </div>
      ` : ''}

      <!-- Signature & Official Endorsement -->
      <div class="sign-area">
        <div class="sign-box">
          <div class="sign-line"></div>
          <div class="sign-title">${officer?.full_name || 'Inspecting Officer'}</div>
          <div class="sign-sub">Legal Metrology Officer · Badge: ${officer?.badge_number || 'LM'}</div>
          <div class="sign-sub">Date: ${new Date().toLocaleDateString('en-IN')}</div>
        </div>
        <div class="sign-box">
          <div class="sign-line"></div>
          <div class="sign-title">Supervisory Authority</div>
          <div class="sign-sub">Assistant Controller / Controller</div>
          <div class="sign-sub">Department of Legal Metrology</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function downloadReportHTML(data: InspectionReportPayload) {
  const html = generateLegalMetrologyReportHTML(data);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `LegalMetrologyReport_${data.reportNumber}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function printReportHTML(data: InspectionReportPayload) {
  const html = generateLegalMetrologyReportHTML(data);
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow pop-ups to print the inspection report.');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 350);
}
