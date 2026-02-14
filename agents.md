# Chargeback Evidence Generator — Agent Guide

## Purpose
Build a zero-budget SaaS that generates bank-ready chargeback evidence packets (PDF + ZIP) from merchant input.

The app must be deployable publicly with no paid services.

---

## Source of Truth Stack

### Frontend
- React + Vite (SPA)
- Deploy to Cloudflare Pages
- Client-side PDF generation using pdf-lib
- Evidence packet ZIP using JSZip

### Backend
- Cloudflare Workers using Hono
- D1 for licensing, telemetry, templates (later)
- No server-side PDF generation

### Abuse Protection
- Cloudflare Turnstile on export actions

---

## Core Architecture Rule

Client-side heavy.

Reason:
- Stay within free-tier CPU limits
- Avoid server costs
- Allow offline/local generation

---

## MVP Features (Must Ship First)

1. Dispute Input Form
   - merchant name
   - order ID
   - amount
   - customer email (optional)
   - dispute reason
   - timeline events
   - tracking info (optional)

2. Evidence PDF (client-side)
   Must include:
   - cover page summary
   - timeline
   - evidence checklist
   - policies section
   - appendix with attachment index

3. Evidence Packet ZIP
   Must include:
   - evidence.pdf
   - summary.txt
   - timeline.csv
   - attachments/README.txt

4. Local Draft Saving
   - use localStorage
   - no backend storage

---

## Non-Goals (MVP)

Do NOT implement:
- Paid APIs
- Server-side PDF generation
- Storing PII in backend
- User accounts/passwords
- Stripe integration
- R2 storage

---

## V2 Features (Later)

- Template library by dispute type
- License enforcement
- D1 template storage
- Team accounts
- Optional encrypted storage

---

## Privacy Rules

- Never store raw PII in D1
- Telemetry must be anonymized
- Do not log request bodies
- Attachments are not uploaded in MVP

---

## Code Rules

- Use TypeScript
- Keep dependencies minimal
- Prefer deterministic outputs
- Simple, readable architecture
- Build vertical slices (form → PDF → ZIP)

---

## Repo Structure

chargeback-evidence/
  apps/
    web/        # Pages frontend
    worker/     # Workers API
  packages/
    shared/     # optional later
  agents.md
  README.md

---

## Execution Strategy

Build in vertical slices:

1. Form → generate PDF locally
2. Add ZIP packet export
3. Add checklist validation
4. Add Turnstile protection
5. Add Worker API + telemetry

---

## Decision Defaults

If uncertain:
- choose simplest solution
- prefer client-side
- avoid adding infrastructure
- avoid paid services