---
"@markopack/core": patch
---

Tree-kill spawned dev processes

`spawnServer` shells out (`shell: true`), so a plain `proc.kill()` only
signalled the shell — its children (the actual dev server) survived as
orphans. The child now gets its own process group (`detached` on unix)
and `close()` delegates to `closeSpawnedProcess`, which signals the whole
group (SIGTERM, then SIGKILL).
