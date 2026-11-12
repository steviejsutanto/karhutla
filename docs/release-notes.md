karhutla 1.1.9 makes the remote Operator page lighter for Android phones and other remote controllers.

- **Lightweight controls:** the remote page opens without loading the landscape. Scene cues, mixer, Main sound and Setup controls stay connected directly to the host.
- **Optional preview:** choose **Show landscape preview** to see or rain on the map. The silent preview uses economy rendering at 10 fps and pauses painting while offscreen or in Setup. **Hide landscape preview** closes it while the controls stay connected.
- **Host sound and Projection:** Main sound stays on the host Operator. Its preview remains attached across workspace changes, and standalone Projection retains its normal rendering and in-app fullscreen behavior.
- **Settings and fire data:** export/import, PIN pairing, reconnects and mixer synchronization work with the remote preview closed. All sound refinements, phone transitions and offline fire-data transfer from 1.1.8 are included.

Downloads are available for **Windows x64**, **Mac Apple Silicon**, and **Mac Intel**, each with its launcher and offline runtime. Packages are built and checked on their matching platforms. The source suite passed 936 checks with no failures and one Windows-only check skipped on Mac. Performance and interaction checks used throttled desktop Chromium with a phone viewport; physical Android verification remains pending.

To update:

1. In your current Operator, use **Setup → Settings file → Export settings**. To keep the exact current fire observations too, also choose **Setup → Fire data → Export fire data**.
2. Stop the old server with **Ctrl+C in its Terminal or command window**.
3. Extract the new download into a new folder and open **Start-Karhutla.cmd** on Windows or **Start-Karhutla.command** on Mac.
4. Import your settings through **Setup → Settings file**. Import any saved fire-data file through **Setup → Fire data**.
5. Reload the Android phone's `/operator-remote` page to load the new controls from the updated host. The landscape preview starts closed.

Settings files and fire-data files are separate. If your older version has no fire-data export button, keep its folder and use its `data/fire-snapshot.json` file for the new Fire data import.

The saved rehearsal preset and illustrated Mac setup guide are included. Export your current settings to carry your latest adjustments. On Mac, installed Node.js 22 or later is preferred, and macOS may still require first-open approval for the unsigned launcher; see the [simple Mac setup instructions](https://github.com/steviejsutanto/karhutla/blob/main/docs/mac.md). Remote Main sound and automatic in-app Projection fullscreen remain available with:

```sh
node scripts/start-karhutla.mjs --remote-sound
```
