# FlashSeat

High-Contention Flash-Reservation & Seat Inventory Locking Engine.

## Quickstart

Start the entire stack (Redis, Postgres, FastAPI app with 4 workers, Writer worker):

```bash
docker compose up --build -d
```

Verify service health:

```bash
curl http://localhost:8000/healthz
# Expected: {"ok": true}
```

View logs:

```bash
docker compose logs -f app
```

Stop the stack:

```bash
docker compose down
```

## Running Tests

Run unit & atomicity tests against running Redis:

```bash
pytest
```

## Load Testing

Run k6 load tests using the `loadtest` compose profile:

```bash
docker compose --profile loadtest run --rm k6 run /loadtest/k6_flash.js
```
