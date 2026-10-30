# LegalMetriCheck

## Overview
LegalMetriCheck is a prototype software system designed to help enforcement officials check the compliance of packaged commodities with the Legal Metrology (Packaged Commodities) Rules, 2011, in India.

## Problem Statement
Manual inspection of packaged commodities is time-consuming and resource-intensive. Missing or incorrect declarations, including Maximum Retail Price (MRP), net quantity, manufacturer details, and manufacturing or packing dates, can make compliance verification difficult.

## Objectives
- Automate the extraction of product label information using Optical Character Recognition (OCR).
- Assist enforcement officials in identifying potentially missing or incorrect declarations.
- Maintain inspection records and photographic evidence.
- Generate compliance findings and inspection reports.
- Provide a dashboard for supervisors to review inspection activities.

## Key Features
- Officer login and inspection workflow.
- Product label image upload.
- OCR-based declaration extraction using OCR.space.
- OCR review and manual correction of extracted fields.
- Compliance findings linked to inspections.
- Supervisor dashboard and inspection report generation.

## Technology Stack
- Frontend: React, TypeScript, Vite
- Backend services and database: Supabase
- Authentication and storage: Supabase Auth and Storage
- OCR: OCR.space API through a Supabase Edge Function
- Version control: Git and GitHub

## Project Status
Prototype under development. OCR accuracy, compliance validation, and inspection workflows are being improved and tested.

## Future Scope
- Improve OCR accuracy for different product labels and packaging formats.
- Expand automated checks against applicable legal requirements.
- Enable vendors to submit product and expiry-date information.
- Provide alerts for products approaching or reaching their expiry dates.
- Improve analytics and reporting for enforcement authorities.

## Disclaimer
This project is a prototype intended to assist compliance inspections. Its findings should be verified by an authorized official against the applicable legal requirements. It does not replace official legal or regulatory decisions.
