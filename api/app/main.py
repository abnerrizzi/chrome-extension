from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ingest

app = FastAPI(
    title="Modular Ingest API",
    version="0.1.0",
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


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
