# Load Testing (k6)

Owned by [P4].

## Running k6 Load Tests

Run the engine test:

```bash
docker compose --profile loadtest run --rm k6 run /loadtest/k6_flash.js
```

Run the baseline test:

```bash
docker compose --profile loadtest run --rm k6 run /loadtest/k6_baseline.js
```
