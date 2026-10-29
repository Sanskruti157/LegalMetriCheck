/*
# Food Compliance System Schema

## Overview
Creates the database schema for a food compliance enforcement system used by officers
to scan product photos and record compliance check results.

## New Tables
1. `officer_profiles` - Extends auth.users with enforcement officer details
   - id (uuid, PK, references auth.users)
   - full_name (text) - Officer's full name
   - badge_number (text, unique) - Official badge ID
   - jurisdiction (text) - Area of authority
   - created_at (timestamp)

2. `products` - Food products identified during scans
   - id (uuid, PK)
   - name (text) - Product name
   - barcode (text) - Product barcode if available
   - category (text) - Food category
   - created_at (timestamp)

3. `compliance_checks` - Records of each compliance scan/check
   - id (uuid, PK)
   - officer_id (uuid, references officer_profiles)
   - product_id (uuid, references products)
   - image_url (text) - URL of the scanned product photo
   - status (text) - 'compliant', 'non_compliant', 'warning', 'pending'
   - violations (jsonb) - Array of violation details
   - notes (text) - Officer notes
   - checked_at (timestamp)

## Security
- RLS enabled on all tables
- officer_profiles: authenticated officers can read/update their own profile
- products: authenticated officers can read all and insert
- compliance_checks: authenticated officers can read all checks, insert/update their own
*/

CREATE TABLE IF NOT EXISTS officer_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  badge_number text UNIQUE NOT NULL,
  jurisdiction text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE officer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON officer_profiles;
CREATE POLICY "select_own_profile" ON officer_profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON officer_profiles;
CREATE POLICY "update_own_profile" ON officer_profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON officer_profiles;
CREATE POLICY "insert_own_profile" ON officer_profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  barcode text,
  category text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_products" ON products;
CREATE POLICY "select_products" ON products FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_products" ON products;
CREATE POLICY "insert_products" ON products FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS compliance_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id uuid NOT NULL DEFAULT auth.uid() REFERENCES officer_profiles(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  image_url text,
  status text NOT NULL DEFAULT 'pending',
  violations jsonb DEFAULT '[]'::jsonb,
  notes text,
  checked_at timestamptz DEFAULT now()
);

ALTER TABLE compliance_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_checks" ON compliance_checks;
CREATE POLICY "select_checks" ON compliance_checks FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_check" ON compliance_checks;
CREATE POLICY "insert_own_check" ON compliance_checks FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = officer_id);

DROP POLICY IF EXISTS "update_own_check" ON compliance_checks;
CREATE POLICY "update_own_check" ON compliance_checks FOR UPDATE
  TO authenticated USING (auth.uid() = officer_id) WITH CHECK (auth.uid() = officer_id);

DROP POLICY IF EXISTS "delete_own_check" ON compliance_checks;
CREATE POLICY "delete_own_check" ON compliance_checks FOR DELETE
  TO authenticated USING (auth.uid() = officer_id);

CREATE INDEX IF NOT EXISTS idx_checks_officer ON compliance_checks(officer_id);
CREATE INDEX IF NOT EXISTS idx_checks_status ON compliance_checks(status);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
