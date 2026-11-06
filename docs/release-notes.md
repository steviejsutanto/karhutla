karhutla 1.1.0 brings the latest rehearsal updates into the Windows and Mac downloads.

- Phones now show a finite rainwater supply with automatic refill and a 2× aiming magnifier. Shared joining instructions and reconnect behavior are updated.
- Scene 4 transfers a gently distorted drone to phones. The ending adds steady phone crickets and occasional bird calls, with independent Main-only orangutan controls.
- Main stereo placement is wider, held tones move more gently, and Main mute/unmute fades smoothly.
- The previous rain and haze selections are retained, alongside the newer steady phone cricket and revised phone ending balance. All playback recordings and source attribution are included.

Fresh installations use 54% audience rain and a 52-second Final rain rise. Imported or previously saved settings retain their values. Existing 1.0.3 settings files remain compatible; the two new orangutan controls start at 100% when absent from an older file.

Your current rehearsal mixer, performance and timing settings are included as **presets/current-performance.json**. Import that file through **Operator → Setup → Settings file** to use the captured settings. Its Wi-Fi fields are blank; enter venue Wi-Fi details after importing.

Choose **windows-x64**, **macos-arm64** (Apple Silicon), or **macos-x64** (Intel). Extract the whole ZIP into a new local folder, stop the previous version, then run **Start-Karhutla.cmd** on Windows or **Start-Karhutla.command** on Mac. Import your exported settings through **Operator → Setup → Settings file**.

The matching runtime, recordings, visuals and satellite snapshot are included; no separate Node installation is needed. Existing first-run scene and Windows browser-opening fixes are retained. Mac first-open instructions are in **docs/mac.md**.

Fully reload Operator, Projection and phones after changing versions so their code and decoded recordings refresh. Rehearse the new version with the actual audio output, projector, router and audience phones. Keep the previous rehearsed release available.
