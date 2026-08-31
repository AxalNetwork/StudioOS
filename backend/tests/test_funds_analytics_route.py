from backend.app.api.routes.funds import fund_analytics, router


def test_funds_analytics_is_not_captured_as_a_fund_id():
    paths = [route.path for route in router.routes]
    assert paths.index("/funds/analytics") < paths.index("/funds/{fund_id}")
    payload = fund_analytics(None)
    assert payload["items"] == []
    assert payload["totals"]["fund_count"] == 0
    assert payload["unavailable"]["rvpi"]