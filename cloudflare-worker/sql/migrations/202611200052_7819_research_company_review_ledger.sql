-- D7819 (#7819): empty review ledger; directory deletion never deletes a review.
CREATE TABLE IF NOT EXISTS research_company_reviews (
 uid TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('admitted','held','excluded','withdrawn')),
 reason_code TEXT NOT NULL CHECK(reason_code IN ('verified','quality_hold','identity_uncertain','source_unavailable','out_of_scope','source_withdrawn')),
 admin_note TEXT CHECK(admin_note IS NULL OR length(admin_note)<=10000),
 proof_url TEXT CHECK(proof_url IS NULL OR proof_url GLOB 'https://?*'),
 reviewer INTEGER NOT NULL,
 reviewed_on TEXT NOT NULL CHECK(datetime(reviewed_on) IS NOT NULL),
 next_action TEXT CHECK(next_action IS NULL OR length(next_action)<=1000),
 next_review_on TEXT CHECK(next_review_on IS NULL OR date(next_review_on) IS NOT NULL),
 withdrawn_on TEXT CHECK(withdrawn_on IS NULL OR datetime(withdrawn_on) IS NOT NULL),
 run_reference TEXT CHECK(run_reference IS NULL OR length(run_reference)<=200),
 PRIMARY KEY(uid)
);
CREATE INDEX IF NOT EXISTS idx_research_company_reviews_status ON research_company_reviews(status,uid);
CREATE INDEX IF NOT EXISTS idx_research_company_reviews_next ON research_company_reviews(next_review_on,uid);
CREATE TABLE IF NOT EXISTS research_company_review_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 uid TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('admitted','held','excluded','withdrawn')),
 reason_code TEXT NOT NULL CHECK(reason_code IN ('verified','quality_hold','identity_uncertain','source_unavailable','out_of_scope','source_withdrawn')),
 admin_note TEXT CHECK(admin_note IS NULL OR length(admin_note)<=10000),
 proof_url TEXT CHECK(proof_url IS NULL OR proof_url GLOB 'https://?*'),
 reviewer INTEGER NOT NULL,
 reviewed_on TEXT NOT NULL CHECK(datetime(reviewed_on) IS NOT NULL),
 next_action TEXT CHECK(next_action IS NULL OR length(next_action)<=1000),
 next_review_on TEXT CHECK(next_review_on IS NULL OR date(next_review_on) IS NOT NULL),
 withdrawn_on TEXT CHECK(withdrawn_on IS NULL OR datetime(withdrawn_on) IS NOT NULL),
 run_reference TEXT CHECK(run_reference IS NULL OR length(run_reference)<=200),
 operation TEXT NOT NULL CHECK(operation IN ('created','updated')),
 recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_company_history_uid ON research_company_review_history(uid,id);
CREATE TRIGGER IF NOT EXISTS research_company_review_history_created AFTER INSERT ON research_company_reviews BEGIN
 INSERT INTO research_company_review_history (uid,status,reason_code,admin_note,proof_url,reviewer,reviewed_on,next_action,next_review_on,withdrawn_on,run_reference,operation) VALUES (NEW.uid,NEW.status,NEW.reason_code,NEW.admin_note,NEW.proof_url,NEW.reviewer,NEW.reviewed_on,NEW.next_action,NEW.next_review_on,NEW.withdrawn_on,NEW.run_reference,'created');
END;
CREATE TRIGGER IF NOT EXISTS research_company_review_history_updated AFTER UPDATE ON research_company_reviews BEGIN
 INSERT INTO research_company_review_history (uid,status,reason_code,admin_note,proof_url,reviewer,reviewed_on,next_action,next_review_on,withdrawn_on,run_reference,operation) VALUES (NEW.uid,NEW.status,NEW.reason_code,NEW.admin_note,NEW.proof_url,NEW.reviewer,NEW.reviewed_on,NEW.next_action,NEW.next_review_on,NEW.withdrawn_on,NEW.run_reference,'updated');
END;
CREATE TABLE IF NOT EXISTS research_company_checks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 uid TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('website','registry_status','source_published')),
 checked_at TEXT NOT NULL CHECK(datetime(checked_at) IS NOT NULL),
 outcome TEXT NOT NULL CHECK(outcome IN ('ok','failed','changed')),
 what_changed TEXT CHECK(what_changed IS NULL OR length(what_changed)<=2000),
 proof_url TEXT NOT NULL CHECK(proof_url GLOB 'https://?*')
);
CREATE INDEX IF NOT EXISTS idx_research_company_checks_uid ON research_company_checks(uid,checked_at,id);
CREATE TRIGGER IF NOT EXISTS research_company_review_history_no_update BEFORE UPDATE ON research_company_review_history BEGIN SELECT RAISE(ABORT,'research_company_review_history: append only'); END;
CREATE TRIGGER IF NOT EXISTS research_company_review_history_no_delete BEFORE DELETE ON research_company_review_history BEGIN SELECT RAISE(ABORT,'research_company_review_history: append only'); END;
CREATE TRIGGER IF NOT EXISTS research_company_checks_no_update BEFORE UPDATE ON research_company_checks BEGIN SELECT RAISE(ABORT,'research_company_checks: append only'); END;
CREATE TRIGGER IF NOT EXISTS research_company_checks_no_delete BEFORE DELETE ON research_company_checks BEGIN SELECT RAISE(ABORT,'research_company_checks: append only'); END;
CREATE TRIGGER IF NOT EXISTS research_company_reviews_no_delete BEFORE DELETE ON research_company_reviews BEGIN SELECT RAISE(ABORT,'research_company_reviews: retain review'); END;
