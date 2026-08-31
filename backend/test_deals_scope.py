from pathlib import Path


def test_development_deal_scope_matches_room_authorization():
    source = Path("backend/app/api/routes/deals.py").read_text()
    assert 'scope: str = None' in source
    assert 'role == "investor" and scope == "mine"' in source
    assert "SELECT DISTINCT deal_id FROM deal_invitations" in source
    assert "UNION SELECT DISTINCT deal_id FROM commitments" in source


def test_worker_deal_scope_matches_room_authorization():
    source = Path("cloudflare-worker/src/routes/deals.ts").read_text()
    scoped = source[source.index("if (scope === 'mine')"):source.index("if (scope === 'mine')") + 700]
    assert "deal_invitations" in scoped
    assert "commitments" in scoped
    assert "investor_introductions" not in scoped
    assert "watchlist_items" not in scoped