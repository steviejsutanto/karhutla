karhutla 1.1.1 improves first-open approval on Mac updates.

The Mac launcher now keeps a reusable copy of Node in **~/Library/Application Support/Karhutla/RuntimeCache**. Updates containing the same runtime verify and reuse that file without replacing it or resetting its first-open approval.

The first launch using this arrangement may still require **Open Anyway** for both **Start-Karhutla.command** and **node** in **System Settings → Privacy & Security**. After approving Node, run the launcher again. Future downloaded launchers may still require approval; Node should require it again only when its binary changes or the cache is removed. The package preserves quarantine and macOS security settings. It is not a notarized application.

Choose **macos-arm64** for Apple Silicon or **macos-x64** for Intel. Extract the whole ZIP into a new local folder. Import your exported settings through **Operator → Setup → Settings file**. The included rehearsal preset remains **presets/current-performance.json**, with blank Wi-Fi fields.

The release also includes the completed rehearsal updates:

- Remote Operator at **/operator-remote**, with a six-digit PIN and remembered device access. Host audio stays on the performance computer.
- Independent phone mixer controls and smoother scene transitions that retain your manual mix.
- A higher, more pronounced phone drone, continuous heavy-rain loops and a smoother Main orangutan release.

Existing settings files remain compatible. Remote-control PINs, private keys and running performance saves are excluded from GitHub and release downloads. Keep the previous rehearsed release available.
