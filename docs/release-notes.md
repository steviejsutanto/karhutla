karhutla 1.0.2 adds self-contained Mac downloads alongside Windows. Application behavior and shared settings remain compatible with earlier releases.

Choose the ZIP for your computer:

- **macos-arm64** — Apple Silicon (M-series Macs).
- **macos-x64** — Intel Macs.
- **windows-x64** — Windows PCs.

Extract the whole ZIP to a writable local folder. Double-click **Start-Karhutla.command** on Mac or **Start-Karhutla.cmd** on Windows. The matching runtime, dependencies, recordings, visuals and a satellite snapshot are included. No separate Node installation is needed. The performance works offline; fetching a new snapshot needs internet.

Mac downloads preserve executable permissions. If macOS blocks the first launch, follow **docs/mac.md** and Apple's first-open approval instructions. Keep the Terminal/launcher window open while performing; Ctrl+C stops and saves.

Use **Operator → Setup → Settings file** to export settings from the previous computer/version and import them into this one. Private settings and running performance saves are not included in downloads.

Each platform package is built and checked on its native architecture before publication. Automated checks cover startup, pages, recordings, QR generation and settings transfer. Rehearse the actual laptop, audio output, router, projector and phones before an event. Keep the previous rehearsed version available.
