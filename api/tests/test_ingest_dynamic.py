from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200


def test_domains_listed():
    r = client.get("/api/v1/domains")
    assert r.status_code == 200
    assert set(r.json()) >= {"olx", "auctions"}


def test_olx_missing_required_returns_422():
    payload = {"domain_id": "olx", "raw_data": {"items": [{"price_raw": "R$ 100"}]}}
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 422


def test_unknown_domain_returns_404():
    r = client.post("/api/v1/ingest", json={"domain_id": "nope", "raw_data": {"items": []}})
    assert r.status_code == 404


def test_response_exposes_persistence_status():
    payload = {"domain_id": "olx", "raw_data": {"items": [{"title": "Casa", "url": "https://x"}]}}
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert {"persisted", "session_id", "skipped_reason"} <= set(body.keys())


def test_sessions_endpoint_responds():
    r = client.get("/api/v1/sessions?limit=5")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_olx_accepts_iso_and_epoch_dates():
    from app.normalization.olx import _date_to_iso
    assert _date_to_iso("2026-05-09T04:58:00Z").startswith("2026-05-09T04:58:00")
    assert _date_to_iso("1715228280000").startswith("2024-05-09")  # ms epoch
    assert _date_to_iso("1715228280").startswith("2024-05-09")     # s epoch
    assert _date_to_iso(None) is None


def test_external_id_upsert_dedupes_olx():
    """Mesmo external_id em ingests separados não gera duplicata."""
    from app.core import db

    eid = "test-dedup-9999999"
    payload = {
        "domain_id": "olx",
        "raw_data": {
            "items": [{
                "external_id": eid,
                "title": "Casa de teste dedup",
                "url": f"https://x/{eid}",
                "price_raw": "R$ 100.000",
            }],
        },
    }
    r1 = client.post("/api/v1/ingest", json=payload)
    r2 = client.post("/api/v1/ingest", json=payload)
    assert r1.status_code == 200 and r2.status_code == 200

    if not r1.json().get("persisted"):
        return  # DB sem migrações — skip assert do banco

    with db.connect() as conn:
        with db.cursor(conn) as cur:
            cur.execute(db.q("SELECT count(*) FROM olx_listings WHERE external_id=?"), (eid,))
            assert cur.fetchone()[0] == 1
            cur.execute(db.q("DELETE FROM olx_listings WHERE external_id=?"), (eid,))


def test_olx_house_payload_full_normalization():
    payload = {
        "domain_id": "olx",
        "raw_data": {
            "items": [{
                "title": "Casa térrea no Setor Jaó",
                "url": "https://go.olx.com.br/grande-goiania-e-anapolis/imoveis/casa-terrea-no-setor-jao-1500645324",
                "price_raw": "R$ 2.250.000",
                "listing_kind": "Casa À venda",
                "location": "Goiânia, Setor Jaó",
                "date_raw": "9 de mai, 04:58",
                "image_url": "https://img.olx.com.br/thumbs700x500/82/821671162265067.webp",
                "iptu_raw": "IPTU R$ 1.000",
                "bedrooms_raw": "3 quartos",
                "bathrooms_raw": "4 banheiros",
                "garage_spaces_raw": "4 vagas de garagem",
                "area_raw": "230 metros quadrados",
            }],
        },
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()["normalized"][0]
    assert out["price"] == 2_250_000
    assert out["iptu"] == 1_000
    assert out["bedrooms"] == 3
    assert out["bathrooms"] == 4
    assert out["garage_spaces"] == 4
    assert out["area_m2"] == 230
    assert out["listing_kind"] == "Casa À venda"
    assert out["posted_at"] is not None and "T" in out["posted_at"]


def test_linkedin_missing_required_returns_422():
    payload = {"domain_id": "linkedin", "raw_data": {"items": [{"company": "ACME"}]}}
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 422


def test_linkedin_list_normalization():
    payload = {
        "domain_id": "linkedin",
        "raw_data": {
            "items": [{
                "external_id": "3801234567",
                "title": "  Senior Backend Engineer ",
                "company": " ACME Corp ",
                "location": "São Paulo, Brazil",
                "url": "https://www.linkedin.com/jobs/view/3801234567/",
                "posted_raw": "2024-05-09",
                "source_view": "loggedin",
            }],
        },
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()["normalized"][0]
    assert out["external_id"] == "3801234567"
    assert out["title"] == "Senior Backend Engineer"
    assert out["company"] == "ACME Corp"
    assert out["posted_at"] == "2024-05-09"
    assert out["source_view"] == "loggedin"


def test_linkedin_detail_normalization():
    payload = {
        "domain_id": "linkedin_detail",
        "raw_data": {
            "items": [{
                "external_id": "3801234567",
                "title": "Senior Backend Engineer",
                "url": "https://www.linkedin.com/jobs/view/3801234567/",
                "description": "  We are hiring backend engineers.  ",
                "seniority": "Mid-Senior level",
                "employment_type": "Full-time",
                "applicants_raw": "Over 1,200 applicants",
                "source_view": "loggedin",
            }],
        },
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()["normalized"][0]
    assert out["applicants"] == 1200
    assert out["seniority"] == "Mid-Senior level"
    assert out["employment_type"] == "Full-time"
    assert out["description"] == "We are hiring backend engineers."


def test_linkedin_external_id_upsert_dedupes():
    """Mesmo external_id em ingests separados não duplica a vaga."""
    from app.core import db

    eid = "ln-test-dedup-9999999"
    payload = {
        "domain_id": "linkedin",
        "raw_data": {
            "items": [{
                "external_id": eid,
                "title": "Dedup Engineer",
                "url": f"https://www.linkedin.com/jobs/view/{eid}/",
                "company": "ACME",
            }],
        },
    }
    r1 = client.post("/api/v1/ingest", json=payload)
    r2 = client.post("/api/v1/ingest", json=payload)
    assert r1.status_code == 200 and r2.status_code == 200

    if not r1.json().get("persisted"):
        return  # DB sem migrações — skip assert do banco

    with db.connect() as conn:
        with db.cursor(conn) as cur:
            cur.execute(db.q("SELECT count(*) FROM linkedin_jobs WHERE external_id=?"), (eid,))
            assert cur.fetchone()[0] == 1
            cur.execute(db.q("DELETE FROM linkedin_jobs WHERE external_id=?"), (eid,))


def test_linkedin_list_detail_join_by_external_id():
    """Lista e detalhe vivem em tabelas separadas, unidas pelo external_id."""
    from app.core import db

    eid = "ln-join-9999998"
    list_payload = {
        "domain_id": "linkedin",
        "raw_data": {"items": [{
            "external_id": eid,
            "title": "Join Engineer",
            "company": "ACME",
            "location": "Remote",
            "url": f"https://www.linkedin.com/jobs/view/{eid}/",
        }]},
    }
    detail_payload = {
        "domain_id": "linkedin_detail",
        "raw_data": {"items": [{
            "external_id": eid,
            "title": "Join Engineer",
            "url": f"https://www.linkedin.com/jobs/view/{eid}/",
            "description": "Joins two tables by id.",
            "seniority": "Mid-Senior level",
            "employment_type": "Full-time",
        }]},
    }
    r1 = client.post("/api/v1/ingest", json=list_payload)
    r2 = client.post("/api/v1/ingest", json=detail_payload)
    assert r1.status_code == 200 and r2.status_code == 200

    if not (r1.json().get("persisted") and r2.json().get("persisted")):
        return  # DB sem migrações — skip assert do banco

    with db.connect() as conn:
        with db.cursor(conn) as cur:
            cur.execute(db.q(
                "SELECT j.title, d.description, d.seniority "
                "FROM linkedin_jobs j JOIN linkedin_job_details d "
                "  ON j.external_id = d.external_id "
                "WHERE j.external_id=?"
            ), (eid,))
            row = cur.fetchone()
            assert row is not None, "join lista×detalhe não retornou linha"
            assert row[0] == "Join Engineer"
            assert row[1] == "Joins two tables by id."
            assert row[2] == "Mid-Senior level"
            cur.execute(db.q("DELETE FROM linkedin_jobs WHERE external_id=?"), (eid,))
            cur.execute(db.q("DELETE FROM linkedin_job_details WHERE external_id=?"), (eid,))
