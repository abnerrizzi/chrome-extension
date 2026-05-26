import tomllib
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ingest, scrape, sessions

_pyproject = tomllib.loads((Path(__file__).resolve().parent.parent / "pyproject.toml").read_text())
__version__ = _pyproject["project"]["version"]

app = FastAPI(
    title="Modular Ingest API",
    version=__version__,
    description="Recebe payloads scraped do Chrome MV3 e valida com modelo Pydantic gerado dinamicamente por domínio.",
)

# Permite apenas chamadas vindas da extensão (chrome-extension://*) e desenvolvimento local.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*|http://localhost(:\d+)?",
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(ingest.router, prefix="/api/v1")
app.include_router(scrape.router, prefix="/api/v1")
app.include_router(sessions.router, prefix="/api/v1")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
