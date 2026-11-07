karhutla 1.1.6 lets the remote operator start Main sound on a freshly opened host, when its browser permits autoplay.

- On Mac, launch with `node scripts/start-karhutla.mjs --remote-sound` from the extracted release folder. This opens a dedicated local Chrome profile with autoplay allowed after the server is ready. Install Google Chrome and Node.js LTS once before using this command.
- The remote's **Enable Main sound** button can then start the host audio without a first click on the Mac. Audio stays on the host; the remote controller stays silent.
- Sound still waits for an explicit Enable request. Opening or reconnecting a page does not replay an old request or start the timed performance.
- If an ordinary browser blocks activation, the request settles within six seconds and shows the host-enable fallback. A later disable, timeout or cancelled request cannot reopen the output.
- Main sound also remains available if Chrome first opens behind another window. Leaving the page still pauses its audio, and phones retain their normal visibility behavior.
- Main sound retains its normal smooth fades and shared mixer settings. PIN authorization, remembered devices and audience sound activation are unchanged.

The full source suite passed 845 checks with no failures and one Windows-only check skipped on Mac. See the [Mac setup instructions](https://github.com/steviejsutanto/karhutla/blob/main/docs/mac.md#enable-main-sound-from-the-remote-page) for remote sound mode. Default launching still uses your default browser and may require one host click to enable sound.

Windows, Apple Silicon and Intel downloads include the saved rehearsal preset and illustrated Mac approval PDF. Extract an update into a new folder and import your settings through **Operator → Setup → Settings file**. Keep Terminal and the host Operator open while performing. Earlier tested ZIPs are unchanged; all 1.1.5 improvements remain included.
