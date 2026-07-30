from . import test_network_introductions as T
def test_discover_endpoints():
    viewer = T._mk_user(role=T.UserRole.FOUNDER, email="viewer@axal.vc", name="Vera Viewer")
    T._mk_user(role=T.UserRole.INVESTOR, email="u2@axal.vc", name="Ivan Investor")
    T._mk_user(role=T.UserRole.FOUNDER, email="u3@axal.vc", name="Fiona Founder")
    T._mk_user(role=T.UserRole.FOUNDER, email="u4@axal.vc", name="Frank Founder")
    T._mk_investor(display_name="Olga OffPlatform", company="Meridian", accreditation_status="verified")
    prev_user = T._current.get("user")
    T._as(viewer)
    try:
        body = T.client.get("/api/network-introductions/candidates").json()
        cands = body["candidates"]; assert len(cands) >= 4, len(cands)
        c0 = cands[0]
        assert all(k in c0 for k in ("name","match_score","trust_score","fit","values","skills","archetype","why","on_platform"))
        assert "@axal.vc" not in str(body)
        axes = c0["fit"]["axes"]; assert len(axes)==6 and axes[5]["key"]=="ambition"
        assert c0["fit"]["overall"]==round(sum(a["score"] for a in axes[:5])/5)
        scores=[c["match_score"] for c in cands]; assert scores==sorted(scores, reverse=True)
        assert [c["key"] for c in T.client.get("/api/network-introductions/candidates").json()["candidates"]]==[c["key"] for c in cands]
        cr=T.client.get("/api/network-introductions/connect-credits").json(); assert cr["balance"]==cr["total"] and cr["used"]==0
        onp=next(c for c in cands if c["on_platform"])
        assert T.client.post("/api/network-introductions", json={"recipient_user_id": onp["user_id"]}).status_code==200
        cr2=T.client.get("/api/network-introductions/connect-credits").json(); assert cr2["used"]==1 and cr2["balance"]==cr2["total"]-1
        assert onp["key"] not in [c["key"] for c in T.client.get("/api/network-introductions/candidates").json()["candidates"]]
        hi=T.client.get("/api/network-introductions/candidates?min_trust=95").json()["candidates"]; assert all(c["trust_score"]>=95 for c in hi)
    finally:
        T._as(prev_user)
