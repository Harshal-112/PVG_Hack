"""FastAPI application entrypoint. Owned by [P2]."""

from contextlib import asynccontextmanager
from pathlib import Path
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.config import settings
from app.metrics import REQUEST_LATENCY_SECONDS
from app.ratelimit import APIException
from app.redis_client import close_redis, get_redis
from app.services.inventory import InventoryService
from app import db
from app.routes import admin, baseline, events, reservations, waiting_room, waitlist


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize db connection pool and schema
    try:
        await db.init_pool()
    except NotImplementedError:
        pass

    # Initialize redis and InventoryService only if not already injected (e.g. in tests)
    if not hasattr(app.state, "inventory") or app.state.inventory is None:
        try:
            redis = get_redis()
            inventory = InventoryService(
                redis=redis,
                hold_ttl_ms=settings.HOLD_TTL_MS,
                rl_capacity=settings.RL_CAPACITY,
                rl_refill_per_sec=settings.RL_REFILL_PER_SEC,
            )
            app.state.inventory = inventory
        except Exception:
            pass

    yield

    # Teardown on shutdown
    try:
        await db.close_pool()
    except NotImplementedError:
        pass
    try:
        await close_redis()
    except Exception:
        pass


from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="FlashSeat", lifespan=lifespan)

cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(APIException)
async def api_exception_handler(request: Request, exc: APIException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "message": exc.message},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": "VALIDATION_ERROR", "message": str(exc)},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail, headers=exc.headers)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "HTTP_ERROR", "message": str(exc.detail)},
        headers=exc.headers,
    )


@app.middleware("http")
async def measure_request_latency(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start

    route = request.scope.get("route")
    route_name = route.path if route and hasattr(route, "path") else request.url.path
    REQUEST_LATENCY_SECONDS.labels(route=route_name).observe(duration)
    return response


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# Base path /api/v1 (per SPEC.md section 9)
app.include_router(reservations.router, prefix="/api/v1")
app.include_router(events.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(baseline.router, prefix="/api/v1")
app.include_router(waiting_room.router, prefix="/api/v1")
app.include_router(waitlist.router, prefix="/api/v1")

# Also mount at root for flexibility
app.include_router(reservations.router)
app.include_router(events.router)
app.include_router(admin.router)
app.include_router(waiting_room.router)
app.include_router(waitlist.router)

# Mount web/ at /ui
web_dir = Path(__file__).resolve().parent.parent / "web"
if web_dir.is_dir():
    app.mount("/ui", StaticFiles(directory=str(web_dir), html=True), name="ui")


@app.get("/")
async def root_index():
    index_file = web_dir / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return RedirectResponse(url="/ui/")
