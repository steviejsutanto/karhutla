karhutla 1.0.3 fixes the first-run performance controls and Windows browser opening.

On a new installation, **Start timed performance**, every scene button (including Forest takeover and Final rain), and **Restart performance** now prepare the landscape automatically. Prepared mixer balances, timings, rain strength and audience information are retained. Existing initialized performances keep their progress during normal scene changes.

The Windows launcher now opens the Operator address with corrected command quoting. If the default browser cannot open, the server keeps running and prints the address for manual use.

Choose the ZIP for your computer: **windows-x64**, **macos-arm64** (Apple Silicon), or **macos-x64** (Intel). Extract the whole ZIP and double-click **Start-Karhutla.cmd** on Windows or **Start-Karhutla.command** on Mac. The runtime and all playback assets are included.

Export your settings from **Operator → Setup → Settings file** in the old version and import them in the new version. Keep the previous version available, and stop it before starting the new one.

Fresh-install regression checks exercise the ordinary Start, scene and Restart controls without a direct initialization call. Native Windows checks also exercise the browser-opening command through the actual Windows command parser. All platform packages are checked before publication.
