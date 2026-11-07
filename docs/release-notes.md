karhutla 1.1.4 includes the verified remote-control, sound and phone-interface refinements.

- Remote Main-sound controls no longer create a status-feedback loop. A host that does not finish responding produces a bounded warning after about eight seconds instead of leaving the button pending indefinitely.
- Held tones have more audible motion after their first four seconds, with a faster rise into the modulation.
- Individual Main bell notes have revised calibration trims for a more balanced note family.
- The phone magnifier paints the first touch immediately and follows the initial drag more promptly.
- Each phone chooses a drone register at its current pitch, +3, +8 or +12 semitones. The choice stays fixed through mute/resume and scene re-entry for that page session; reloading may choose again.
- Restart performance is now in the main Performance tab beside Pause. It retains its existing reset behavior and preserves settings.
- The operator PIN and remembered-device key are stored per user outside the release folder, so later updates on the same computer/account reuse them. Existing app-local credentials migrate when available; another computer or user account has its own PIN.

The final combined source handoff passed 826 checks, with no failures and one Windows-only check skipped on Mac. Native audio and browser verification covered the tone, bell, magnifier, drone-register and Restart changes. The remote-control fix was also checked with 50 active participant WebSockets; this was software verification, not a physical venue rehearsal.

These changes are included in the **1.1.4 downloads**. Retained older ZIPs are unchanged. The five performance-recovery fixes from 1.1.3 remain included.

Extract the matching Windows, Apple Silicon or Intel ZIP into a new folder, import your settings through **Operator → Setup → Settings file**, and fully reload Operator, Projection and phones. The Mac launcher still prefers installed Node.js 22 or newer, with the bundled runtime as fallback. The illustrated Mac setup PDF remains available in each download and separately. Keep the previous rehearsed release available.
