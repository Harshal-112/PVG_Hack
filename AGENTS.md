# AGENTS.md (rules for every AI agent working in this repo)

You are working on FlashSeat, a 24-hour hackathon project. Read `SPEC.md` completely before doing anything.

## Non-negotiable rules

1. `SPEC.md` is the only source of truth. Endpoints, Redis keys, Lua return codes, env var names, table names, file paths, and function signatures MUST match it exactly.
2. Do not invent anything the spec does not define. If something is missing or ambiguous, write a `TODO(question): ...` comment, tell the human, and continue with the part that is clear. Do not guess.
3. Edit ONLY the files owned by your role (SPEC.md section 4). If you need a change in someone else's file, tell the human instead of editing it.
4. Never change function signatures, endpoint shapes, or Lua return codes. Other people are coding against them right now.
5. Inventory changes happen ONLY inside the Lua scripts. Never write Python that reads inventory state and then writes it back (no check-then-set).
6. Do not add dependencies, frameworks, or tools that are not in SPEC.md section 3. No npm, no React, no ORM.
7. Before using a library API, check the installed version (`pip show <pkg>`) and use only methods that exist in that version. Do not rely on memory of the API.
8. Never claim something works unless you ran it and saw the output. After each task, run the verification command given in your prompt and paste the real result.
9. Keep the code simple and readable. No premature abstractions, no extra features, no speculative "nice to have" code.
10. Small, working increments. After each increment the project must still start with `docker compose up --build`.
11. Secrets are not needed here. Never commit `.env` (only `.env.example`).

## Definition of done for any task

- Code runs, the stated verification command passes, and the relevant rows of SPEC.md section 13 are satisfied.
- A short note of what you did, what you verified, and what is still open.

## If you get stuck

Stop and report: what you tried, the exact error, and what you think the cause is. Do not work around a spec contract to make a test pass.
