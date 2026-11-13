-- 496 — the five outside rows lose their seed header block (D758, #1863).
--
-- From #1911 (D758 PR 1) on, five flows send the library row instead of a
-- bundled file: the Trust Center 3-way NDA, the deck-share NDA, and Admin sends
-- of investor_nda_v1, mentor_nda_v1 and mentor_disclaimer_v1. Partner
-- onboarding follows in PR 2. In production on 2026-10-18 (read with SELECT
-- only, true/false answers), each of the five rows below was its migration-085
-- seed body, byte for byte, with 469's legal-name replacement where it applied.
-- Each still opens with 085's header block: the title, the "Subject to legal
-- review" banner, a version line and the parties lines. The paper prints the
-- title, the version and the parties itself, so the owner chose to remove the
-- block (#1863, decision 9, option A, as a migration rather than hand edits).
--
-- ONLY THAT BLOCK, AND ONLY WHERE IT IS EXACT. Each row's statements match the
-- header as 085 wrote it (with 469's name for investor_nda_axal), character for
-- character, as the body's prefix, and keep everything after it unchanged. A
-- row whose body does not begin with exactly that text, because an Admin edited
-- it or a later migration rewrote it, is left alone.
--
-- A NEW VERSION, NEVER AN IN-PLACE EDIT, as in 469:
--   1. the row as it stands is copied into `legal_template_versions`, so a
--      document already signed can still be reproduced from its version;
--   2. `body_md` becomes the text after the header block;
--   3. `version` goes up by 1 and `updated_at` is set.
-- `created_by` on the history row and `updated_by` on the live row are left as
-- they were written: no person made this change.
--
-- RE-RUNNABLE. Once the block is gone the prefix no longer matches, so a second
-- run changes nothing. The history insert is INSERT OR IGNORE on
-- (template_id, version), as the editor's.
--
-- A fresh build from the baseline holds migration 113's clause-only bodies for
-- these slugs, which do not begin with the header, so this is a no-op there.
--
-- No BEGIN/COMMIT.

-- nda_3way_founder_investor_axal
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by
  FROM legal_templates
 WHERE is_active = 1 AND slug = 'nda_3way_founder_investor_axal'
   AND substr(body_md, 1, length('# Three-Way Mutual NDA — Founder · Investor · Axal

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}

**Parties:**

- **Founder:** {{founder_name}} ({{founder_email}})
- **Investor:** {{investor_name}} ({{investor_email}})
- **Intermediary / Counter-signer:** Axal VC Management LLC, a
  Delaware limited liability company ("Axal"), as operator of the
  Axal StudioOS platform (signed by {{axal_signer_email}})

')) = '# Three-Way Mutual NDA — Founder · Investor · Axal

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}

**Parties:**

- **Founder:** {{founder_name}} ({{founder_email}})
- **Investor:** {{investor_name}} ({{investor_email}})
- **Intermediary / Counter-signer:** Axal VC Management LLC, a
  Delaware limited liability company ("Axal"), as operator of the
  Axal StudioOS platform (signed by {{axal_signer_email}})

';

UPDATE legal_templates
   SET body_md = substr(body_md, length('# Three-Way Mutual NDA — Founder · Investor · Axal

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}

**Parties:**

- **Founder:** {{founder_name}} ({{founder_email}})
- **Investor:** {{investor_name}} ({{investor_email}})
- **Intermediary / Counter-signer:** Axal VC Management LLC, a
  Delaware limited liability company ("Axal"), as operator of the
  Axal StudioOS platform (signed by {{axal_signer_email}})

') + 1),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE is_active = 1 AND slug = 'nda_3way_founder_investor_axal'
   AND substr(body_md, 1, length('# Three-Way Mutual NDA — Founder · Investor · Axal

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}

**Parties:**

- **Founder:** {{founder_name}} ({{founder_email}})
- **Investor:** {{investor_name}} ({{investor_email}})
- **Intermediary / Counter-signer:** Axal VC Management LLC, a
  Delaware limited liability company ("Axal"), as operator of the
  Axal StudioOS platform (signed by {{axal_signer_email}})

')) = '# Three-Way Mutual NDA — Founder · Investor · Axal

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}

**Parties:**

- **Founder:** {{founder_name}} ({{founder_email}})
- **Investor:** {{investor_name}} ({{investor_email}})
- **Intermediary / Counter-signer:** Axal VC Management LLC, a
  Delaware limited liability company ("Axal"), as operator of the
  Axal StudioOS platform (signed by {{axal_signer_email}})

';

-- investor_nda_axal
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by
  FROM legal_templates
 WHERE is_active = 1 AND slug = 'investor_nda_axal'
   AND substr(body_md, 1, length('# Investor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Investor:** {{investor_name}} ({{investor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal"), operating the Axal StudioOS platform on behalf of
itself and its affiliates (including, where relevant, Axal VC GP LLC
as general partner of Axal VC Spin-Out Lab Fund I LP)

')) = '# Investor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Investor:** {{investor_name}} ({{investor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal"), operating the Axal StudioOS platform on behalf of
itself and its affiliates (including, where relevant, Axal VC GP LLC
as general partner of Axal VC Spin-Out Lab Fund I LP)

';

UPDATE legal_templates
   SET body_md = substr(body_md, length('# Investor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Investor:** {{investor_name}} ({{investor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal"), operating the Axal StudioOS platform on behalf of
itself and its affiliates (including, where relevant, Axal VC GP LLC
as general partner of Axal VC Spin-Out Lab Fund I LP)

') + 1),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE is_active = 1 AND slug = 'investor_nda_axal'
   AND substr(body_md, 1, length('# Investor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Investor:** {{investor_name}} ({{investor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal"), operating the Axal StudioOS platform on behalf of
itself and its affiliates (including, where relevant, Axal VC GP LLC
as general partner of Axal VC Spin-Out Lab Fund I LP)

')) = '# Investor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Investor:** {{investor_name}} ({{investor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal"), operating the Axal StudioOS platform on behalf of
itself and its affiliates (including, where relevant, Axal VC GP LLC
as general partner of Axal VC Spin-Out Lab Fund I LP)

';

-- mentor_nda_axal
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by
  FROM legal_templates
 WHERE is_active = 1 AND slug = 'mentor_nda_axal'
   AND substr(body_md, 1, length('# Mentor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

')) = '# Mentor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

';

UPDATE legal_templates
   SET body_md = substr(body_md, length('# Mentor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

') + 1),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE is_active = 1 AND slug = 'mentor_nda_axal'
   AND substr(body_md, 1, length('# Mentor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

')) = '# Mentor Mutual NDA — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

';

-- mentor_engagement_disclaimer
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by
  FROM legal_templates
 WHERE is_active = 1 AND slug = 'mentor_engagement_disclaimer'
   AND substr(body_md, 1, length('# Mentor Disclaimer & Acknowledgement

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})

')) = '# Mentor Disclaimer & Acknowledgement

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})

';

UPDATE legal_templates
   SET body_md = substr(body_md, length('# Mentor Disclaimer & Acknowledgement

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})

') + 1),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE is_active = 1 AND slug = 'mentor_engagement_disclaimer'
   AND substr(body_md, 1, length('# Mentor Disclaimer & Acknowledgement

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})

')) = '# Mentor Disclaimer & Acknowledgement

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release.

**Version:** v1
**Effective date:** {{effective_date}}
**Mentor:** {{mentor_name}} ({{mentor_email}})

';

-- partner_services
INSERT OR IGNORE INTO legal_template_versions (template_id, slug, version, title, category, body_md, merge_fields, created_by)
SELECT id, slug, version, title, category, body_md, merge_fields, updated_by
  FROM legal_templates
 WHERE is_active = 1 AND slug = 'partner_services'
   AND substr(body_md, 1, length('# Partner Master Services Agreement — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release. **Note:** Deal-specific terms (fees, scope,
> SLAs) are seeded by the Partner Deal flow (X-1) and override the
> defaults below where they conflict.

**Version:** v1
**Effective date:** {{effective_date}}
**Partner:** {{partner_name}} ({{partner_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

')) = '# Partner Master Services Agreement — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release. **Note:** Deal-specific terms (fees, scope,
> SLAs) are seeded by the Partner Deal flow (X-1) and override the
> defaults below where they conflict.

**Version:** v1
**Effective date:** {{effective_date}}
**Partner:** {{partner_name}} ({{partner_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

';

UPDATE legal_templates
   SET body_md = substr(body_md, length('# Partner Master Services Agreement — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release. **Note:** Deal-specific terms (fees, scope,
> SLAs) are seeded by the Partner Deal flow (X-1) and override the
> defaults below where they conflict.

**Version:** v1
**Effective date:** {{effective_date}}
**Partner:** {{partner_name}} ({{partner_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

') + 1),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE is_active = 1 AND slug = 'partner_services'
   AND substr(body_md, 1, length('# Partner Master Services Agreement — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release. **Note:** Deal-specific terms (fees, scope,
> SLAs) are seeded by the Partner Deal flow (X-1) and override the
> defaults below where they conflict.

**Version:** v1
**Effective date:** {{effective_date}}
**Partner:** {{partner_name}} ({{partner_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

')) = '# Partner Master Services Agreement — Axal StudioOS

> **Subject to legal review.** This template is a working draft. Final
> binding terms must be reviewed and approved by qualified counsel
> before public release. **Note:** Deal-specific terms (fees, scope,
> SLAs) are seeded by the Partner Deal flow (X-1) and override the
> defaults below where they conflict.

**Version:** v1
**Effective date:** {{effective_date}}
**Partner:** {{partner_name}} ({{partner_email}})
**Counterparty:** Axal VC Management LLC, a Delaware limited liability
company ("Axal")

';
