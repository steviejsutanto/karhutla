karhutla 1.1.2 makes Mac setup simpler.

**Start-Karhutla.command** now tries a working installed Node.js 22 or newer first, including the usual Homebrew and official-installer locations. It starts the performance directly with that installation and leaves the bundled runtime and its cache alone. Older or non-working installations are skipped; if no compatible Node is found, the existing bundled-runtime fallback still works offline.

Install Node.js LTS once with the official macOS installer, extract the Karhutla ZIP, then double-click **Start-Karhutla.command**. macOS may still ask you to approve the downloaded launcher in **System Settings → Privacy & Security → Open Anyway**. Installing Node does not remove that launcher approval. An unapproved Node installation or the bundled fallback may still need its own approval.

The shorter README links to **docs/mac-setup.md**, a step-by-step illustrated guide using Apple’s example approval screens. The guide and pictures are included in each download.

Choose **macos-arm64** for Apple Silicon, **macos-x64** for Intel, or **windows-x64** for Windows. Windows startup and performance behavior are unchanged. Your included rehearsal preset remains **presets/current-performance.json**; import it through **Operator → Setup → Settings file**, or import your own private export.
