---
"@markopack/rspack": minor
---

Expose the actual listening port on the dev server handle

`dev()` resolves to a `DevServer` that until now only had `close()`. The
requested port is a hint — the server bumps it when taken — so callers
(that is: test harnesses spawning dev servers at `port: 0`) had to guess.
The handle now carries `port` with the actual bound port (0 in pure-Marko
mode, where the user entry owns the port). Powering the new fixture-test
workspace (`test/`, `pnpm run test:fixtures`).
