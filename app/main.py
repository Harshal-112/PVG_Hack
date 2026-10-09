"""FastAPI application entrypoint. Owned by [P2]."""

from fastapi import FastAPI

app = FastAPI(title="FlashSeat")


@app.get("/healthz")
async def healthz():
    return {"ok": True}
