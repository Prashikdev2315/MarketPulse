"""FastAPI application entry point.

Loads environment, wires up routers, configures CORS, and exposes
health/root endpoints. Logging is configured at import time so every module
that calls ``logging.getLogger(__name__)`` picks up the same format.
"""
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

# Load .env BEFORE importing routers so services can read env vars.
load_dotenv()

# ── Logging ───────────────────────────────────────────────────────────────────
_LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
_log_format = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL, logging.INFO),
    format=_log_format,
)
logger = logging.getLogger("market_intelligence")

# Optional rotating file handler — activate with LOG_FILE=1 in your .env
if os.getenv("LOG_FILE", "0") == "1":
    import os as _os
    from logging.handlers import RotatingFileHandler
    _log_dir = _os.path.join(_os.path.dirname(__file__), "logs")
    _os.makedirs(_log_dir, exist_ok=True)
    _file_handler = RotatingFileHandler(
        filename=_os.path.join(_log_dir, "api.log"),
        maxBytes=5 * 1024 * 1024,   # 5 MB per file
        backupCount=3,               # keep api.log, api.log.1, api.log.2, api.log.3
        encoding="utf-8",
    )
    _file_handler.setFormatter(logging.Formatter(_log_format))
    logging.getLogger().addHandler(_file_handler)
    logger.info("Rotating file handler active → logs/api.log (5 MB × 3 backups)")

from routers import market, news, ai, stocks  # noqa: E402

# ── Rate limiting (slowapi — in-memory, per remote IP) ────────────────────────
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

limiter = Limiter(key_func=get_remote_address, default_limits=[])


# ── Lifespan (replaces deprecated @app.on_event) ─────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "AI Market Intelligence API starting (CORS origins: %s)", allow_origins
    )
    yield
    logger.info("AI Market Intelligence API shutting down")


# ── CORS ──────────────────────────────────────────────────────────────────────
_default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_env_origins = os.getenv("ALLOWED_ORIGINS")
allow_origins = (
    [o.strip() for o in _env_origins.split(",") if o.strip()]
    if _env_origins else _default_origins
)

app = FastAPI(
    title="AI Market Intelligence API",
    description="Backend for AI-powered financial market analysis platform",
    version="1.0.0",
    lifespan=lifespan,
)

# Attach limiter to app state BEFORE adding middleware so routers can access it.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(market.router)
app.include_router(news.router)
app.include_router(ai.router)
app.include_router(stocks.router)



# ── Health / Root ─────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "status":  "ok",
        "message": "AI Market Intelligence API",
        "version": "1.0.0",
        "docs":    "/docs",
    }


@app.get("/health")
async def health():
    gemini_configured = bool(
        os.getenv("GEMINI_API_KEY")
        and os.getenv("GEMINI_API_KEY") != "your_gemini_api_key_here"
    )
    return {
        "status":            "healthy",
        "gemini_configured": gemini_configured,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
