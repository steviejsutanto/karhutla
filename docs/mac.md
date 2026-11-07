# karhutla on Mac

For a quick start, use the [illustrated setup and approval guide](mac-setup.md).

## Choose your download

Open the [latest release](https://github.com/steviejsutanto/karhutla/releases/latest) while signed in to GitHub:

- **macos-arm64.zip** is for Apple Silicon Macs, including M1 and later M-series chips.
- **macos-x64.zip** is for Intel Macs.

Use **Apple menu → About This Mac** to check your chip or processor. Each ZIP includes libraries, recordings, visuals, a saved fire snapshot and a fallback Node runtime.

For simpler startup, install [Node.js LTS](https://nodejs.org/en/download) once with its **macOS Installer (.pkg)**. An existing Node 22 or newer also works. The launcher tries Node on your command path first, then the standard Homebrew and official-installer locations. Older or non-working installations are skipped. It uses the included runtime if no compatible installation is found.

## Start the performance

1. Download the matching Mac ZIP and double-click it in Finder to extract it.
2. Move the whole extracted folder to a writable local location, such as a Performances folder inside Documents. Keep each version in its own folder.
3. Double-click **Start-Karhutla.command**. Terminal opens and the launcher starts the server, checks it, then opens Operator in your default browser. Keep Terminal open while performing.
4. Start the timed performance or select any scene directly when ready. First use prepares the landscape automatically; no separate initialization step is needed.
5. Enable Main sound in Operator. Select the correct Mac audio output and check its level through your speakers or audio interface.
6. Use Operator's **Open projection** link, move that window to the projector, then make it fullscreen. Keep Operator open: it produces Main audio while Projection displays the image.
7. Connect the Mac and phones to the same router. Phones use the displayed QR code and audience address. Enable sound on each phone, then start the timed performance when ready.

If the browser does not open, use the Operator address printed in Terminal, normally <http://127.0.0.1:4173/operator>. If macOS asks about local-network or firewall access, allow it on your trusted performance network. Router client isolation must be disabled. Ethernet from the Mac to the router is preferable when available.

Press **Ctrl+C in Terminal** to stop and save. Restarting opens a paused Arrival scene while retaining saved settings and landscape progress. **Restart performance** resets the landscape and keeps your settings. An occupied port produces an error; the launcher leaves the other program alone.

The included performance works offline. **Fetch latest fires** requires internet and replaces the source landscape.

## Control from a phone, tablet or another computer

Connect the controller to the same Wi-Fi as the Mac and scan the audience QR code. In the browser address, change `/audience` to `/operator-remote`. On the host Mac, open **Operator → Setup → Remote control** and enter its six-digit PIN on the controller. The remote page controls the same scene cues, mixer and settings and receives live updates from the host.

Keep the Mac's Operator page open and keep the Mac awake. The remote speaker button controls Main sound through the Mac's selected output; the remote controller stays silent. The launcher and projector still run on the host. This also works without internet, provided the devices can reach each other on the router.

## Enable Main sound from the remote page

Use **remote sound mode** to let the remote's **Enable Main sound** button start the Mac's audio after a fresh launch, without clicking Enable on the Mac first.

1. Install Google Chrome and Node.js LTS on the Mac once.
2. Open Terminal. Type `cd `, including the space, drag the whole extracted Karhutla folder into Terminal, then press Return.
3. Run:

   ```sh
   node scripts/start-karhutla.mjs --remote-sound
   ```

4. Operator opens in its own Chrome window. Projection opens separately and automatically uses Karhutla's **Project fullscreen** action when its visuals are ready. Keep Terminal and both windows open. Connect the remote controller with its PIN, then click **Enable Main sound** there.

This starts the server, waits until it is ready, then opens both windows. Operator uses a local Chrome profile with autoplay allowed. Projection has its own local profile with automatic full-screen permission for this local server address. The projection stage itself enters full screen, using the same method as its in-app button. Neither profile needs Google sign-in; both are reused across updates on the same Mac user account. Your saved shared mixer settings apply on Operator. Sound and the timed performance still wait for your explicit controls, and Projection stays silent.

If Projection opens on the wrong display, leave full screen, move its window to the projector, then enter full screen again. The launcher does not select a physical display.

Press Escape to leave the projection's full-screen view; it will stay out until you use its full-screen button again. If automatic entry is blocked, that button remains available for manual entry.

When first updating to this feature, quit an older Projection Chrome instance before relaunching. If Terminal asks you to quit it, activate that Projection window and choose **Chrome → Quit Google Chrome**, then stop the server with Ctrl+C and run the command again. Later launches reuse an existing matching permission.

With the bundled Node fallback, the equivalent command is `./Start-Karhutla.command --remote-sound`; its normal first-open approvals still apply. The installed-Node command above does not use the downloaded `.command` launcher.

Ordinary launching still opens your default browser. If that browser blocks the remote's first Enable request, the remote shows that Main sound needs to be enabled on the host. A blocked start is bounded so the button becomes usable again. You can click Enable on the Mac or stop the server with Ctrl+C and relaunch in remote sound mode. If Chrome could not open, Terminal prints the host address and setup guidance.

Remote sound mode is a Mac launcher option. It does not change audience phones: each listener still enables sound on their own phone. [Chrome documents the autoplay startup option](https://developer.chrome.com/blog/autoplay); keep the performance browser for Karhutla.

Bookmark the simple `/operator-remote` address for future rehearsals. The browser remembers access for one year across browser and server restarts; clearing browser data requires entering the PIN again. Use **Refresh address** and update the bookmark if the router gives the Mac a different address. Both devices must still be on the same network. **Reset PIN & devices** disconnects remembered controllers and replaces the PIN. Keep the PIN private. Existing long private operator links remain supported.

The PIN and private key are saved outside the app folder in `~/Library/Application Support/Karhutla/remote-operator.json`. New release folders use that shared file automatically, retaining the PIN and remembered access for the same Mac user account. The first updated launch imports an existing app-local `data/remote-operator.json` if no shared credentials exist. No manual copying is needed for later updates. **Reset PIN & devices** replaces the shared credentials for future launches and updates. Another computer or user account has its own PIN. Credentials stay outside GitHub, release packages and settings exports.

## First-open approval

macOS may ask you to approve the downloaded launcher. If it blocks opening, first try launching it, then follow **System Settings → Privacy & Security → Open Anyway** when that option is offered for this file. Approve only the package you obtained from this project's GitHub release. [Apple's first-open instructions](https://support.apple.com/en-us/102445) explain the available prompts.

When using an already approved installed Node, the launcher does not start or copy the bundled Node. If the installed Node itself has not been approved, macOS may still ask about it. Installing Node does not remove the separate first-open approval for the downloaded launcher.

If no compatible installed Node is found, the launcher places its bundled runtime in **~/Library/Application Support/Karhutla/RuntimeCache**. If macOS also blocks **node**, use the same **Open Anyway** steps for Node, then run the launcher again. This approval applies to the reusable copy, so the first release using this arrangement may ask again even if you approved Node in an older release folder.

Future updates verify and reuse that exact Node file without replacing it. A new launcher may still need approval, but Node should need approval only when its binary changes or the runtime cache is removed. The package stays offline and includes its runtime. If a cache entry fails verification, the launcher stops and prints the specific cache folder to move to the Trash before retrying.

The launcher is a Terminal script, rather than a notarized Mac application. It preserves downloaded quarantine attributes and does not change macOS security settings. Avoiding the remaining verification warnings requires an Apple Developer ID and notarization. Automated checks verify runtime reuse and integrity, executable permissions and startup; first-open behavior also depends on the Mac's security settings.

## Move settings and update

Use **Operator → Setup → Settings file → Export settings** on the source computer. Copy the JSON file to the Mac, then choose **Import settings** in the same section. The same settings file works on Windows and Mac. It transfers mixer balances, texture controls, timings, ground response, rain strength, program notes and entered Wi-Fi details. It leaves the current scene position and landscape progress alone.

Keep that file private because it includes entered Wi-Fi details. Browser sound activation and the computer's selected audio output must be set on each machine. Saved performance state and exported settings stay outside GitHub and release downloads.

For an update, stop the old version with Ctrl+C, extract the new release into its own folder, and import your settings there. Keep the previous rehearsed ZIP available. Rehearse with the actual router, projector, PA and audience phones before an event.

## Compatibility and development

The bundled Node 24.22.2 runtime has a technical minimum of **macOS 13.5** for both architectures; use a macOS version still supported by Apple. See [Node's pinned platform requirements](https://github.com/nodejs/node/blob/v24.22.2/BUILDING.md#platform-list). Native package verification uses macOS 26 for Apple Silicon and macOS 15 for Intel.

The source checkout uses the same launcher with an installed Node 22 or newer. For a rehearsal with the exact bundled runtime, launch from Terminal with `KARHUTLA_USE_BUNDLED_NODE=1 ./Start-Karhutla.command`. See [the development guide](development.md) for source setup and packaging commands.
