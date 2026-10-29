-- Update inspections policies to use the SECURITY DEFINER function instead of subquerying officer_profiles
-- This avoids RLS-on-RLS lookups entirely

DROP POLICY IF EXISTS select_inspections ON public.inspections;
DROP POLICY IF EXISTS update_inspections ON public.inspections;

CREATE POLICY select_inspections ON public.inspections
  FOR SELECT TO authenticated
  USING (
    officer_id = auth.uid()
    OR public.is_supervisor_of(jurisdiction)
  );

CREATE POLICY update_inspections ON public.inspections
  FOR UPDATE TO authenticated
  USING (officer_id = auth.uid())
  WITH CHECK (officer_id = auth.uid());
