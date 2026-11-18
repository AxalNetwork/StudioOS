-- D7116: HQ's proposed Wellness program links to the existing personal Wellbeing
-- workspace. The registry entry has no effect on workspace eligibility or licences.
-- Keep any studio-owned or unrelated row occupying the preferred key.
WITH RECURSIVE candidate(n, slug) AS (
  VALUES (0, 'wellness')
  UNION ALL
  SELECT n + 1, CASE WHEN n = 0 THEN 'axal-wellness' ELSE 'axal-wellness-' || (n + 1) END
    FROM candidate WHERE EXISTS (SELECT 1 FROM programs WHERE key = candidate.slug)
)
INSERT INTO programs (key, grp, name, purpose, who, status, position, licence_uid, member_access, modules)
SELECT slug, 'Access', 'Wellness',
       'Build on the private Wellbeing workspace for check-ins, reflection and access to support.',
       'Founders and administrators with access to Wellbeing.', 'proposed',
       (SELECT COALESCE(MAX(position), 0) + 1 FROM programs), NULL, 'not_open', '[]'
  FROM candidate
 WHERE NOT EXISTS (SELECT 1 FROM programs WHERE key = candidate.slug)
   AND NOT EXISTS (SELECT 1 FROM programs WHERE licence_uid IS NULL AND lower(trim(name)) IN ('wellness', 'wellbeing'));

-- Reuse the existing global record where HQ already created one, retaining its
-- name, key, maturity, access, other modules and authored playbook.
UPDATE programs SET modules = json_insert(modules, '$[#]', 'wellbeing')
 WHERE id = (SELECT id FROM programs
              WHERE licence_uid IS NULL AND lower(trim(name)) IN ('wellness', 'wellbeing')
              ORDER BY CASE key WHEN 'wellness' THEN 0 WHEN 'wellbeing' THEN 1 ELSE 2 END, id LIMIT 1)
   AND json_valid(modules) AND json_type(modules) = 'array'
   AND NOT EXISTS (SELECT 1 FROM json_each(modules) WHERE value = 'wellbeing');

-- Supply the usual five unpublished draft sections only for an empty playbook.
WITH sections(section_key, position, title) AS (
  VALUES ('purpose', 1, 'Purpose'), ('who', 2, 'Who it is for'), ('join', 3, 'How people join'),
         ('rewards', 4, 'Rewards'), ('tools', 5, 'Tools')
)
INSERT INTO program_playbook_sections (program_key, version, section_key, position, title, body)
SELECT p.key, 0, s.section_key, s.position, s.title,
       CASE s.section_key WHEN 'purpose' THEN p.purpose WHEN 'who' THEN p.who
                          WHEN 'join' THEN p.join_method WHEN 'tools' THEN 'Open your own Wellbeing workspace from the program overview.' END
  FROM programs p CROSS JOIN sections s
 WHERE p.licence_uid IS NULL AND lower(trim(p.name)) IN ('wellness', 'wellbeing')
   AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(p.modules) THEN p.modules ELSE '[]' END) WHERE value = 'wellbeing')
   AND NOT EXISTS (SELECT 1 FROM program_playbook_sections old WHERE old.program_key = p.key);
