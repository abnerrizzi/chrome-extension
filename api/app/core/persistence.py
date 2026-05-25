"""Persistência síncrona em Postgres via psycopg3.

Estratégia: 1 conexão por chamada de ingest (volume é baixo — uma extensão
mandando lotes manualmente). Em caso de DB indisponível ou migração não
aplicada, retorna `(None, motivo)` em vez de explodir, para que o request HTTP
responda 200 mesmo quando o banco está offline (o `persisted` no response
sinaliza o estado).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import psycopg

log = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL")


def persist(domain_id: str, items: list[dict]) -> tuple[Optional[int], Optional[str]]:
    """Insere a sessão e os itens. Retorna `(session_id, None)` em sucesso,
    `(None, motivo)` quando pulado por DB indisponível/migração faltando."""
    if not DATABASE_URL:
        return None, "DATABASE_URL not set"
    if not items:
        return None, "no items to persist"
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO scrape_sessions (domain_name, item_count) "
                    "VALUES (%s, %s) RETURNING id",
                    (domain_id, len(items)),
                )
                session_id = cur.fetchone()[0]
                _insert_items(cur, domain_id, session_id, items)
        return session_id, None
    except psycopg.OperationalError as e:
        log.warning("persistence skipped (db unreachable): %s", e)
        return None, f"db unreachable: {e}"
    except psycopg.errors.UndefinedTable as e:
        log.warning("persistence skipped (run liquibase update): %s", e)
        return None, "tables missing — run liquibase update"
    except psycopg.Error as e:
        log.exception("persistence failed")
        return None, f"db error: {e}"


def _insert_items(cur, domain_id: str, session_id: int, items: list[dict]) -> None:
    # ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE:
    # upsert via índice único parcial — itens sem external_id continuam
    # inserindo normalmente (sem dedup possível).
    if domain_id == "linkedin":
        cur.executemany(
            "INSERT INTO linkedin_jobs "
            "(session_id, external_id, job_title, company, location, url) "
            "VALUES (%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET "
            "  session_id=EXCLUDED.session_id, job_title=EXCLUDED.job_title, "
            "  company=EXCLUDED.company, location=EXCLUDED.location, url=EXCLUDED.url",
            [(session_id, it.get("external_id"), it.get("job_title"),
              it.get("company"), it.get("location"), it.get("url")) for it in items],
        )
    elif domain_id == "olx":
        cur.executemany(
            "INSERT INTO olx_listings "
            "(session_id, external_id, title, url, price_cents, currency, listing_kind, "
            " city, posted_at, image_url, iptu_cents, bedrooms, bathrooms, "
            " garage_spaces, area_m2) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET "
            "  session_id=EXCLUDED.session_id, title=EXCLUDED.title, url=EXCLUDED.url, "
            "  price_cents=EXCLUDED.price_cents, currency=EXCLUDED.currency, "
            "  listing_kind=EXCLUDED.listing_kind, city=EXCLUDED.city, "
            "  posted_at=EXCLUDED.posted_at, image_url=EXCLUDED.image_url, "
            "  iptu_cents=EXCLUDED.iptu_cents, bedrooms=EXCLUDED.bedrooms, "
            "  bathrooms=EXCLUDED.bathrooms, garage_spaces=EXCLUDED.garage_spaces, "
            "  area_m2=EXCLUDED.area_m2",
            [(session_id, it.get("external_id"), it["title"], it["url"],
              it.get("price_cents"), it.get("currency"), it.get("listing_kind"),
              it.get("location"), it.get("posted_at"), it.get("image_url"),
              it.get("iptu_cents"), it.get("bedrooms"), it.get("bathrooms"),
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
                "INSERT INTO auction_items "
                "(session_id, external_id, lot_code, title, current_bid_cents, "
                " auction_end, url) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET "
                "  session_id=EXCLUDED.session_id, lot_code=EXCLUDED.lot_code, "
                "  title=EXCLUDED.title, current_bid_cents=EXCLUDED.current_bid_cents, "
                "  auction_end=EXCLUDED.auction_end, url=EXCLUDED.url",
                rows,
            )


def fetch_recent_sessions(limit: int = 20) -> list[dict]:
    if not DATABASE_URL:
        return []
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=3) as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                cur.execute(
                    "SELECT id, domain_name, item_count, created_at "
                    "FROM scrape_sessions ORDER BY id DESC LIMIT %s",
                    (limit,),
                )
                return [
                    {**r, "created_at": r["created_at"].isoformat() if r["created_at"] else None}
                    for r in cur.fetchall()
                ]
    except (psycopg.OperationalError, psycopg.errors.UndefinedTable):
        return []


def fetch_session_items(session_id: int) -> dict:
    """Retorna itens daquela sessão, buscando na tabela correta pelo domain_name."""
    if not DATABASE_URL:
        return {}
    table_map = {
        "linkedin": "linkedin_jobs",
        "olx": "olx_listings",
        "auctions": "auction_items",
    }
    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=3) as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                cur.execute(
                    "SELECT id, domain_name, item_count, created_at "
                    "FROM scrape_sessions WHERE id=%s",
                    (session_id,),
                )
                session = cur.fetchone()
                if not session:
                    return {}
                table = table_map.get(session["domain_name"])
                if not table:
                    return {"session": session, "items": []}
                cur.execute(f"SELECT * FROM {table} WHERE session_id=%s ORDER BY id", (session_id,))
                items = [
                    {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()}
                    for r in cur.fetchall()
                ]
                session["created_at"] = session["created_at"].isoformat() if session["created_at"] else None
                return {"session": session, "items": items}
    except (psycopg.OperationalError, psycopg.errors.UndefinedTable):
        return {}
