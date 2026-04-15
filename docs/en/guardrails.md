# Guardrails R01–R13

Each rule lives in `plugins/harness/core/src/guardrails/rules.ts` as a
declarative `(toolPattern, evaluate)` pair. Rules run in order; the first
to return non-null wins.

| ID | Decision | Scope | Description |
|----|----------|-------|-------------|
| R01 | `deny` | Bash | Blocks `sudo` |
| R02 | `deny` | Write/Edit/MultiEdit | Blocks writes to `.git/`, `.env`, private keys, `.pem`/`.key`/`.p12`/`.pfx`, `authorized_keys`, `known_hosts` |
| R03 | `deny` | Bash | Blocks shell redirects/tee to the same protected paths |
| R04 | `ask` (bypass in work mode) | Write/Edit/MultiEdit | Confirms writes outside the project root |
| R05 | `ask` (bypass in work mode) | Bash | Confirms `rm -rf` / `rm -fr` / `rm --recursive` |
| R06 | `deny` (no bypass) | Bash | Blocks `git push --force` / `--force-with-lease` / `-f` |
| R07 | `deny` (codex mode) | Write/Edit/MultiEdit | Blocks Claude writes while `HARNESS_CODEX_MODE` is on |
| R08 | `deny` (reviewer role) | Write/Edit/MultiEdit/Bash | Reviewer role cannot mutate files or run destructive Bash |
| R09 | `approve + warning` | Read | Warns on reads of `.env`, `id_rsa`, `.pem`, `.key`, `secrets*/` |
| R10 | `deny` | Bash | **Configurable** — blocks deletion of `protectedDirectories` |
| R11 | `deny` | Bash | **Configurable** — blocks `protectedEnvVarNames` appearing in commands |
| R12 | `deny` | Bash | Blocks `curl \| bash`, `wget \| sh`, `curl \| zsh` |
| R13 | `deny` | Bash | **Configurable** — blocks `cat`/`head`/`tail`/etc on `protectedFileSuffixes` |

## Defaults are safe

R10 and R11 and R13 are the only rules that need project-specific input.
Their defaults (`protectedDirectories: []`, `protectedEnvVarNames: [...]`,
`protectedFileSuffixes: [".env"]`) are designed so that a fresh install
behaves identically to a project that never changes the config, with one
exception: the default `protectedEnvVarNames` includes globally known
secret names (OPENAI, ANTHROPIC, AWS, GitHub, Google) so commands like
`echo $OPENAI_API_KEY` are denied out of the box.

## Work mode

`$HARNESS_WORK_MODE=1` (or `$ULTRAWORK_MODE=1`) relaxes R04 and R05. R06
(force push) is never relaxed, even in work mode.

## Codex mode

`$HARNESS_CODEX_MODE=1` activates R07. The intent is that when Codex is
doing the writing, Claude should not also write — use R07 to stop
accidental writes during PM-style delegation.

## Extending guardrails

The rule table is a `readonly GuardRule[]`. To add a rule, append a new
entry with a unique `id`, a `toolPattern`, and an `evaluate` function. Add
unit tests to `core/src/guardrails/__tests__/rules.test.ts`.

The tampering detector (`core/src/guardrails/tampering.ts`) is a separate
catalog T01–T12 driven by `harness.config.json:tampering.severity`.
