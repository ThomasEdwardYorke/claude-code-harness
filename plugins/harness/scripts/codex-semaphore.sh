#!/usr/bin/env bash
# codex-semaphore.sh — lock-dir-based semaphore that caps concurrent Codex
# review invocations from harness skills (`/parallel-worktree`,
# `/pseudo-coderabbit-loop`, etc.).
#
# Why this exists
# ---------------
# When 3+ harness subagents each spawn a long-running `node codex-companion.mjs
# task` in parallel, every subagent sits idle for 5-10 minutes waiting for
# its Codex result. Meanwhile the parent context accumulates Read/Grep
# noise and the eventual review JSON returned by each subagent is large
# enough to push the parent over the subagent context budget — observed
# 100% timeout / lost-result rate in production.
#
# This script lets harness skills serialize their Codex calls without
# inventing a per-skill polling loop. mkdir is atomic on POSIX
# filesystems (man 2 mkdir: "EEXIST: pathname already exists"), so a
# directory-as-lock pattern needs no flock and no extra binaries.
#
# Usage
# -----
#   codex-semaphore.sh acquire <max>     # blocks until slot 0..<max-1> is free,
#                                        # prints the slot id on stdout
#   codex-semaphore.sh release <slot>    # releases the named slot id
#   codex-semaphore.sh status            # prints number of currently held slots
#   codex-semaphore.sh -h | --help       # prints this usage text
#
# Environment
# -----------
#   HARNESS_CODEX_SEMAPHORE_DIR   override lock dir (default:
#                                 /tmp/harness-codex-sem-<USER>)
#   HARNESS_CODEX_SEMAPHORE_STALE_SECS
#                                 reap a slot if its marker file is older
#                                 than this many seconds (default: 1800,
#                                 30 minutes — long enough to outlive a
#                                 single Codex review, short enough to
#                                 recover from a crashed subagent within
#                                 one Pseudo CR cycle)
#   HARNESS_CODEX_SEMAPHORE_DEADLINE_SECS
#                                 give up `acquire` after this many seconds
#                                 of waiting (default: 3600, 1 hour). This
#                                 must be larger than the longest expected
#                                 Codex review duration multiplied by the
#                                 worker count over `max`. Long Codex
#                                 reviews are routinely 5–10 minutes; with
#                                 `max=1` and 3 workers queued, the third
#                                 worker can wait up to ~30 minutes before
#                                 acquiring, so a 30-minute deadline
#                                 (matching STALE_SECS) was previously too
#                                 tight. The deadline and the stale-reap
#                                 threshold are now independent.
#
# Exit codes
# ----------
#   0   on success (acquire prints slot id; release/status print result)
#   1   on usage error or invalid input
#   2   on internal failure (mkdir of LOCK_DIR fails, etc.)

set -euo pipefail

LOCK_DIR="${HARNESS_CODEX_SEMAPHORE_DIR:-/tmp/harness-codex-sem-${USER:-shared}}"
STALE_SECS="${HARNESS_CODEX_SEMAPHORE_STALE_SECS:-1800}"
DEADLINE_SECS="${HARNESS_CODEX_SEMAPHORE_DEADLINE_SECS:-3600}"

ensure_lock_dir() {
  if ! mkdir -p "$LOCK_DIR" 2>/dev/null; then
    echo "ERROR: codex-semaphore: failed to create LOCK_DIR=$LOCK_DIR" >&2
    exit 2
  fi
}

# reap_stale — remove slot dirs whose marker file is older than STALE_SECS.
# Uses `find -mmin` (POSIX-ish; supported on BSD/macOS and GNU find).
# Silent best-effort: rmdir failures (slot still contains marker file we
# don't own) are ignored.
reap_stale() {
  # mmin uses minutes; convert seconds -> ceil(minutes).
  local mmin=$(( (STALE_SECS + 59) / 60 ))
  # shellcheck disable=SC2044
  for slot_dir in "$LOCK_DIR"/slot-*/; do
    [ -d "$slot_dir" ] || continue
    if find "$slot_dir" -maxdepth 1 -type f -name 'pid-*' -mmin +"$mmin" 2>/dev/null | grep -q .; then
      # remove marker files first, then rmdir the slot.
      rm -f "$slot_dir"/pid-* 2>/dev/null || true
      rmdir "$slot_dir" 2>/dev/null && echo "REAPED stale slot $slot_dir" >&2 || true
    fi
  done
}

cmd="${1:-}"

case "$cmd" in
  acquire)
    max="${2:-}"
    if ! [[ "$max" =~ ^[0-9]+$ ]] || [ "$max" -lt 1 ]; then
      echo "ERROR: codex-semaphore acquire requires <max> as integer >= 1 (got '$max')" >&2
      exit 1
    fi
    ensure_lock_dir
    # Bounded retry: each iteration is ~1s sleep, cap at DEADLINE_SECS
    # (separate from STALE_SECS — see env section above) so we cannot
    # block forever if peers leak slots and stale reaping is disabled.
    # The deadline must be wider than the slowest expected serialized
    # Codex review chain (e.g. max=1, 3 workers, 10-min review each
    # = 30 minutes of queued waiting) plus headroom.
    deadline=$(( $(date +%s) + DEADLINE_SECS ))
    while true; do
      reap_stale
      n=0
      while [ "$n" -lt "$max" ]; do
        if mkdir "$LOCK_DIR/slot-$n" 2>/dev/null; then
          # Marker file lets `reap_stale` find this slot via mtime.
          # Use $$ in the name so concurrent acquires from the same
          # process can be distinguished if needed.
          : > "$LOCK_DIR/slot-$n/pid-$$"
          echo "$n"
          exit 0
        fi
        n=$((n + 1))
      done
      if [ "$(date +%s)" -ge "$deadline" ]; then
        echo "ERROR: codex-semaphore acquire timed out after ${DEADLINE_SECS}s (max=$max). Hint: increase HARNESS_CODEX_SEMAPHORE_DEADLINE_SECS or check for leaked slots in $LOCK_DIR." >&2
        exit 2
      fi
      sleep 1
    done
    ;;

  release)
    slot="${2:-}"
    if ! [[ "$slot" =~ ^[0-9]+$ ]]; then
      echo "ERROR: codex-semaphore release requires <slot> as non-negative integer (got '$slot')" >&2
      exit 1
    fi
    # Best-effort: missing slot is fine (idempotent release).
    rm -f "$LOCK_DIR/slot-$slot"/pid-* 2>/dev/null || true
    rmdir "$LOCK_DIR/slot-$slot" 2>/dev/null || true
    exit 0
    ;;

  status)
    ensure_lock_dir
    # Count how many slot-* dirs are currently held.
    # `2>/dev/null` so the empty case doesn't print spurious errors.
    held=$(find "$LOCK_DIR" -maxdepth 1 -type d -name 'slot-*' 2>/dev/null | wc -l | tr -d ' ')
    echo "$held"
    exit 0
    ;;

  -h|--help|"")
    cat <<USAGE
codex-semaphore.sh — limit concurrent Codex review calls via lock dir.

Usage:
  codex-semaphore.sh acquire <max>     block until a slot 0..<max-1> is free
  codex-semaphore.sh release <slot>    release a previously acquired slot
  codex-semaphore.sh status            print number of currently held slots

Env:
  HARNESS_CODEX_SEMAPHORE_DIR        override lock dir
  HARNESS_CODEX_SEMAPHORE_STALE_SECS reap stale slot after N seconds
                                     (default 1800)
USAGE
    [ -z "$cmd" ] && exit 1 || exit 0
    ;;

  *)
    echo "ERROR: codex-semaphore: unknown subcommand '$cmd' (use acquire / release / status / --help)" >&2
    exit 1
    ;;
esac
