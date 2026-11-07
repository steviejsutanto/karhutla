karhutla 1.1.7 opens Projection automatically and enters Karhutla's in-app full-screen view when using Mac remote sound mode.

Run this command from the extracted release folder, with Chrome and Node.js installed:

```sh
node scripts/start-karhutla.mjs --remote-sound
```

- After the server passes its startup check, Operator opens normally and Projection opens separately. When its visuals are ready, Projection invokes the same stage full-screen action as its **Project fullscreen** button.
- Projection's separate local Chrome profile grants automatic full-screen permission for the local server address. Neither Chrome profile needs Google sign-in.
- Escape leaves full screen and stays out; the app button remains available for manual entry or recovery. If Projection appears on the wrong display, leave full screen, move it to the projector, then enter full screen again.
- Main sound stays on Operator and waits for **Enable Main sound** on the host or remote controller. Projection stays silent, and the timed performance still waits for its Start control.
- `--no-browser` suppresses both windows. Normal launching without `--remote-sound` keeps its existing behavior. Terminal provides manual addresses and retry guidance if a window cannot open.

The full source suite passed 862 checks with no failures and one Windows-only check skipped on Mac.

See the [Mac setup instructions](https://github.com/steviejsutanto/karhutla/blob/main/docs/mac.md#enable-main-sound-from-the-remote-page). Extract updates into a new folder, stop the previous server, and import your saved settings through **Operator → Setup → Settings file**. The saved rehearsal preset and illustrated Mac approval PDF remain included. All 1.1.6 sound-control improvements are retained.
