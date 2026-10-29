-- Simplify policies on compliance_findings, evidence_images, and ocr_results
-- Replace nested officer_profiles subqueries with the is_supervisor_of function

-- compliance_findings
DROP POLICY IF EXISTS select_findings ON public.compliance_findings;
DROP POLICY IF EXISTS update_findings ON public.compliance_findings;

CREATE POLICY select_findings ON public.compliance_findings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections i
      WHERE i.id = compliance_findings.inspection_id
        AND (i.officer_id = auth.uid() OR public.is_supervisor_of(i.jurisdiction))
    )
  );

CREATE POLICY update_findings ON public.compliance_findings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections i
      WHERE i.id = compliance_findings.inspection_id
        AND (i.officer_id = auth.uid() OR public.is_supervisor_of(i.jurisdiction))
    )
  );

-- evidence_images
DROP POLICY IF EXISTS select_evidence ON public.evidence_images;

CREATE POLICY select_evidence ON public.evidence_images
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections i
      WHERE i.id = evidence_images.inspection_id
        AND (i.officer_id = auth.uid() OR public.is_supervisor_of(i.jurisdiction))
    )
  );

-- ocr_results
DROP POLICY IF EXISTS select_ocr ON public.ocr_results;

CREATE POLICY select_ocr ON public.ocr_results
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections i
      WHERE i.id = ocr_results.inspection_id
        AND (i.officer_id = auth.uid() OR public.is_supervisor_of(i.jurisdiction))
    )
  );
