karhutla 1.1.3 includes the five performance recovery fixes and the completed remote Main-sound controls.

- Phones can enable or resume sound during blackout and fullscreen; working phones and the completed ending remain black.
- Transient recording downloads retry, and manual sound recovery can retry exhausted failures, including crickets.
- Map and texture failures retry automatically. A Retry map control restores participation after persistent failure without reloading.
- Rain strength and ground timing edited before the first Start are saved without starting the performance.
- An empty fire snapshot completes the Final rain rise and ending instead of stalling.
- Remote Main-sound controls preserve host-only audio playback and report its current status. A browser gesture on the host is still required for initial audio activation when the browser requests it.

These fixes begin with **1.1.3**; older downloads are unchanged. The Mac launcher still prefers installed Node.js 22 or newer, with the bundled runtime as fallback. The illustrated Mac setup PDF remains included and available separately.

The combined handoff passed 806 tests, with no failures and one Windows-only check skipped on Mac. Real-browser recovery checks and three isolated 50-participant simulations passed, including reconnects, pause/resume and a three-minute rain/recharge run. Measurements were made on an M1 Pro, not the target M4 Mac mini or 50 physical phones. Aggressive country-wide swipes remain the heaviest workload and can reduce visual smoothness; rehearse on the actual router, projector, audio output and phones.

Extract the matching Windows, Apple Silicon or Intel ZIP into a new folder. Import your settings through **Operator → Setup → Settings file**, then fully reload Operator, Projection and phones. Private performance saves, Wi-Fi exports, operator PINs and keys are excluded from the downloads. Keep the previous rehearsed release available.
