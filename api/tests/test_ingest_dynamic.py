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
    assert out["price_cents"] == 225_000_000
    assert out["iptu_cents"] == 100_000
    assert out["bedrooms"] == 3
    assert out["bathrooms"] == 4
    assert out["garage_spaces"] == 4
    assert out["area_m2"] == 230
    assert out["listing_kind"] == "Casa À venda"
    assert out["posted_at"] is not None and "T" in out["posted_at"]
