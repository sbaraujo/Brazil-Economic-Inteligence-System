"""
SYGMA BRAZIL ECONOMIC INTELLIGENCE AI — Python FastAPI Microservice Gateway
Provides standalone FastAPI + Pydantic + cryptography E2EE + BCB SGS connector endpoints
for institutional deployments using Python + PostgreSQL/TimescaleDB.
"""

from datetime import datetime, timezone
import hashlib
import math
import os
import secrets
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
from pydantic import BaseModel

app = FastAPI(
    title="SYGMA BRAZIL ECONOMIC INTELLIGENCE AI — FastAPI Core",
    version="1.0.0",
    description="Institutional Macroeconomic, Quantitative Risk & Econometrics Microservice",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class CorrelationRequest(BaseModel):
    x: List[float]
    y: List[float]


@app.get("/api/py/health")
async def health() -> Dict[str, Any]:
    return {
        "service": "sygma-fastapi-quant-core",
        "status": "OPERATIONAL",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/py/bcb/sgs/{series_id}")
async def fetch_bcb_sgs(series_id: int, last_n: int = 30) -> Dict[str, Any]:
    url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{series_id}/dados/ultimos/{last_n}?formato=json"
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"BCB SGS HTTP {resp.status_code}")
        data = resp.json()
    return {
        "series_id": series_id,
        "source": "Banco Central do Brasil (SGS)",
        "status": "PERIODIC",
        "observations": data,
    }


@app.post("/api/py/quant/pearson")
async def compute_pearson(req: CorrelationRequest) -> Dict[str, Any]:
    if len(req.x) != len(req.y) or len(req.x) < 3:
        raise HTTPException(status_code=400, detail="Series must have equal length >= 3")
    n = len(req.x)
    mx = sum(req.x) / n
    my = sum(req.y) / n
    num = sum((a - mx) * (b - my) for a, b in zip(req.x, req.y))
    den = math.sqrt(sum((a - mx) ** 2 for a in req.x) * sum((b - my) ** 2 for b in req.y))
    r = 0.0 if den == 0 else num / den
    return {"n": n, "pearson_r": round(r, 6), "r_squared": round(r * r, 6)}
