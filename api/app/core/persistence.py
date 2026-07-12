"""Persistência síncrona — escolhe Postgres ou SQLite via `app.core.db`.

Estratégia: 1 conexão por chamada de ingest (volume é baixo — uma extensão
mandando lotes manualmente). Em caso de DB indisponível ou migração não
aplicada, retorna `(None, motivo)` em vez de explodir, para que o request HTTP
responda 200 mesmo quando o banco está offline (o `persisted` no response
sinaliza o estado).
"""
from __future__ import annotations

import logging
from typing import Optional

from app.core import db

log = logging.getLogger(__name__)


def persist(domain_id: str, items: list[dict]) -> tuple[Optional[int], Optional[str]]:
    """Insere a sessão e os itens. Retorna `(session_id, None)` em sucesso,
    `(None, motivo)` quando pulado por DB indisponível/migração faltando."""
    if not db.DATABASE_URL:
        return None, "DATABASE_URL not set"
    if not items:
        return None, "no items to persist"
    try:
        with db.connect() as conn:
            with db.cursor(conn) as cur:
                session_id = db.insert_returning_id(
                    cur,
                    "INSERT INTO scrape_sessions (domain_name, item_count) VALUES (?, ?)",
                    (domain_id, len(items)),
                )
                _insert_items(cur, domain_id, session_id, items)
        return session_id, None
    except db.OperationalError as e:
        log.warning("persistence skipped (db unreachable): %s", e)
        return None, f"db unreachable: {e}"
    except db.DBError as e:
        if db.is_missing_table(e):
            log.warning("persistence skipped (run liquibase update): %s", e)
            return None, "tables missing — run liquibase update"
        log.exception("persistence failed")
        return None, f"db error: {e}"


def _insert_items(cur, domain_id: str, session_id: int, items: list[dict]) -> None:
    # `ON CONFLICT (external_id) [WHERE …] DO UPDATE` — upsert via índice único
    # parcial. Postgres exige o WHERE para casar com o predicado do índice;
    # SQLite resolve o índice parcial implicitamente. `db.upsert_conflict_clause`
    # devolve a forma certa para cada backend.
    on_conflict = db.upsert_conflict_clause("external_id")

    if domain_id == "olx":
        cur.executemany(
            db.q(
                "INSERT INTO olx_listings "
                "(session_id, external_id, title, url, price, currency, listing_kind, "
                " kind, real_estate_type, category, "
                " neighbourhood, city, state, "
                " posted_at, image_url, iptu, bedrooms, bathrooms, "
                " garage_spaces, area_m2) "
                "VALUES (?,?,?,?,?,?,?,"
                "        ?,?,?,"
                "        ?,?,?,"
                "        ?,?,?,?,?,?,?) "
                f"{on_conflict} "
                "  session_id=EXCLUDED.session_id, title=EXCLUDED.title, url=EXCLUDED.url, "
                "  price=EXCLUDED.price, currency=EXCLUDED.currency, "
                "  listing_kind=EXCLUDED.listing_kind, kind=EXCLUDED.kind, "
                "  real_estate_type=EXCLUDED.real_estate_type, category=EXCLUDED.category, "
                "  neighbourhood=EXCLUDED.neighbourhood, city=EXCLUDED.city, "
                "  state=EXCLUDED.state, "
                "  posted_at=EXCLUDED.posted_at, image_url=EXCLUDED.image_url, "
                "  iptu=EXCLUDED.iptu, bedrooms=EXCLUDED.bedrooms, "
                "  bathrooms=EXCLUDED.bathrooms, garage_spaces=EXCLUDED.garage_spaces, "
                "  area_m2=EXCLUDED.area_m2"
            ),
            [(session_id, it.get("external_id"), it["title"], it["url"],
              it.get("price"), it.get("currency"), it.get("listing_kind"),
              it.get("kind"), it.get("real_estate_type"), it.get("category"),
              it.get("neighbourhood"), it.get("city"), it.get("state"),
              it.get("posted_at"), it.get("image_url"),
              it.get("iptu"), it.get("bedrooms"), it.get("bathrooms"),
              it.get("garage_spaces"), it.get("area_m2")) for it in items],
        )
    elif domain_id == "auctions":
        rows = [
            (session_id, it.get("external_id"), it["lot_code"], it["title"],
             it["current_bid_cents"], it["auction_end"], it.get("url"))
            for it in items
            if it.get("current_bid_cents") is not None and it.get("auction_end")
        ]
        if rows:
            cur.executemany(
                db.q(
                    "INSERT INTO auction_items "
                    "(session_id, external_id, lot_code, title, current_bid_cents, "
                    " auction_end, url) "
                    "VALUES (?,?,?,?,?,?,?) "
                    f"{on_conflict} "
                    "  session_id=EXCLUDED.session_id, lot_code=EXCLUDED.lot_code, "
                    "  title=EXCLUDED.title, current_bid_cents=EXCLUDED.current_bid_cents, "
                    "  auction_end=EXCLUDED.auction_end, url=EXCLUDED.url"
                ),
                rows,
            )
    elif domain_id == "linkedin":
        cur.executemany(
            db.q(
                "INSERT INTO linkedin_jobs "
                "(session_id, external_id, title, company, location, url, "
                " posted_at, source_view) "
                "VALUES (?,?,?,?,?,?,?,?) "
                f"{on_conflict} "
                "  session_id=EXCLUDED.session_id, title=EXCLUDED.title, "
                "  company=EXCLUDED.company, location=EXCLUDED.location, url=EXCLUDED.url, "
                "  posted_at=EXCLUDED.posted_at, source_view=EXCLUDED.source_view"
            ),
            [(session_id, it.get("external_id"), it["title"], it.get("company"),
              it.get("location"), it["url"], it.get("posted_at"), it.get("source_view"))
             for it in items],
        )
    elif domain_id == "linkedin_detail":
        # Detalhe vive em `linkedin_job_details`, separado da lista (`linkedin_jobs`);
        # as duas tabelas se unem por `external_id` em consultas. O parser pode
        # re-emitir a mesma vaga com campos progressivos (descrição chega antes
        # das pílulas de senioridade/regime/candidatos, em outras renderizações
        # vice-versa): COALESCE protege cada coluna opcional para que um upsert
        # mais esparso não apague valores já persistidos por um upsert anterior.
        cur.executemany(
            db.q(
                "INSERT INTO linkedin_job_details "
                "(session_id, external_id, title, company, location, url, "
                " description, seniority, employment_type, applicants, source_view) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?) "
                f"{on_conflict} "
                "  session_id=EXCLUDED.session_id, title=EXCLUDED.title, "
                "  company=COALESCE(EXCLUDED.company, linkedin_job_details.company), "
                "  location=COALESCE(EXCLUDED.location, linkedin_job_details.location), "
                "  url=EXCLUDED.url, "
                "  description=COALESCE(EXCLUDED.description, linkedin_job_details.description), "
                "  seniority=COALESCE(EXCLUDED.seniority, linkedin_job_details.seniority), "
                "  employment_type=COALESCE(EXCLUDED.employment_type, linkedin_job_details.employment_type), "
                "  applicants=COALESCE(EXCLUDED.applicants, linkedin_job_details.applicants), "
                "  source_view=EXCLUDED.source_view"
            ),
            [(session_id, it.get("external_id"), it["title"], it.get("company"),
              it.get("location"), it["url"], it.get("description"), it.get("seniority"),
              it.get("employment_type"), it.get("applicants"), it.get("source_view"))
             for it in items],
        )
    elif domain_id == "pncp":
        cur.executemany(
            db.q(
                "INSERT INTO pncp_items "
                "(session_id, external_id, pncp_id, numero_edital, modalidade, "
                " municipio, uf, objeto, data_publicacao_pncp, url) "
                "VALUES (?,?,?,?,?,?,?,?,?,?) "
                f"{on_conflict} "
                "  session_id=EXCLUDED.session_id, "
                "  pncp_id=COALESCE(EXCLUDED.pncp_id, pncp_items.pncp_id), "
                "  numero_edital=COALESCE(EXCLUDED.numero_edital, pncp_items.numero_edital), "
                "  modalidade=COALESCE(EXCLUDED.modalidade, pncp_items.modalidade), "
                "  municipio=COALESCE(EXCLUDED.municipio, pncp_items.municipio), "
                "  uf=COALESCE(EXCLUDED.uf, pncp_items.uf), "
                "  objeto=COALESCE(EXCLUDED.objeto, pncp_items.objeto), "
                "  data_publicacao_pncp=COALESCE(EXCLUDED.data_publicacao_pncp, pncp_items.data_publicacao_pncp), "
                "  url=EXCLUDED.url"
            ),
            [(session_id, it.get("external_id"), it.get("pncp_id"), it.get("numero_edital"),
              it.get("modalidade"), it.get("municipio"), it.get("uf"), it.get("objeto"),
              it.get("data_publicacao_pncp"), it.get("url"))
             for it in items],
        )
    elif domain_id == "pncp_detail":
        for it in items:
            cur.execute(
                db.q(
                    "INSERT INTO pncp_items "
                    "(session_id, external_id, pncp_id, numero_edital, modalidade, "
                    " modo_disputa, orgao_cnpj, orgao_razao_social, municipio, uf, "
                    " objeto, valor_total_estimado, valor_total_homologado, situacao, srp, "
                    " amparo_legal, data_publicacao_pncp, data_abertura_proposta, "
                    " data_encerramento_proposta, link_sistema_origem, url) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                    f"{on_conflict} "
                    "  session_id=EXCLUDED.session_id, "
                    "  pncp_id=EXCLUDED.pncp_id, "
                    "  numero_edital=EXCLUDED.numero_edital, "
                    "  modalidade=EXCLUDED.modalidade, "
                    "  modo_disputa=EXCLUDED.modo_disputa, "
                    "  orgao_cnpj=EXCLUDED.orgao_cnpj, "
                    "  orgao_razao_social=EXCLUDED.orgao_razao_social, "
                    "  municipio=EXCLUDED.municipio, "
                    "  uf=EXCLUDED.uf, "
                    "  objeto=EXCLUDED.objeto, "
                    "  valor_total_estimado=EXCLUDED.valor_total_estimado, "
                    "  valor_total_homologado=EXCLUDED.valor_total_homologado, "
                    "  situacao=EXCLUDED.situacao, "
                    "  srp=EXCLUDED.srp, "
                    "  amparo_legal=EXCLUDED.amparo_legal, "
                    "  data_publicacao_pncp=EXCLUDED.data_publicacao_pncp, "
                    "  data_abertura_proposta=EXCLUDED.data_abertura_proposta, "
                    "  data_encerramento_proposta=EXCLUDED.data_encerramento_proposta, "
                    "  link_sistema_origem=EXCLUDED.link_sistema_origem, "
                    "  url=EXCLUDED.url"
                ),
                (
                    session_id, it.get("external_id"), it.get("pncp_id"), it.get("numero_edital"),
                    it.get("modalidade"), it.get("modo_disputa"), it.get("orgao_cnpj"), it.get("orgao_razao_social"),
                    it.get("municipio"), it.get("uf"), it.get("objeto"), it.get("valor_total_estimado"),
                    it.get("valor_total_homologado"), it.get("situacao"), it.get("srp"), it.get("amparo_legal"),
                    it.get("data_publicacao_pncp"), it.get("data_abertura_proposta"),
                    it.get("data_encerramento_proposta"), it.get("link_sistema_origem"), it.get("url")
                )
            )

            # Get database generated/updated id
            cur.execute(db.q("SELECT id FROM pncp_items WHERE external_id = ?"), (it["external_id"],))
            row = cur.fetchone()
            if not row:
                continue
            purchase_id = row[0]

            # Clear existing items
            cur.execute(db.q("DELETE FROM pncp_purchase_items WHERE purchase_id = ?"), (purchase_id,))

            # Insert new items if present
            purchase_items = it.get("itens") or []
            if purchase_items:
                cur.executemany(
                    db.q(
                        "INSERT INTO pncp_purchase_items ("
                        "  purchase_id, numero_item, descricao, material_ou_servico, "
                        "  valor_unitario_estimado, valor_unitario_estimado_raw, "
                        "  valor_total, valor_total_raw, "
                        "  quantidade, unidade_medida, situacao"
                        ") VALUES (?,?,?,?,?,?,?,?,?,?,?)"
                    ),
                    [
                        (
                            purchase_id,
                            pi.get("numero_item"),
                            pi.get("descricao"),
                            pi.get("material_ou_servico"),
                            pi.get("valor_unitario_estimado"),
                            pi.get("valor_unitario_estimado_raw"),
                            pi.get("valor_total"),
                            pi.get("valor_total_raw"),
                            pi.get("quantidade"),
                            pi.get("unidade_medida"),
                            pi.get("situacao")
                        )
                        for pi in purchase_items
                    ]
                )


def fetch_recent_sessions(limit: int = 20) -> list[dict]:
    if not db.DATABASE_URL:
        return []
    try:
        with db.connect() as conn:
            with db.dict_cursor(conn) as cur:
                cur.execute(
                    db.q(
                        "SELECT id, domain_name, item_count, created_at "
                        "FROM scrape_sessions ORDER BY id DESC LIMIT ?"
                    ),
                    (limit,),
                )
                return [
                    {**dict(r), "created_at": db.iso(dict(r).get("created_at"))}
                    for r in cur.fetchall()
                ]
    except db.OperationalError:
        return []
    except db.DBError as e:
        if db.is_missing_table(e):
            return []
        raise


def fetch_session_items(session_id: int) -> dict:
    """Retorna itens daquela sessão, buscando na tabela correta pelo domain_name."""
    if not db.DATABASE_URL:
        return {}
    table_map = {
        "olx": "olx_listings",
        "auctions": "auction_items",
        "linkedin": "linkedin_jobs",
        "linkedin_detail": "linkedin_job_details",
        "pncp": "pncp_items",
        "pncp_detail": "pncp_items",
    }
    try:
        with db.connect() as conn:
            with db.dict_cursor(conn) as cur:
                cur.execute(
                    db.q(
                        "SELECT id, domain_name, item_count, created_at "
                        "FROM scrape_sessions WHERE id=?"
                    ),
                    (session_id,),
                )
                row = cur.fetchone()
                if not row:
                    return {}
                session = dict(row)
                table = table_map.get(session["domain_name"])
                if not table:
                    session["created_at"] = db.iso(session.get("created_at"))
                    return {"session": session, "items": []}
                cur.execute(db.q(f"SELECT * FROM {table} WHERE session_id=? ORDER BY id"), (session_id,))
                items = [
                    {k: db.iso(v) for k, v in dict(r).items()}
                    for r in cur.fetchall()
                ]
                session["created_at"] = db.iso(session.get("created_at"))
                return {"session": session, "items": items}
    except db.OperationalError:
        return {}
    except db.DBError as e:
        if db.is_missing_table(e):
            return {}
        raise
