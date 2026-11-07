karhutla 1.1.7 opens Projection automatically in full screen when using Mac remote sound mode.

Run this command from the extracted release folder, with Chrome and Node.js installed:

```sh
node scripts/start-karhutla.mjs --remote-sound
```

- After the server passes its startup check, Operator opens in its own normal Chrome window and Projection opens in a separate full-screen window.
- Projection uses a separate local Chrome profile so its full-screen startup does not change Operator's window. Neither profile needs Google sign-in.
- Main sound stays on Operator and waits for **Enable Main sound** on the host or remote controller. Projection stays silent, and the timed performance still waits for its Start control.
- `--no-browser` suppresses both windows. Normal launching without `--remote-sound` keeps its existing behavior.
- If a window could not open, Terminal provides both local addresses and retry guidance. If Projection appears on the wrong display, leave full screen, move it to the projector, then enter full screen again.

The full source suite passed 848 checks with no failures and one Windows-only check skipped on Mac. Native Mac Chrome verification checked separate normal Operator and full-screen Projection windows, silent Projection, and remote activation of Main sound without a host click.

See the [Mac setup instructions](https://github.com/steviejsutanto/karhutla/blob/main/docs/mac.md#enable-main-sound-from-the-remote-page). Extract updates into a new folder, stop the previous server, and import your saved settings through **Operator → Setup → Settings file**. The saved rehearsal preset and illustrated Mac approval PDF remain included. All 1.1.6 sound-control improvements are retained.
