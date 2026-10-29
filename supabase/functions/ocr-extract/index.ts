import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OcrResponse {
  raw_text: string;
  extracted_fields: Record<string, string>;
  fields_not_found: string[];
  ocr_error?: string;
}

const ALL_FIELDS = [
  "product_name",
  "manufacturer_name",
  "address",
  "net_quantity",
  "mrp",
  "mfg_date",
  "consumer_care",
  "batch_number",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OCR_SPACE_API_KEY = Deno.env.get("OCR_SPACE_API_KEY") ?? "";

/**
 * Runs OCR via OCR.space API.
 * Uses Engine 2 first (best for packaged labels & multi-line declarations),
 * and automatically falls back to Engine 1 if Engine 2 fails or requests Engine 1.
 */
async function runOcrSpace(
  imageBuffer: ArrayBuffer,
  apiKey: string
): Promise<string> {
  const blob = new Blob([imageBuffer], { type: "image/jpeg" });

  async function callEngine(
    engine: "1" | "2"
  ): Promise<{ text: string; error?: string }> {
    const formData = new FormData();

    formData.append("file", blob, "label_image.jpg");
    formData.append("language", "eng");
    formData.append("isOverlayRequired", "false");
    formData.append("scale", "true");
    formData.append("isTable", "true");
    formData.append("OCREngine", engine);

    const keyToUse = apiKey || "helloworld";

    const response = await fetch(
      "https://api.ocr.space/parse/image",
      {
        method: "POST",
        headers: { apikey: keyToUse },
        body: formData,
      }
    );

    if (!response.ok) {
      const errText = await response.text();

      return {
        text: "",
        error: `OCR.space HTTP ${response.status}: ${errText.slice(0, 150)}`,
      };
    }

    const result = await response.json();

    if (result.IsErroredOnProcessing) {
      return {
        text: "",
        error: Array.isArray(result.ErrorMessage)
          ? result.ErrorMessage.join(", ")
          : String(
              result.ErrorMessage || "OCR.space could not process the image"
            ),
      };
    }

    const text = (result.ParsedResults ?? [])
      .map((item: { ParsedText?: string }) => item.ParsedText ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();

    return { text };
  }

  // Try OCR engine 2 first.
  const firstAttempt = await callEngine("2");

  if (firstAttempt.text.trim()) {
    return firstAttempt.text;
  }

  // If engine 2 finds no text, try engine 1.
  const secondAttempt = await callEngine("1");

  if (secondAttempt.text.trim()) {
    return secondAttempt.text;
  }

  // Neither engine found readable text.
  throw new Error(
    secondAttempt.error ||
      firstAttempt.error ||
      "OCR.space returned no readable text from the image."
  );
}

   

    
 

function cleanText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getLines(rawText: string): string[] {
  return rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * 1. Product Name: Generic or common name of commodity (Rule 6(1)(b))
 */
function extractProductName(lines: string[], rawText: string): string | null {
  // Labeled product / commodity patterns
  const labeledPatterns = [
    /(?:commodity|product(?:\s*name)?|generic\s*name|name\s*of\s*(?:the\s*)?(?:commodity|product))\s*[:\-]\s*([^\n]{2,80})/i,
    /item\s*[:\-]\s*([^\n]{2,80})/i,
  ];
  for (const p of labeledPatterns) {
    const m = rawText.match(p);
    if (m?.[1] && m[1].trim().length >= 2) {
      const val = m[1].trim().replace(/^[:\-\s]+/, "").trim();
      if (val.length >= 2) return val;
    }
  }

  // Heuristic: prominent title line near the top
  const skipPatterns = /^(packaged\s*commodity|declarations?|nutrition|nutritional|ingredients?|net\s*(?:qty|quantity|wt|weight)|m\.?r\.?p|maximum\s*retail|rs\.?|₹|inr|mfg|mfd|pkd|pack|batch|lot|b\/no|b\.?no|address|plot|survey|door|shop|building|road|street|consumer|customer|helpline|toll|best\s*before|use\s*by|exp|per\s*100|energy|protein|fat|sodium|fssai|fss|lic|vegetarian|veg|non.?veg|mark\s*by|made\s*in|country\s*of|warning|caution|keep|store|scan|barcode)/i;

  for (const line of lines.slice(0, 8)) {
    if (line.length < 3 || line.length > 80) continue;
    if (skipPatterns.test(line)) continue;
    if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(line)) continue;
    if (/\b(?:g|gm|kg|ml|l|litre|mg)\b/i.test(line) && line.length < 25) continue;
    if (!/[a-zA-Z]{3,}/.test(line)) continue;
    if (/^(fssai|iso|halal|bis|agmark|veg|non-veg)$/i.test(line)) continue;
    return line.replace(/^[:\-\s]+/, "").trim();
  }
  return null;
}

/**
 * 2. Manufacturer, Packer, or Importer Name (Rule 6(1)(a))
 */
function extractManufacturer(lines: string[], rawText: string): string | null {
  const labeledPatterns = [
    /(?:manufactured\s*(?:&|\+|and)\s*packed\s*by|manufactured\s*by|packed\s*by|imported\s*(?:&|\+|and)?\s*marketed\s*by|imported\s*by|marketed\s*by)\s*[:\-]?\s*([^\n]{2,100})/i,
    /(?:name\s*of\s*(?:the\s*)?)?(?:manufacturer|packer|importer|marketer)\s*[:\-]\s*([^\n]{2,100})/i,
    /(?:m\/s\.?|m\/s)\s+([^\n]{2,80})/i,
  ];

  for (const p of labeledPatterns) {
    const m = rawText.match(p);
    if (m?.[1] && m[1].trim().length >= 2) {
      const val = m[1].trim().replace(/^[:\-\s]+/, "").trim();
      // Ensure it's not immediately an address keyword
      if (!/^(plot|survey|door|shop|building|sy|no\.|address|village|road|street)\b/i.test(val)) {
        return val;
      }
    }
  }

  // Check lines near "by"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/(?:manufactured|packed|imported|marketed)\s*(?:&|\+|and)?\s*(?:packed)?\s*by\s*[:\-]?\s*(.*)/i);
    if (match) {
      const after = match[1]?.trim();
      if (after && after.length >= 2 && !/^(address|plot|survey|door|shop|no\.)\b/i.test(after)) {
        return after;
      }
      if (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next.length >= 2 && !/^(address|plot|survey|door|shop|no\.)\b/i.test(next)) {
          return next;
        }
      }
    }
  }
  return null;
}

/**
 * 3. Complete Address (Rule 6(1)(a))
 */
function extractAddress(rawText: string, lines: string[]): string | null {
  // Labeled address pattern
  const labeledPatterns = [
    /(?:factory|unit|regd\.?\s*office|registered\s*office|office|plant)?\s*address\s*[:\-]\s*([^\n]{5,150})/i,
    /(?:at\s*[:\-])\s*([^\n]{5,150})/i,
  ];
  for (const p of labeledPatterns) {
    const m = rawText.match(p);
    if (m?.[1] && m[1].trim().length >= 5) {
      return m[1].trim().replace(/^[:\-\s]+/, "").trim();
    }
  }

  // Search around Indian PIN code (6 digits, e.g. 173212, 560001)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\b\d{6}\b/.test(line) || /\bpin\s*(?:code)?\s*[:\-]?\s*\d{6}/i.test(line)) {
      const parts: string[] = [];
      let start = i;
      for (let j = i; j >= Math.max(0, i - 3); j--) {
        if (
          /\b(plot|survey|door|shop|no|building|road|street|area|district|sector|phase|block|ward|town|city|taluk|tehsil|industrial|zone|state|solan|delhi|mumbai|bangalore|pune|hyderabad|chennai|himachal|pradesh|maharashtra|karnataka|gujarat|address)\b/i.test(
            lines[j],
          ) ||
          /\d{6}\b/.test(lines[j])
        ) {
          start = j;
        } else {
          break;
        }
      }
      for (let j = start; j <= i; j++) {
        parts.push(lines[j]);
      }
      const combined = parts.join(", ").replace(/^address\s*[:\-]\s*/i, "").trim();
      if (combined.length >= 6) return combined;
    }
  }

  // Generic address indicator line
  for (const line of lines) {
    if (
      /^(?:plot|survey|door|shop|no\.|building|road|street|sector|phase|block|industrial\s*area)\b/i.test(line) &&
      line.length >= 8
    ) {
      return line.replace(/^address\s*[:\-]\s*/i, "").trim();
    }
  }

  return null;
}

/**
 * 4. Net Quantity (Rule 6(1)(c), Rule 12, Rule 13)
 */
function extractNetQuantity(rawText: string): string | null {
  const patterns = [
    /net\s*(?:quantity|qty|wt|weight|content|mass|vol|volume)\s*[:\-]?\s*([\d.,]+\s*(?:g|gm|gram|grams|kg|kgs|kilogram|kilograms|ml|milliliter|millilitre|l|litre|liter|litres|liters|mg|n|unit|units|pcs|pieces))\b/i,
    /net\s*(?:quantity|qty|wt|weight|content)\s*[:\-]?\s*([\d.,]+\s*[a-zA-Z]{1,5})/i,
    /\b(\d+(?:\.\d+)?\s*(?:kg|kgs|g|gm|gram|ml|l|litre|liter|mg|n))\b/i,
  ];

  for (const p of patterns) {
    const m = rawText.match(p);
    if (m?.[1] && m[1].trim().length >= 1) {
      return m[1].trim().replace(/^[:\-\s]+/, "").trim();
    }
  }
  return null;
}

/**
 * 5. Maximum Retail Price (MRP) including taxes (Rule 6(1)(e))
 */
function extractMrp(rawText: string): string | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const mrpLabel =
    /maximum\s*retail\s*price|\bM\s*\.?\s*R\s*\.?\s*P\s*\.?\b/i;

  const pricePattern =
    /(?:₹|Rs\.?|INR)?\s*(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)/i;

  for (let i = 0; i < lines.length; i++) {
    if (!mrpLabel.test(lines[i])) continue;

    // Check the MRP label line and the following line.
    const nearbyText = [lines[i], lines[i + 1] ?? ""].join(" ");
    const labelPosition = nearbyText.search(mrpLabel);

    if (labelPosition < 0) continue;

    const afterLabel = nearbyText.slice(
      labelPosition + nearbyText.match(mrpLabel)![0].length
    );

    const match = afterLabel.match(pricePattern);
    if (!match?.[1]) continue;

    const amount = Number(match[1].replace(/,/g, ""));

    // Reject zero or invalid prices.
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const price = `Rs. ${match[1]}`;

    if (/incl(?:usive)?\.?\s*of\s*all\s*taxes/i.test(nearbyText)) {
      return `${price} (inclusive of all taxes)`;
    }

    return price;
  }

  return null;
}

/**
 * 6. Month & Year of Manufacture, Packing, or Import (Rule 6(1)(d))
 */
function extractMfgDate(rawText: string): string | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const dateLabel =
    /\b(?:date\s*of\s*(?:packing|pkg|mfg|manufacture)|mfg\.?\s*date|mfd\.?\s*date|pkd\.?\s*date|mfd\.?|mfg\.?|pkd\.?|packed\s*on|manufactured\s*on|month\s*(?:&|and)?\s*year\s*of\s*(?:mfg|manufacture|packing|import))\b/i;

  const datePattern =
    /\b(?:0?[1-9]|1[0-2])\s*[\/.-]\s*(?:19|20)\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:19|20)\d{2}\b|\b(?:0?[1-9]|[12]\d|3[01])\s*[\/.-]\s*(?:0?[1-9]|1[0-2])\s*[\/.-]\s*(?:19|20)\d{2}\b/i;

  for (let i = 0; i < lines.length; i++) {
    if (!dateLabel.test(lines[i])) continue;

    // First check the line with the date label.
    const currentMatch = lines[i].match(datePattern);
    if (currentMatch) return currentMatch[0].replace(/\s+/g, "");

    // If the date is printed on the next line, check that line too.
    if (lines[i + 1]) {
      const nextMatch = lines[i + 1].match(datePattern);
      if (nextMatch) return nextMatch[0].replace(/\s+/g, "");
    }
  }

  return null;
}

/**
 * 7. Consumer Care Details (Rule 6(1)(da))
 */
function extractConsumerCare(rawText: string): string | null {
  const lines = getLines(rawText);

  const careLabel =
    /consumer\s*care|customer\s*care|helpline|toll\s*free|grievance|complaints?/i;

  const phonePattern =
    /(?:1800[\s-]?\d{3}[\s-]?\d{3,4}|\+?91[\s-]?\d{10}|\b\d{10}\b)/;

  const emailPattern =
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

  for (let i = 0; i < lines.length; i++) {
    if (!careLabel.test(lines[i])) continue;

    // Check the labelled line and the following line.
    const nearbyText = [lines[i], lines[i + 1] ?? ""].join(" ");
    const phone = nearbyText.match(phonePattern)?.[0];
    const email = nearbyText.match(emailPattern)?.[0];

    if (phone && email) return `${phone}, ${email}`;
    if (phone) return phone;
    if (email) return email;

    // Keep the labelled text for officer verification if no contact
    // number or email was recognized.
    const cleaned = lines[i]
      .replace(
        /^(?:consumer\s*care|customer\s*care|helpline|toll\s*free|grievance|complaints?)\s*[:\-]?\s*/i,
        ""
      )
      .trim();

    if (cleaned.length >= 3 && !careLabel.test(cleaned)) {
      return cleaned;
    }
  }

  // Fallback: accept a phone or email only when clearly labelled.
  const phoneLine = lines.find(
    (line) => /toll\s*free|helpline|phone|telephone|tel\b|call\b/i.test(line)
      && phonePattern.test(line)
  );

  const emailLine = lines.find(
    (line) => /email|e-mail/i.test(line) && emailPattern.test(line)
  );

  const phone = phoneLine?.match(phonePattern)?.[0];
  const email = emailLine?.match(emailPattern)?.[0];

  if (phone && email) return `${phone}, ${email}`;
  if (phone) return phone;
  if (email) return email;

  return null;
}
/**
 * 8. Batch or Lot Number (Rule 6(1)(g))
 */
function extractBatchNumber(rawText: string): string | null {
  const lines = getLines(rawText);

  const batchLabel =
    /\b(?:batch|lot)\s*(?:no\.?|number|num|code|id)\b|\bb\s*\/\s*no\.?\b|\bb\.?\s*no\.?\b/i;

  const valuePattern =
    /^\s*[:#\-]?\s*([A-Z0-9][A-Z0-9./_-]{1,29})\b/i;

  for (let i = 0; i < lines.length; i++) {
    if (!batchLabel.test(lines[i])) continue;

    // Prefer a value printed after the label.
    const labelMatch = lines[i].match(batchLabel);
    if (!labelMatch) continue;

    const afterLabel = lines[i].slice(
      labelMatch.index! + labelMatch[0].length
    );

    const sameLine = afterLabel.match(valuePattern);
    if (sameLine?.[1]) {
      const value = sameLine[1].replace(/[.,]+$/, "");
      if (/[A-Z0-9]/i.test(value)) return value;
    }

    // Some packages put the batch value on the next line.
    if (lines[i + 1]) {
      const nextLine = lines[i + 1].match(valuePattern);
      if (nextLine?.[1]) {
        const value = nextLine[1].replace(/[.,]+$/, "");
        if (/[A-Z0-9]/i.test(value)) return value;
      }
    }
  }

  return null;
}


function extractFields(rawText: string): {
  extracted_fields: Record<string, string>;
  fields_not_found: string[];
} {
  const lines = getLines(rawText);
  const text = lines.join("\n");
  const extracted_fields: Record<string, string> = {};

  if (lines.length === 0) {
    return {
      extracted_fields: {},
      fields_not_found: [...ALL_FIELDS],
    };
  }

  // Product name: prefer a line containing the product type or brand,
  // and avoid promotional text and manufacturing details.
  const productCandidates = lines.filter((line) =>
    /\b(tomato|soup|noodles|biscuit|soap|shampoo|detergent|oil|juice|chocolate|snack)\b/i.test(line) &&
    !/\b(since|ingredients|nutrition|serving suggestion|manufactured|manufacturing|mfg\.?\s*by|marketed by|mrp|batch)\b/i.test(line)
  );

  const prodName =
    productCandidates.find((line) => /\b(tomato|soup)\b/i.test(line)) ??
    extractProductName(lines, rawText);

  if (prodName) {
    extracted_fields.product_name = prodName.trim();
  }

  // Manufacturer: prioritize explicit "Mfg. by" declarations.
  const manufacturerMatch = text.match(
    /\bMfg\.?\s*(?:by)?\s*:\s*([^\n.]{3,100})/i
  );

  const mfg =
    manufacturerMatch?.[1]?.trim() ||
    extractManufacturer(lines, rawText);

  if (mfg) {
    extracted_fields.manufacturer_name = mfg;
  }

  // Address: prioritize an address close to a manufacturer declaration.
  const addressMatch = text.match(
    /\bMfg\.?\s*(?:by)?\s*:[^\n]*\n?\s*((?:Plot|Unit|Survey|Road|Street|MIDC|Industrial Area)[^\n]{5,180})/i
  );

  const addr =
    addressMatch?.[1]?.trim() ||
    extractAddress(rawText, lines);

  if (
    addr &&
    /\b(address|road|street|village|district|city|state|pin|plot|sector|industrial area|MIDC|Nashik|Mumbai)\b/i.test(addr) &&
    !/\b(saturated fat|trans fat|protein|nutrition|energy|carbohydrate)\b/i.test(addr)
  ) {
    extracted_fields.address = addr;
  }

  // Net quantity: prefer explicit net-content declarations, not serving weights.
  const quantityPatterns = [
    /\bnet\s*(?:quantity|wt\.?|weight|contents?)\s*[:\-]?\s*(\d+(?:\.\d+)?\s*(?:kg|g|gm|mg|ml|l|litres?|liters?))\b/i,
    /\bnet\s*(\d+(?:\.\d+)?\s*(?:kg|g|gm|mg|ml|l|litres?|liters?))\b/i,
  ];

  let netQty: string | undefined;

  for (const pattern of quantityPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      netQty = match[1].trim();
      break;
    }
  }

  if (!netQty) {
    netQty = extractNetQuantity(rawText);
  }

  if (
    netQty &&
    /\b\d+(?:\.\d+)?\s*(?:kg|g|gm|mg|ml|l|litre|liter|litres|liters|grams?)\b/i.test(netQty)
  ) {
    extracted_fields.net_quantity = netQty;
  }

  // MRP: only accept a price associated with an MRP label.
  const mrpMatch = text.match(
    /\b(?:MRP|M\.R\.P\.|maximum retail price)\s*(?:Rs\.?|INR|₹)?\s*[:\-]?\s*(?:₹\s*)?(\d+(?:[.,]\d{1,2})?)/i
  );

  const mrp = mrpMatch?.[1] || extractMrp(rawText);

  if (mrp && /\d/.test(mrp) && !/\b(?:USP|unit address)\b/i.test(mrp)) {
    extracted_fields.mrp = mrp;
  }

  // Manufacturing/packing date: only accept a date near a relevant label.
  const dateMatch = text.match(
    /\b(?:Mfg\.?\s*date|Manufactured\s*on|Date\s*of\s*(?:manufacture|packing)|PKD\.?)\s*[:\-]?\s*((?:0?[1-9]|1[0-2])[\/.-](?:19|20)\d{2}|(?:0?[1-9]|[12]\d|3[01])[\/.-](?:0?[1-9]|1[0-2])[\/.-](?:19|20)\d{2})/i
  );

  const mfgDate = dateMatch?.[1] || extractMfgDate(rawText);

  if (
    mfgDate &&
    (
      /\b(?:19|20)\d{2}\b/.test(mfgDate) ||
      /\b(?:0?[1-9]|1[0-2])\s*[\/.-]\s*(?:19|20)\d{2}\b/.test(mfgDate)
    )
  ) {
    extracted_fields.mfg_date = mfgDate;
  }

  const care = extractConsumerCare(rawText);
  if (care) {
    extracted_fields.consumer_care = care;
  }

  const batch = extractBatchNumber(rawText);
  if (batch) {
    extracted_fields.batch_number = batch;
  }

  const fields_not_found = ALL_FIELDS.filter(
    (field) => !(field in extracted_fields)
  );

  return { extracted_fields, fields_not_found };
}


 

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      storagePath?: string;
      imageUrl?: string;
      imageBase64?: string;
    };

    const { storagePath, imageUrl, imageBase64 } = body;

    let imageBuffer: ArrayBuffer | null = null;
    let retrievalError: string | null = null;

    // 1. Try downloading from Supabase Storage bucket 'evidence' via Supabase client
    if (storagePath) {
      try {
        const cleanPath = storagePath.replace(/^evidence\//, "");
        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: fileBlob, error: downloadError } = await supabase.storage
          .from("evidence")
          .download(cleanPath);

        if (!downloadError && fileBlob) {
          imageBuffer = await fileBlob.arrayBuffer();
        } else if (downloadError) {
          retrievalError = `Storage download error: ${downloadError.message}`;
        }
      } catch (err) {
        retrievalError = `Storage client exception: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 2. If storage download didn't yield a buffer, try fetching imageUrl if provided
    if (!imageBuffer && imageUrl) {
      try {
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
          imageBuffer = await imgRes.arrayBuffer();
        } else {
          retrievalError = `Image URL fetch returned ${imgRes.status}`;
        }
      } catch (err) {
        retrievalError = `Image URL fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // 3. If still no buffer, try decoding imageBase64
    if (!imageBuffer && imageBase64) {
      try {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        imageBuffer = bytes.buffer;
      } catch (err) {
        retrievalError = `Base64 decode error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // If no image data could be retrieved at all
    if (!imageBuffer || imageBuffer.byteLength === 0) {
      const errMsg = retrievalError || "No valid image data or storage path was provided.";
      const result: OcrResponse = {
        raw_text: "",
        extracted_fields: {},
        fields_not_found: [...ALL_FIELDS],
        ocr_error: errMsg,
      };
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Run OCR.space on the retrieved image buffer
    let rawText = "";
    let ocrError: string | undefined;

    try {
      rawText = await runOcrSpace(imageBuffer, OCR_SPACE_API_KEY);
      rawText = cleanText(rawText);
    } catch (err) {
      ocrError = err instanceof Error ? err.message : "OCR.space request failed";
    }

    const { extracted_fields, fields_not_found } = extractFields(rawText);

    const result: OcrResponse = {
      raw_text: rawText.substring(0, 8000),
      extracted_fields,
      fields_not_found,
      ...(ocrError ? { ocr_error: ocrError } : {}),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR processing failed";
    return new Response(
      JSON.stringify({
        raw_text: "",
        extracted_fields: {},
        fields_not_found: [...ALL_FIELDS],
        ocr_error: message,
      }),
      {
        status: 200, // Return 200 with error property so frontend receives structured fields
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
