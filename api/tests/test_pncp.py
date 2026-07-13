from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_pncp_list_normalization():
    payload = {
        "domain_id": "pncp",
        "raw_data": {
            "items": [{
                "external_id": "18712158000150/2026/23",
                "pncp_id": "18712158000150/2026/23",
                "numero_edital": "Edital nº 23/2026",
                "modalidade": "Pregão Eletrônico",
                "ultima_atualizacao_raw": "10/07/2026 14:30:00",
                "orgao": "Prefeitura Municipal",
                "local": "São Gonçalo do Sapucaí/MG",
                "objeto": "Aquisição de computadores",
                "url": "https://pncp.gov.br/app/editais/18712158000150/2026/23"
            }]
        }
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()["normalized"][0]
    assert out["external_id"] == "18712158000150/2026/23"
    assert out["pncp_id"] == "18712158000150/2026/23"
    assert out["numero_edital"] == "Edital nº 23/2026"
    assert out["modalidade"] == "Pregão Eletrônico"
    assert out["municipio"] == "São Gonçalo do Sapucaí"
    assert out["uf"] == "MG"
    assert out["objeto"] == "Aquisição de computadores"
    assert out["data_publicacao_pncp"] == "2026-07-10T14:30:00"

def test_pncp_detail_normalization():
    payload = {
        "domain_id": "pncp_detail",
        "raw_data": {
            "items": [{
                "external_id": "18712158000150/2026/23",
                "pncp_id": "18712158000150/2026/23",
                "numero_edital": "Edital nº 23/2026",
                "modalidade": "Pregão Eletrônico",
                "modo_disputa": "Aberto",
                "orgao_cnpj": "18712158000150",
                "orgao_razao_social": "Prefeitura Municipal",
                "municipio": "São Gonçalo do Sapucaí",
                "uf": "MG",
                "objeto": "Aquisição de computadores",
                "valor_total_estimado_raw": "R$ 150.000,50",
                "valor_total_homologado_raw": "145200.75",
                "situacao": "Homologada",
                "srp": True,
                "amparo_legal": "Lei 14.133/2021",
                "data_publicacao_pncp_raw": "2026-07-10T14:30:00Z",
                "data_abertura_proposta_raw": "2026-07-25T09:00:00.000Z",
                "data_encerramento_proposta_raw": "2026-07-25T17:00:00.000-03:00",
                "link_sistema_origem": "https://compras.gov.br",
                "url": "https://pncp.gov.br/app/editais/18712158000150/2026/23"
            }]
        }
    }
    r = client.post("/api/v1/ingest", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()["normalized"][0]
    assert out["external_id"] == "18712158000150/2026/23"
    assert out["valor_total_estimado"] == 150000.50
    assert out["valor_total_homologado"] == 145200.75
    assert out["srp"] is True
    assert out["data_publicacao_pncp"] == "2026-07-10T14:30:00Z"
    assert out["data_abertura_proposta"] == "2026-07-25T09:00:00.000Z"
    assert out["data_encerramento_proposta"] == "2026-07-25T17:00:00.000-03:00"

def test_pncp_upsert_coalesce():
    from app.core import db

    eid = "pncp-coalesce-test-999"
    list_payload = {
        "domain_id": "pncp",
        "raw_data": {
            "items": [{
                "external_id": eid,
                "pncp_id": eid,
                "numero_edital": "Edital nº 99/2026",
                "modalidade": "Pregão",
                "ultima_atualizacao_raw": "10/07/2026",
                "orgao": "Prefeitura",
                "local": "São Gonçalo do Sapucaí/MG",
                "objeto": "Objeto da Lista",
                "url": "https://pncp.gov.br/app/editais/99"
            }]
        }
    }
    detail_payload = {
        "domain_id": "pncp_detail",
        "raw_data": {
            "items": [{
                "external_id": eid,
                "objeto": "Objeto do Detalhe",
                "valor_total_estimado_raw": "5000.00",
                "situacao": "Aberto",
                "url": "https://pncp.gov.br/app/editais/99"
            }]
        }
    }

    r1 = client.post("/api/v1/ingest", json=list_payload)
    r2 = client.post("/api/v1/ingest", json=detail_payload)
    assert r1.status_code == 200 and r2.status_code == 200

    if not (r1.json().get("persisted") and r2.json().get("persisted")):
        return

    with db.connect() as conn:
        with db.cursor(conn) as cur:
            cur.execute(db.q(
                "SELECT numero_edital, modalidade, municipio, uf, objeto, valor_total_estimado, situacao "
                "FROM pncp_items WHERE external_id=?"
            ), (eid,))
            row = cur.fetchone()
            assert row is not None
            assert row[0] == "Edital nº 99/2026"
            assert row[1] == "Pregão"
            assert row[2] == "São Gonçalo do Sapucaí"
            assert row[3] == "MG"
            assert row[4] == "Objeto do Detalhe" # updated by detail
            assert float(row[5]) == 5000.00 # updated by detail
            assert row[6] == "Aberto" # updated by detail
            
            cur.execute(db.q("DELETE FROM pncp_items WHERE external_id=?"), (eid,))
