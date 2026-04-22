# `docs/media/`

Assets referenced from the top-level `README.md` — the 60-second setup
demo, primarily.

## What lives here

| File | Source of truth | Regenerate with |
|---|---|---|
| `demo.cast` | [`record-demo.sh`](record-demo.sh) | `asciinema rec --command "./docs/media/record-demo.sh" docs/media/demo.cast` |
| `demo.gif` | `demo.cast` | `agg docs/media/demo.cast docs/media/demo.gif` |

## Regenerating the demo

1. **Clean state.** The script assumes Docker is running, the repo is
   freshly cloned, and no previous `agent-memory` container is up.

   ```bash
   docker compose down --volumes
   ```

2. **Record.** Pick your preferred format:

   - **asciinema** (preferred — text-based, tiny, searchable):

     ```bash
     asciinema rec --overwrite \
       --command "./docs/media/record-demo.sh" \
       docs/media/demo.cast
     ```

   - **GIF** (better for GitHub README rendering):

     ```bash
     agg --theme=asciinema \
       docs/media/demo.cast \
       docs/media/demo.gif
     ```

3. **Verify.** Target runtime is ~40 seconds. If your recording is
   significantly longer, tune the pauses:

   ```bash
   TYPEWRITER_DELAY=0.03 PAUSE_SHORT=0.8 PAUSE_LONG=1.8 \
     asciinema rec --command "./docs/media/record-demo.sh" docs/media/demo.cast
   ```

4. **Commit.** The `demo.cast` file is small (a few KB) and text-based
   — safe to check in. The `demo.gif` is larger (~500 KB) but
   self-hosted is still preferable over third-party embedding for
   long-term availability.

## Why a driver script, not a hand-recorded cast

The script makes the demo **reproducible**. When the CLI output format
changes, the next contributor can regenerate the cast in 60 seconds
without hunting down the exact keystrokes that were in the original
recording. Same reason `npm run docs:cli` generates the CLI reference
appendix.

## Tooling

- [`asciinema`](https://docs.asciinema.org/getting-started/) — terminal recorder (~5 MB, `brew install asciinema`)
- [`agg`](https://github.com/asciinema/agg) — asciinema → GIF converter (Rust, optional)
