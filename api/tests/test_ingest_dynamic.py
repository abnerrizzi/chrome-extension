from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200


def test_domains_listed():
    r = client.get("/api/v1/domains")
    assert r.status_code == 200
    assert set(r.json()) >= {"linkedin", "olx", "auctions"}


def test_linkedin_valid_payload():
    payload = {
        "domain_id": "linkedin",
        "raw_data": {
            "items": [
                {"job_title": "Senior Backend Engineer", "company": "Acme", "url": "https://x"},
            ]
        },
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["validated"] == 1
    assert body["normalized"][0]["job_title"] == "Senior Backend Engineer"


def test_olx_missing_required_returns_422():
    payload = {"domain_id": "olx", "raw_data": {"items": [{"price_raw": "R$ 100"}]}}
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 422


def test_unknown_domain_returns_404():
    r = client.post("/api/v1/ingest", json={"domain_id": "nope", "raw_data": {"items": []}})
    assert r.status_code == 404


def test_olx_price_normalized_to_cents():
    payload = {
        "domain_id": "olx",
        "raw_data": {
            "items": [{"title": "Carro", "price_raw": "R$ 25.000,00", "url": "https://o"}]
        },
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200
    assert r.json()["normalized"][0]["price_cents"] == 2_500_000
