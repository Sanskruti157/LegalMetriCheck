import type { Violation, ComplianceStatus } from '@/lib/supabase';

export interface AnalysisResult {
  status: ComplianceStatus;
  violations: Violation[];
  detectedProduct: {
    name: string;
    barcode: string;
    category: string;
  };
  confidence: number;
}

const violationTemplates: Violation[] = [
  {
    type: 'Missing Allergen Declaration',
    severity: 'critical',
    description: 'Product contains traces of nuts but allergen warning is not visible on the packaging label.',
  },
  {
    type: 'Expired Date',
    severity: 'critical',
    description: 'The expiration date on the product has passed. Product should be immediately removed from shelves.',
  },
  {
    type: 'Missing Nutrition Information',
    severity: 'major',
    description: 'Nutritional information panel is not present on the packaging as required by regulation.',
  },
  {
    type: 'Non-compliant Health Claim',
    severity: 'major',
    description: 'The product makes unsubstantiated health claims not approved by food safety authorities.',
  },
  {
    type: 'Incorrect Labeling Language',
    severity: 'minor',
    description: 'Label is not in the local language as required by regional food labeling standards.',
  },
  {
    type: 'Missing FSSAI License Number',
    severity: 'critical',
    description: 'FSSAI license number is not displayed on the packaging as mandated by food safety regulations.',
  },
  {
    type: 'Improper Storage Instructions',
    severity: 'minor',
    description: 'Storage instructions are missing or unclear for products requiring refrigeration.',
  },
];

export function analyzeProductImage(_imageData: string): Promise<AnalysisResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const seed = Math.random();
      let status: ComplianceStatus;
      let violations: Violation[] = [];
      let confidence: number;

      if (seed < 0.3) {
        status = 'compliant';
        violations = [];
        confidence = 0.92 + Math.random() * 0.06;
      } else if (seed < 0.55) {
        status = 'warning';
        violations = violationTemplates.filter((v) => v.severity === 'minor').slice(0, 1 + Math.floor(Math.random() * 2));
        confidence = 0.78 + Math.random() * 0.1;
      } else {
        status = 'non_compliant';
        const criticalAndMajor = violationTemplates.filter((v) => v.severity !== 'minor');
        const count = 1 + Math.floor(Math.random() * 3);
        violations = criticalAndMajor.slice(0, count);
        confidence = 0.85 + Math.random() * 0.1;
      }

      const productNames = [
        'Organic Fruit Juice 1L',
        'Packaged Snack Mix 200g',
        'Dairy-Free Yogurt 150g',
        'Energy Bar 40g',
        'Bottled Water 500ml',
        'Canned Soup 400g',
        'Instant Noodles 85g',
        'Breakfast Cereal 500g',
      ];
      const categories = ['Beverages', 'Snacks', 'Dairy', 'Confectionery', 'Staples'];
      const product = productNames[Math.floor(Math.random() * productNames.length)];
      const category = categories[Math.floor(Math.random() * categories.length)];
      const barcode = '890' + Math.floor(10000000000 + Math.random() * 89999999999).toString();

      resolve({
        status,
        violations,
        detectedProduct: { name: product, barcode, category },
        confidence,
      });
    }, 2200);
  });
}
