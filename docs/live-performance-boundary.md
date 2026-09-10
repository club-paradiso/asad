# ASAD Live performance boundary before two-lane work

Incremental pre-handoff work is complete when this change reaches production:

1. quota-dead cloud turns are bypassed when a real ready Chrome Translator can carry the turn;
2. production `ultra-compact` routing uses a compact safety-preserving system contract;
3. the live benchmark measures the same prompt-selection path production uses;
4. transcript-free shared latency telemetry is present;
5. the next unresolved performance problem is architectural: cloud completion is still on the first-English critical path when cloud-first behavior is used.

Do not keep reducing stabilizer windows or deleting prompt safety rules without production telemetry. The next major change belongs in the bounded two-lane design described in `docs/claude-live-two-lane-handoff.md` and `docs/claude-live-two-lane-ultimate-prompt.md`.
