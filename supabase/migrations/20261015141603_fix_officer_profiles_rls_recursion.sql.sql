-- Fix infinite recursion in officer_profiles RLS policy
-- The select_own_profile policy queried officer_profiles inside its own policy, causing recursion.
-- Replace with a SECURITY DEFINER function that checks supervisor status without triggering RLS.

CREATE OR REPLACE FUNCTION public.is_supervisor_of(target_jurisdiction text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.officer_profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'supervisor'
      AND (p.assigned_jurisdiction IS NULL OR p.assigned_jurisdiction = target_jurisdiction)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_supervisor_of(text) TO authenticated;

-- Drop the recursive policy and replace with one that uses the function
DROP POLICY IF EXISTS select_own_profile ON public.officer_profiles;

CREATE POLICY select_own_profile ON public.officer_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_supervisor_of(officer_profiles.assigned_jurisdiction));
