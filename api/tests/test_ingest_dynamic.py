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


def test_response_exposes_persistence_status():
    payload = {"domain_id": "linkedin", "raw_data": {"items": [{"job_title": "Eng"}]}}
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


def test_linkedin_search_list_payload_shape():
    """Payload representativo da lista de busca: 3 cards com a forma exata que
    `linkedin_search_parser.js` emite. Confere validação, contagem e
    normalização passthrough (campos da lista não exigem transformação)."""
    payload = {
        "domain_id": "linkedin",
        "raw_data": {
            "items": [
                {
                    "external_id": "3812345678",
                    "job_title": "Staff Software Engineer, Platform",
                    "company": "Acme Robotics",
                    "location": "São Paulo, São Paulo, Brazil · Remote",
                    "url": "https://www.linkedin.com/jobs/view/3812345678/",
                },
                {
                    "external_id": "3812345679",
                    "job_title": "Senior Backend Engineer (Python/Go)",
                    "company": "Globex",
                    "location": "Rio de Janeiro, RJ · Hybrid",
                    "url": "https://www.linkedin.com/jobs/view/3812345679/",
                },
                {
                    "external_id": "3812345680",
                    "job_title": "Data Engineer",
                    "company": "Initech",
                    "location": "Remote",
                    "url": "https://www.linkedin.com/jobs/view/3812345680/",
                },
            ]
        },
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["validated"] == 3
    titles = [it["job_title"] for it in body["normalized"]]
    assert titles == [
        "Staff Software Engineer, Platform",
        "Senior Backend Engineer (Python/Go)",
        "Data Engineer",
    ]
    # Campos do detalhe ficam None na lista — confirma que o normalizer não
    # inventa valores.
    for it in body["normalized"]:
        assert it["description"] is None
        assert it["seniority"] is None
        assert it["workplace_type"] is None
        assert it["skills"] is None


def test_linkedin_detail_payload_full_normalization():
    """Payload representativo da página de detalhe: chips de seniority/workplace,
    posted_at como `<time datetime>` ISO, skills lista, description multilinha.
    Confere a normalização ponto-a-ponto."""
    iso_posted = "2026-05-20T13:42:00Z"
    payload = {
        "domain_id": "linkedin",
        "raw_data": {
            "items": [{
                "external_id": "3812345678",
                "job_title": "Staff Software Engineer, Platform",
                "company": "Acme Robotics",
                "location": "São Paulo, São Paulo, Brazil",
                "url": "https://www.linkedin.com/jobs/view/3812345678/",
                "description": (
                    "About the role:\n"
                    "We are looking for a staff engineer to drive the platform "
                    "team's roadmap. You will design distributed systems, mentor "
                    "engineers, and partner with product."
                ),
                "seniority": "Mid-Senior level",
                "workplace_type": "Remote",
                "posted_at": iso_posted,
                "employment_type": "Full-time",
                "job_function": "Engineering and Information Technology",
                "industries": "Software Development",
                "raw_json": "{\"criteria\":{\"employment type\":\"Full-time\"}}",
                "skills": ["Python", "Kafka", "PostgreSQL", "Distributed Systems"],
            }],
        },
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()["normalized"][0]
    assert out["external_id"] == "3812345678"
    assert out["seniority"] == "Mid-Senior level"
    assert out["workplace_type"] == "Remote"
    assert out["employment_type"] == "Full-time"
    assert out["job_function"] == "Engineering and Information Technology"
    assert out["industries"] == "Software Development"
    # ISO já formatado passa direto pelo normalizer.
    assert out["posted_at"] == iso_posted
    # Skills e raw_json saem como JSON string (JSONB/TEXT cross-backend).
    import json as _json
    assert _json.loads(out["skills"]) == [
        "Python", "Kafka", "PostgreSQL", "Distributed Systems",
    ]
    assert _json.loads(out["raw_json"])["criteria"]["employment type"] == "Full-time"
    assert out["description"].startswith("About the role:")


def test_linkedin_posted_at_relative_parses():
    """'Reposted 3 days ago' vira ISO-8601 ~3 dias antes de agora."""
    from datetime import datetime, timezone

    from app.normalization.linkedin import normalize

    out = normalize([{"job_title": "Eng", "posted_at": "Reposted 3 days ago"}])[0]
    iso = out["posted_at"]
    assert iso and "T" in iso
    parsed = datetime.fromisoformat(iso)
    delta_days = (datetime.now(timezone.utc) - parsed).total_seconds() / 86_400
    assert 2.9 < delta_days < 3.1


def test_linkedin_skills_list_serialised():
    """Lista de skills é serializada como JSON string (cross-backend)."""
    import json

    from app.normalization.linkedin import normalize

    out = normalize([{"job_title": "Eng", "skills": ["Python", "SQL", "  "]}])[0]
    assert isinstance(out["skills"], str)
    assert json.loads(out["skills"]) == ["Python", "SQL"]

    empty = normalize([{"job_title": "Eng", "skills": []}])[0]
    assert empty["skills"] is None


def test_linkedin_detail_enriches_via_external_id_upsert():
    """Ingest 1 (busca) cria a linha; ingest 2 (detalhe, mesmo external_id)
    preenche description/seniority/workplace_type; ingest 1 não deve apagar
    campos do detalhe se rodar de novo depois (COALESCE preserva)."""
    from app.core import db

    eid = "test-li-enrich-1234567"
    search_payload = {
        "domain_id": "linkedin",
        "raw_data": {
            "items": [{
                "external_id": eid,
                "job_title": "Staff Engineer",
                "company": "Acme",
                "location": "Remote · Brazil",
                "url": f"https://linkedin.com/jobs/view/{eid}/",
            }],
        },
    }
    detail_payload = {
        "domain_id": "linkedin",
        "raw_data": {
            "items": [{
                "external_id": eid,
                "job_title": "Staff Engineer",
                "description": "Build distributed systems at scale.",
                "seniority": "Mid-Senior level",
                "workplace_type": "Remote",
                "posted_at": "Reposted 2 days ago",
                "skills": ["Python", "Kafka"],
            }],
        },
    }
    r1 = client.post("/api/v1/ingest", json=search_payload)
    r2 = client.post("/api/v1/ingest", json=detail_payload)
    r3 = client.post("/api/v1/ingest", json=search_payload)  # busca de novo
    assert r1.status_code == 200 and r2.status_code == 200 and r3.status_code == 200

    if not r1.json().get("persisted"):
        return  # DB sem migrações — pula assertions

    with db.connect() as conn:
        with db.cursor(conn) as cur:
            cur.execute(
                db.q("SELECT count(*) FROM linkedin_jobs WHERE external_id=?"),
                (eid,),
            )
            assert cur.fetchone()[0] == 1, "upsert deve manter uma única linha"
            # Cast skills::text para evitar max(jsonb) no Postgres; SQLite
            # ignora o cast (skills é TEXT). Aqui não agregamos, leitura direta.
            cur.execute(
                db.q(
                    "SELECT description, seniority, workplace_type, company, "
                    "       location, skills::text AS skills_text "
                    "FROM linkedin_jobs WHERE external_id=?"
                ) if db.IS_POSTGRES else db.q(
                    "SELECT description, seniority, workplace_type, company, "
                    "       location, skills "
                    "FROM linkedin_jobs WHERE external_id=?"
                ),
                (eid,),
            )
            desc, sen, wp, comp, loc, skills = cur.fetchone()
            assert desc == "Build distributed systems at scale."
            assert sen == "Mid-Senior level"
            assert wp == "Remote"
            # Campos da lista também devem persistir (COALESCE preserva quando
            # a ingestão de busca roda DEPOIS do detalhe).
            assert comp == "Acme"
            assert loc == "Remote · Brazil"
            # Skills armazenado como JSON string.
            import json as _json
            assert _json.loads(skills) == ["Python", "Kafka"]
            cur.execute(db.q("DELETE FROM linkedin_jobs WHERE external_id=?"), (eid,))


def test_linkedin_fake_fixture_round_trip():
    """Carrega as fixtures de busca + detalhe (api/tests/fixtures/linkedin_*.json)
    — as mesmas que o Makefile usa em `make linkedin-fake-run` — POSTa as duas
    sequências e confere o merge por external_id no banco.

    Fixtures externalizadas para que o pipeline manual (curl via Makefile) e o
    teste automatizado consumam exatamente o mesmo payload — qualquer drift
    quebra os dois ao mesmo tempo.
    """
    import json
    from pathlib import Path

    from app.core import db

    fixtures = Path(__file__).parent / "fixtures"
    search = json.loads((fixtures / "linkedin_search_list.json").read_text())
    detail = json.loads((fixtures / "linkedin_detail.json").read_text())

    r1 = client.post("/api/v1/ingest", json=search)
    r2 = client.post("/api/v1/ingest", json=detail)
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert r1.json()["validated"] == 4
    assert r2.json()["validated"] == 2

    if not r1.json().get("persisted"):
        return  # DB sem migrações — pula assertions

    eids = [it["external_id"] for it in search["raw_data"]["items"]]
    enriched_ids = {it["external_id"] for it in detail["raw_data"]["items"]}
    try:
        with db.connect() as conn:
            with db.cursor(conn) as cur:
                # Uma linha por external_id (upsert preservou unicidade).
                placeholders = ",".join(["?"] * len(eids))
                cur.execute(
                    db.q(
                        f"SELECT count(*) FROM linkedin_jobs WHERE external_id IN ({placeholders})"
                    ),
                    tuple(eids),
                )
                assert cur.fetchone()[0] == 4

                # Cards enriquecidos têm description; os outros têm description NULL.
                for eid in eids:
                    cur.execute(
                        db.q(
                            "SELECT job_title, company, description, seniority, "
                            "       workplace_type, employment_type, raw_json "
                            "FROM linkedin_jobs WHERE external_id=?"
                        ),
                        (eid,),
                    )
                    title, company, desc, sen, wp, emp, raw = cur.fetchone()
                    assert title  # job_title sempre persistido
                    assert company  # vindo da lista
                    if eid in enriched_ids:
                        assert desc, f"detalhe esperado para {eid}"
                        assert sen and wp
                    else:
                        assert desc is None
                        assert sen is None
                        assert wp is None
                    # 9990000001 traz os campos novos do detalhe (criteria).
                    if eid == "9990000001":
                        assert emp == "Full-time"
                        assert raw is not None  # raw_json persistido (JSONB/TEXT)
    finally:
        with db.connect() as conn:
            with db.cursor(conn) as cur:
                placeholders = ",".join(["?"] * len(eids))
                cur.execute(
                    db.q(f"DELETE FROM linkedin_jobs WHERE external_id IN ({placeholders})"),
                    tuple(eids),
                )


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
