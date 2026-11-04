# Below the ash — continuous grain, closer Indonesia and smooth rain

Verified locally, 30 October 2026.

The stage now owns one continuous warm backdrop and one static operator-grain tile spanning top to bottom, including the shared haze. Main/cached map canvases are transparent outside Indonesian land and cleared correctly each frame. The former half-height background/grain cutoff is removed. The section sky has a longer soft mask that joins the common backdrop before its unchanged fire/material surface begins. No neighbouring country geometry is fetched or painted.

A separate studyMapRect centres 118°E/−2.5° and increases the original map scale by up to 20%, capped by a full-country fit with 24–34CSS-pixel normal margins. Projection and inverse geographic rain coordinates stay aligned. Original operator and phone fitting helpers remain unchanged. Operator fire, smoke, wet-ground behavior and all-source coverage are retained.

Rain now enters over 150 ms, with an immediate exact footprint and a few drops. On release, the last cohort falls downward and fades over 450 ms; no new drops wrap into its top. Main and section use one sampled visual history while raw gestures alone drive water/calming. Phone feedback uses the same envelope without a cloud. Same-ID preview/rain states, rapid represses and local priority are handled separately; old phone tails keep their positions on small temporary surfaces. Reduced motion uses immediate static feedback. Gesture/network timing and cancellation/reconnect/rotation rules are unchanged.

Verification:

- All 199 automated tests pass. Added/updated tests cover safe closer framing and inverse inputs, first-use canvas transparency, transparent sea, no neighbouring land/per-map grain, per-frame clearing, immediate feedback across 910 start times, monotonic visual envelopes, downward tail clearing, preview separation, rapid represses, reduced motion, local priority and bounded 256-contact history. Existing operator parity, side/depth, physics, phone and network tests remain passing.
- Browser screenshot inspection confirms no abrupt horizontal half-view edge, continuous grain, Indonesia-only geography and healthy map margins. CSS evidence confirms one full-stage grain layer with top/bottom 0 and pointer-events:none. The original operator assets and overlapping haze remain visible.
- Rain gestures were tested on a separate temporary room on port 4186 with persistence disabled. Main release showed holding=false while its visual tail still animated on both views. Phone release showed pouring=false/touching=false while eight remaining drops cleared. Two rapid distant presses retained two visual contacts plus one separate small tail surface. Final phone state is idle, zero drops/contacts/tail surfaces, and its callback count stayed fixed at 75. Main release settled cleanly. No test water was sent to port 4185.
- Final live room drawing p95: map8.60ms, side2.30ms, shared haze3.00ms, combined13.40ms. These measure drawing commands, not full GPU/compositor or physical touch latency. Actual IdeaPad, projector, router and audience phones still need rehearsal.
- Main and isolated main/phone consoles have no warnings/errors. The isolated room and temporary tabs were stopped/closed, and the updated main scene is retained visibly. No real-room restart, reset, settings change or snapshot refresh was performed.
- Main image/geography assets are now about 548 KB (441 KB country + 107 KB side atlas); the 185 KB neighbouring outline is removed. The stage grain is generated once and composited by CSS, with no per-frame noise generation. Rain stays on the existing bounded 30 fps main / 24 fps phone feedback clocks; temporary phone tail layers are removed after release.

Evidence:

- output/playwright/unified-scene-final.png — final actual scene
- output/coordination/unified-scene-browser.json — stage coverage, canvas metrics, idle state and logs
- output/coordination/unified-grain-rain-tests.txt — 199-test run
- output/playwright/rain-main-release.png / rain-phone-release.png — isolated release checks
- output/coordination/rain-main-release-final.json — final-code main release
- output/coordination/rain-phone-rapid.json — rapid-press tail positions

Earlier two-background and map-only grain captures are historical.
