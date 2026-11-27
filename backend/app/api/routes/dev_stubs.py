"""
Dev-only stub routes for Worker-only surfaces that the FastAPI dev backend
doesn't implement. All endpoints return valid empty shapes so the frontend
renders gracefully instead of flooding the console with 404s.

These routes are NEVER deployed — only reachable in local dev via the Vite
proxy (port 5000 → 8000).  They are all read-only and require no auth so
the landing page and public event/article pages render without errors.
"""
from fastapi import APIRouter, Path

router = APIRouter(tags=["dev-stubs"])


# ---------------------------------------------------------------------------
# Google OAuth  (/api/auth/google/*)
# The real OAuth flow requires the Worker + Google Cloud config.  In dev,
# return a plain error so the login page shows a readable message instead
# of a cryptic 404.
# ---------------------------------------------------------------------------

@router.get("/auth/google/start")
def google_start(action: str = "signin", redirect: str = "/studio"):
    from fastapi import HTTPException
    raise HTTPException(
        status_code=501,
        detail="Google sign-in requires the Cloudflare Worker. Use the 'Sign in as demo …' buttons below for local dev.",
    )


@router.get("/auth/google/callback")
def google_callback():
    from fastapi import HTTPException
    raise HTTPException(status_code=501, detail="dev_stub: Google OAuth callback is Worker-only")


# ---------------------------------------------------------------------------
# Articles  (/api/articles/*)
# ---------------------------------------------------------------------------

@router.get("/articles")
def list_articles(limit: int = 12, offset: int = 0, role: str = "", sector: str = ""):
    return {"items": [], "total": 0, "dev_stub": True}


@router.get("/articles/sectors")
def article_sectors():
    return []


@router.get("/articles/trust/me")
def article_trust_me():
    return {"trusted": False, "dev_stub": True}


@router.get("/articles/mine")
def my_articles():
    return {"items": [], "total": 0, "dev_stub": True}


@router.get("/articles/by-author/{user_id}")
def articles_by_author(user_id: str):
    return {"items": [], "total": 0, "dev_stub": True}


@router.get("/articles/draft/{article_id}")
def get_draft(article_id: str):
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="dev_stub: no articles in dev")


@router.post("/articles/draft")
def create_draft():
    from fastapi import HTTPException
    raise HTTPException(status_code=501, detail="dev_stub: article authoring requires the Worker")


@router.get("/articles/{slug}")
def read_article(slug: str = Path(...)):
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="dev_stub: no articles in dev")


@router.get("/admin/articles/queue")
def admin_article_queue():
    return {"items": [], "total": 0, "dev_stub": True}


@router.get("/admin/articles/{article_id}")
def admin_article_detail(article_id: str):
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="dev_stub: no articles in dev")


# ---------------------------------------------------------------------------
# Public events  (/api/public/events/*)
# ---------------------------------------------------------------------------

@router.get("/public/events")
def list_public_events(limit: int = 10, offset: int = 0):
    return []


@router.get("/public/events.ics")
def public_events_ics():
    from fastapi.responses import Response
    cal = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Axal VC dev stub//EN\r\nEND:VCALENDAR\r\n"
    return Response(content=cal, media_type="text/calendar")


@router.get("/public/events/{slug}")
def read_public_event(slug: str):
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="dev_stub: no events in dev")


@router.get("/public/events/{slug}/ics")
def public_event_ics(slug: str):
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="dev_stub: no events in dev")


@router.post("/public/events/{slug}/register")
def register_public_event(slug: str):
    from fastapi import HTTPException
    raise HTTPException(status_code=501, detail="dev_stub: event registration requires the Worker")
