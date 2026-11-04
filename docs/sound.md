# Sound, projection and phone rehearsal

Use `/operator` for all controls and its **speaker button** for Main sound. This
operator computer owns Main audio through its preview. `/projection` carries
the separate visual output and no visible sound button; switching tabs does
not mute Main. Audience members enable their own sound at `/audience`.
`/study` and `/study/phone` remain compatible aliases.

The operator opens in Performance. Mixer keeps all 13 layer levels and the
five texture-shaping controls beside the same preview; texture shaping starts
collapsed and shows Automatic or Manual mode. Setup contains timing, ground
response, audience information, source updates and Restart performance. View
changes leave the preview/audio engine and unsaved form drafts in place.

The work title is **karhutla**. Scene 1 shows the revised program notes and QR;
scene 2 shows the shortened instructions, with larger Wi-Fi credentials in both.
Ask listeners to turn off Silent Mode, tap the speaker button, and set a comfortable media
volume. Supported recent iPhone browsers also receive a playback-session request
when the speaker button is tapped; other browsers retain normal activation. This follows
[WebKit's Silent Mode guidance](https://bugs.webkit.org/show_bug.cgi?id=237322#c6).

## Start, timers and manual overrides

Start with **Restart performance** for fresh fire, then **Start timed
performance** when ready. Arrival stays paused until started. The server owns
the show clock, so page reloads and device clock differences do not advance
a separate copy. Pause/resume freezes and continues that clock.

| Scene | Default automatic duration | Main sound |
| --- | --- | --- |
| 1 Arrival | 60 seconds | New light haze; Title, program notes and QR on projection. Brief phone welcome, notes behind About. |
| 2 Instructions | 60 seconds | Instructions and QR on projection; haze becomes distant burning forest. |
| 3 Participation | 600 seconds | Low drone with thin haze, cooling tones, per-patch blobs and per-area bell/quench/material. |
| 4 Forest takeover | 60 seconds | Ground/fire return; distant forest dominates. |
| 5 Final rain | Through the complete ending | Gradual rain, blackout, PA crickets, then phones. |

Every scene button stays clickable, including the current cue. Clicking
immediately overrides the sequence and starts the selected scene at zero.
The selected cue then resumes its own automatic timer. The four durations
are editable in Performance timing, separately from sound-transition and
forest-restoration times. Automatic cue4 waits for restoration if a custom
restoration duration is longer than its scene timer. Manual cue5 from cue4
finishes forest restoration and starts rain immediately. Held rain continues to cool and extinguish in cue 4 while returning heat resists it. A real extinction is followed by a brief rest and gradual fire return, allowing another genuine cooling cycle. Tones, bells and materials remain audible under the dominant forest; the low drone fades out. Cue 5 begins from the actual wet ground without forcing a dry snapshot.

Delayed authority ticks are split at every cue boundary, preserving exact
water, restoration and rain-cooling timing. Timer edits do not retroactively
add rain. The show clock stays ephemeral: restoring a save never resumes a
performance without the operator.

## Main mixer and bells

The mixer has independent **Bells**, **Woodfire quench**, **After-extinction
textures**, **Extinction blobs**, Soft tones, Participation low drone, Haze, Burning forest, Ash,
Rain, Moisture and Crickets channels. Each trim is0–200%; Main output is the
shared master. Bells default to160% and quench to100%. Existing stored
balances remain intact; new channels receive their own defaults.

Bells cover C2/G2 through C7/G7, weighted toward the lower registers.
Decays are now 14/12/10/8/6/5 seconds from low to high. A softer 28 ms attack,
more sustained inharmonic partials and independent slow partial pitch/amplitude
movement retain bell material through the tail. The fundamental remains stable.
The earlier short partial envelopes had left a mostly pure sine during most
of the decay. Eight natural tails and eight short overflow fades are bounded;
retiring voices are never disconnected abruptly to admit a new strike.
The gentle 1.4-second bell room remains, including its cleanup-race fix.

## Once per extinguished rain area

One actual rain footprint is the event unit. Canonical source states and the
geographic brush determine its members: every fire center inside the real circular footprint. Partial fringe overlap still receives physical water, but an outside-center tangential sliver cannot block the entire completion event.
Small drags retain a coherent area; overlapping audience/local rain is grouped
without assigning a sound event to every tiny fire cell. A group must have
been observed hot under rain and then have all current members confirmed out.
Only then does Main start **one bell, one quench and one texture transition**.
All existing member tones join that one finite transition. Baseline-out cells
never create notes or old completion events. Released rain keeps a two-second
observation window for a late authoritative packet.

Repeat taps, tiny drags and a new gesture on the same extinguished area stay
quiet. Actual returning fire re-arms it; performance reset clears the claims.
Helper and audio member claims both enforce this rule. Muted, hidden, paused
and ineligible events are consumed instead of replaying on resume. Group
admissions are at least 100 ms apart, bounded and expire instead of accumulating
a delayed strike burst. The independent bell/quench sliders remain intact.

## Low drone and patch notes

The **D♭2/A♭2/E♭3 drone retains its original pitch banks**, with its original relative
amplitudes 0.72/0.24/0.34, 360 Hz low-pass and 0.05 layer level. It is duplicated
as a complete three-tone bank. The original bank stays fixed; the duplicate
moves downward gradually with confirmed cooling toward a perfect fourth
(frequency ×3/4), with four-second target tracking. Both banks start together
at half level, so their initial unison reproduces the original signal instead
of doubling its loudness. Six oscillators now use a subtly richer wave with second, third and fifth harmonics at 0.10/0.14/0.035 of the fundamental. The fundamental coefficient stays 1 and added unfiltered power is less than 0.2 dB. Both complete banks share the same waveform, retaining the gradual fourth descent;
the earlier two-pure-tone replacement has been removed. Returning heat brings
the duplicate back toward the original register.

Every source patch retains one fixed D♭ major pentatonic note across D♭1–D♭7
and its geographic position. D♭ stays anchored; E♭/F/A♭/B♭ use9/8,5/4,3/2,5/3
ratios. Offsets from equal tuning are0,+3.9,−13.7,+2.0,−15.6 cents and octaves
remain exact. The note emerges with confirmed ground cooling rather than
surface wetness alone, with0.3s tracking and0.012 peak. Several people on one
patch share its voice. Smooth tone crowd gain follows active people and
sounding patch keys; idle phones and sea gestures do not crowd the tone mix.

## Limited extinction material and stronger room

Each completed area uses its representative patch’s stable ash, moisture or
haze class, with four independent recordings per class. Nearby same-class
area events prefer different takes.
Distinct stable start phases, playback rates0.965–1.035 and gentle filtering
further separate reused recordings.

The texture bank now has a strict **eight-source limit** and **at least 100 ms
between new source starts**. Older unheard events receive fair priority;
queued events retain their original finite deadline. If a burst cannot be
served in time, excess events expire quietly instead of replaying late.
Windowed overload sources also respect the same limit and admission clock.
Texture headroom follows admitted native sources, not the pending queue.

About60% of patch identities receive a predetermined reverb send of0.28–0.46;
the rest are dry. Equal-power dry coefficients keep direct presence stable.
One shared room avoids a convolver per source. Dry and wet texture buses
share their own crowd envelope. The dry path retains its0.8 level and the
existing+6dB Main room return is preserved.

Default tone→texture morph remains8s, then a20s texture fade; the operator
can edit both. Events retain the timing selected at onset. Source removal,
reset and ending discard old events. The tone and material stay at one
spatial position. Filtered material targets remain near0.008 RMS ash,
0.00635 moisture and0.00898 haze before bus/crowd gains. Full settings and
volume balances persist independently of the automatic macros.

## Phone sound

Phone crackle is restored to the original thin **phone-branches-leaves**
recording. The fuller and newer alternatives remain archived in the catalog.
Phones play the global crackle/cricket bed and quiet natural light rain only
during an eligible touch or accessible Rain hold. Touch rain attacks over
**850 ms with rounded endpoints** and releases over **2.5 seconds** with the same gentle shape. One native recording continues
through dragging and rapid re-presses. An interrupted release resumes from
its current gain and phase; it does not stack a second loop or disconnect
an unfinished tail. A cancellable silent cleanup clock removes the source
only after its gain reaches zero. Idle rain gain and loop count are
zero. Connection or gesture eligibility loss releases with the same finite tail. Mute, hiding and ineligible scenes still stop it;
previous held gestures cannot replay on resume. Native circular loops and
constant makeup preserve field dynamics; no pumping compressor is added.

Normal participation insects still follow confirmed map-wide fire-out count:
very quiet after 45%, far→middle→near approach after 70%, and full cricket only
at complete extinction. At 300/527 only the far perspective is audible.
The finale withholds phone cricket until the PA-to-phone transfer below.
Cricket recordings prewarm silently during late cooling so the transfer
does not depend on simultaneous phone downloads. Phone media volume is local.

## Distant forest, smoke and continuous finale rain

The same current distant burning-forest processing is used in Instructions
and takeover:35Hz high-pass, broad+5dB low shelf at240Hz,1.5–2.4kHz low-pass
with moisture damping, and−9dB high shelf at1.8kHz. It emphasizes low body and
softens close crackles without sending the whole forest into the patch room.
Ground-ember→wind-through-flame interpolation remains available.

Map smoke is substantially broader, darker and denser, using the same three
country-scale emitters per patch and bounded drawing work. Terrain/hit areas,
map size, geography and the side-view ground profile remain unchanged.

Final rain now uses **one continuous field of small5–9px streaks**, replacing
contact rectangles tiled in rows. Each drop has independent position, fall
phase, speed and drift, with a moving two-dimensional density field. Soft
fades at the top, sides and actual wavy ground remove the two horizontal
seams. There are no global top-map rain marks, clouds or impact line. The
field is bounded to4096 drops; reduced motion remains stable. Decorations
never change authoritative water or cooling.

## Thirty-second rain-to-cricket overlap and dark ending

The default rain rise remains 60 seconds, with the same slow quintic curve
controlling sound, water and ground cooling. After every source is out:

1. **Rain overlaps into PA crickets over 30 seconds.** Complementary equal-power
   cosine/sine weights fade the rain field out while PA insects fade in.
   Projection normally fades over the same 30 seconds, independently editable.
2. **PA crickets alone in complete darkness, 12 seconds.** This starts after
   both rain and image have reached zero. There is no second cricket attack.
3. **PA→phones, 12 seconds.** Equal-power transfer continues in complete darkness.
4. **Phones alone, 15 seconds**, then their **60-second retreat/fade** to silence.

Phone crickets remain silent until the PA-to-phone handoff. Their recordings
prewarm quietly during late cooling. Main’s non-cricket field has its own native
30-second cosine fade; Main master stays open through the PA hold/handoff.
With default settings Main closes at 54 seconds after the overlap begins,
phone retreat starts at 69 seconds, and the ending finishes at 129 seconds.
The PA-only gate follows the longer duration if projection and audio overlap
have different values. Pause freezes every phase. The operator can edit the
Rain → PA cricket overlap independently of the Projection fade.

## Sources, rehearsal and validation

Catalog revision 13 contains 39 assets. Four additional Main-only blob sounds come from four independent short Stable Audio 3 Medium generations; each is 0.60–0.72 seconds with soft edges and fixed gain. The preceding four rain/haze choices come from six genuine Stable Audio 3 Medium masters: two light haze takes and two sustained rain/thunder alternatives. The new default storm is a continuous generated rain bed with a generated low thunder roll mixed at fixed gain into its middle (10–18 seconds; strongest bass at 12–15 seconds). The raw generations and exact edit placement are documented. No compressor or automatic gain rides the new rain bed. Main broad/far rain paths retain the 80–200 Hz thunder band rather than high-passing it away. The two haze takes replace the Main haze endpoints and join its six-take extinction bank. The default finale morph is natural light rain → the new storm. Phone sources retain the existing thin branch/leaf crackle and natural light rain. All
original masters, alternatives, processing, licenses and hashes remain in
`audio-assets/ATTRIBUTION.md` and `audio-assets/v3/manifest.json`.

Use `npm run study` for an isolated rehearsal, separate from the saved live
performance. The latest validation records are under
`output/coordination/palette-v24-tests-final.txt`, `output/coordination/visual-v24-browser.json`, `output/coordination/sound-blob-v24-browser.json`, and `output/coordination/phone-rain-v24-native.json`. Asset measurements and provenance are in `audio-assets/v3/storm-haze-v23-validation.json`. The preceding guide is archived in `output/coordination/performance-v23-notes.md`.




## Current balance and transitions

Phone crackle is 3 dB louder and touch rain is 4.4 dB quieter than the preceding revision; the original thin recording remains selected. Phone cricket loops run at 76% speed, with their natural repeated chirps spaced farther apart. Main recordings keep their original rates. The PA→phone transfer now follows native audio-clock gain curves on both devices, removing the extra target-filter delay from the phone entrance. A direct equal-power arc also reveals phones earlier within the transfer rather than applying a second slow ease-in. Insects are decoded and run silently during late rain so the handoff does not wait for a download or source start. The existing 30-second rain→PA-cricket overlap, 12-second dark PA hold, and12-second transfer remain editable.

Main tone reverb send rises from 0.12 to 0.15 (about 1.9 dB more wet signal), retaining the previous shared return. Texture and bell routing and crowd normalization remain intact.

Phone rain uses one continuing source through long drags, sea and missing patch targets. Normal eligibility loss releases over 2.5 seconds; explicit mute, hide, disable and reset still silence immediately. The brush completion rule now matches actual fire centers, with real physics and compact shared-state regressions at awkward fractional positions.

Projection title and program notes appear in scene 1, with instructions in scene 2 and the QR alongside both. Participation has no persistent projection text. Full program notes and instructions remain behind About on phones. A shared 12-second opacity crossfade opens the landscape in scene 3. Side-view haze and fire move more while preserving exact geographic anchors, wet calming and reduced motion. Map smoke has a slight copper tint. Final-rain visibility now shares the audio entrance curve, making the earliest drops sparse but visible without changing rain physics.


## Per-patch blobs and cooling character

The **Extinction blobs** slider controls four new soft liquid plops on Main, at 100% by default. Each authoritative false→true patch-out edge can admit one spatial blob independently of the once-per-area bell/quench/material event. Existing out terrain, repeated taps and duplicate state packets stay quiet. Real fire return re-arms that patch. Consecutive admitted blobs use different recordings.

An eight-voice pool, at least 100 ms between onsets, at most 64 pending events and a four-second event deadline keep a mass extinction from creating an overcrowded or delayed chorus. Overflow/stale events are consumed. Loading, interrupted audio, mute, hidden/disabled output, reset and ineligible scenes consume old edges rather than replaying them later. Phones never download the blob bank.

The fixed D♭ pentatonic tone now begins with soft movement in its upper overtones and gradually focuses as the confirmed ground cools. Its fundamental stays fixed, while a small upper-partial blur settles to zero. The existing finite tone→material transition, spatial placement, crowd gain and reverb stay intact. Scene 3 adds a thin haze at 18% of its full scene weight through the same 12-second sound transition.

Returning from scene 4 to 3 keeps the landscape visible and QR hidden, including after a page refresh or late join. The authority identifies whether participation was entered from the opening cues; only that initial entrance uses the opening overlay. The forest→drone sound crossfade still runs smoothly on a return. The fullscreen × control is removed; native Escape still exits fullscreen.


## Current tone and gesture refinements

Tone haze is now an audible filtered-noise halo plus stronger upper roughness. One bounded shared noise buffer feeds the admitted voices; confirmed deep cooling clears it while retaining the assigned fundamental. Wet skin alone remains silent. The pitched portion now leaves smoothly within 2.2 seconds of the actual completed-area bell, independent of the longer material transition. Ash/moisture/haze continue on their configured morph/fade clocks; the shared room retains its natural decay. No continued hold or repeated out packet can restart the old note.

Dragging a phone or local tester over confirmed extinguished terrain stirs distinct mono ash grains on Main. A stationary touch stays quiet. Grains last 28–65 ms with 2 ms attacks and declining tails, move with the brush, and release after movement stops or leaves out terrain. The pool is limited to 20 grains, 64 actor histories and four shared, separately calibrated mono ash buffers. **Ash grains · dragging** has its own mixer slider, independent of After-extinction textures. It never rings a bell, restarts a pitched note, or asks phones to fetch ash files.

A real Main bell now publishes a brief visual cue through the shared venue connection. Projection and phones draw one bright double ring at the circular rain-area anchor, not at an arbitrary member patch. The authority verifies current epoch, local operator role, actual out source, timing and duplicate identity. Feedback is ephemeral, never replayed on reload and has no effect on water or fire. Speculative patch/retap pulses were removed. Both the normal and reduced-motion pulse clear fully.

Top smoke uses a brighter copper-orange palette, including the true source plumes and shared atmospheric layer. Existing tabs require a normal reload to adopt the updated drawing module.

## Previous verification (v25)

All 544 checks passed. Native browser tests confirmed 87 mono ash grains from a moving phone gesture, 5 overlapping grains at inspection, zero grains after release, and no bell or pitched-note retrigger. The ash output was finite and below clipping; phones made no ash downloads. The native drone retains six sources and now has measured second/third/fifth partials, with only 1.83% more filtered RMS than the prior sine.

Native tone rendering measured a strong early noisy halo that cleared progressively while the 277.18263 Hz assigned pitch remained fixed. Dry pitched output reached exact silence within 2.22 seconds after the bell, even with a 180-second configured material morph; the independently rendered texture continued. Wet skin alone stayed silent.

Actual C3 bell admission sent the same event to Main preview, projection and phone, at the accepted brush anchor. First paint was 13 ms on projection and 11 ms on phone after the modeled audio onset. Repeat out taps did not ring or pulse again; the ring cleared fully. Opening title/programnotes and instructions were visible beside the QR. Return 4→3/reload kept it hidden; fullscreen had no ×. Orange smoke was visually checked in a native screenshot. Browser errors were empty.

Evidence: `output/coordination/ash-drone-v25-browser.json`, `output/playwright/visual-v25-actual-bell-report.json`, `output/coordination/palette-v25-tests-final.txt`, and `output/playwright/tone-native-v25-report.json`.

Activation retained the Ended cue, 1,830 cells, 40772.4954 water history, source/out flags and all sound, scene and physics settings. Venue server 4173 is healthy, the new drag module serves correctly, and all private rehearsals are closed. Refresh operator, projection and phones; restart the performance and enable sound to audition. Preservation proof: `output/coordination/performance-v25-restored.json`.


## Current level and brief-touch response

Main has 9 dB and phones have 12 dB of fixed output makeup after the saved volume control. Main recordings receive up to 1.5 dB of local crest treatment; phones retain up to 3 dB. Natural rain retains constant gain. A final smooth ceiling protects dense combinations. Stored mixer balances remain effective. Native renders measured about 11.8 dB more level on Main/rain and 14.8 dB on the phone crackle, without clipped samples in the crowd test.

A quick released touch can now reveal a finite tone from confirmed heat loss even when its held actor packet was missed. Earlier amplitude emergence retains the full hazy deep-cooling progression. Very short taps with no measurable heat change remain unpitched. Low assigned notes have a quiet stable octave partial for audibility. Global finale cooling cannot admit new released-touch tones.


## Previous verification (v27)

All 558 checks pass. Native rendering confirmed the released single-patch cooling response, no pitch from wet skin or cooled reloads, and a stable low-register octave body. Representative Main/phone mixes gained about 12 dB, and peak-limited phone crackle gained about 15 dB. A dense actual mix stayed below -1.5 dBFS; an extreme overload stayed below -0.35 dBFS without clipped samples.

An actual phone drag generated 43 mono grains over about two seconds, with 28–65 ms duration and 2 ms attacks. Small local movement now excites the layer clearly: the identical gesture measured 24 dB above its initial calibration. Zero trim and stationary touches are silent, release clears all grains, and the independent trim leaves After-extinction textures unchanged.

Scene 4 tests and an independent dense-field probe confirmed repeated full-area extinction/re-ignition cycles, real cooling/water, pause safety, and a finale entry from actual wet ground. Projection screenshots checked the stronger filled clouds, contrasting outlines and numbers, QR CTA, Wi-Fi separation and shortened copy.

The server update preserved the Ended cue, 1,140 cells, 19538.2587 accumulated water, source/out flags, all prior mixer trims and every other scene/physics setting. Participation is now 600 seconds; Ash grains · dragging starts at unity. Refresh all pages, enable sound again and restart the performance to audition.

Evidence: `output/coordination/performance-v27-tests-final.txt`, `output/playwright/tone-v27-native-report.json`, `output/playwright/loudness-v27-native-report.json`, `output/playwright/review-v27-report.json`, and `output/coordination/performance-v27-health.json`.


## Current Scene 4 and Main dynamics refinements (v28)

Scene 4 audience rain delivers 60% of the operator rain strength, without changing that saved control. Map and phone drop strength use the same rule. Rain still cools and returning heat still resists it. Through the forest rise, the clear fundamental, upper partial and low body fade away while a diffuse noise halo remains audible, including on deeply cooled patches. Finale tails retain that outgoing character; returning to Participation smoothly restores the normal cooling tone.

Orange source plumes use 25% less opacity; the shared veil uses .53 rather than .64. Tint, emitter geometry, motion and geographical bounds are retained. A native fixed-frame comparison measured 21.4% less accumulated opacity after layered compositing.

Main uses 3 dB less output drive and gentler peak handling, with a later soft knee, lower protective compressor ratio and slower attack. Phone dynamics and prepared phone recordings are unchanged. Stored mixer trims remain intact.

All 562 checks pass. Native haze rendering covered all 31 assigned notes and confirmed zero periodic gain at full haze with audible diffuse output. Evidence: `output/playwright/haze-v28-native-proof.json`, `output/playwright/dynamics-v28-native-report.json`, `output/playwright/review-v28-smoke-result.txt`, and `output/coordination/performance-v28-tests-final.txt`.

Native dynamics checks confirmed the unchanged phone signal and rain preparation, with 1.3–3.5 dB more crest in moderate dense Main passages and less protective gain reduction. Every rendered output remained finite and below .96 peak. Activation retained the Ended cue, 2,810 map cells, 27023.119 accumulated water, all mixer trims, ground settings and scene timings. Preservation record: `output/coordination/performance-v28-health.json`.


## Speaker controls and extinction pitch (v29)

The phone speaker button shows its current state: waves when enabled, a slash when muted/disabled, pause bars after interruption, and a spinner while starting. A short visible state label and accessible action names distinguish enabling, muting, unmuting and resuming. Main uses the same symbol beside its existing status. Enabling still requires a direct gesture and does not start a scene. State updates cannot re-enable a pending activation button.

Each newly admitted ash/moisture/haze extinction lifecycle draws one choice: normal, a minor third lower (-3 semitones), or a major third higher (+4 semitones). The probability of either transposition is `(2/3) * meanSourceHeat^1.5`; down/up share it equally. Full fire gives each choice one third. At half mean heat, about 76% remain normal; near full cooling, almost all remain normal. The actual global heat is used, including partial cooling before an out flag.

The chosen interval multiplies the existing tiny per-patch rate variation and is held through decode delays, crowd windows and later macro changes. Completed tones, bells, quench, blob and dragged ash pitches keep their existing rules. Material morph/fade timing remains independent of playback rate.

Verification: all 567 checks pass, including macro-heat integration, per-lifecycle pitch snapshots and finite material clocks. Browser interaction checks covered phone/operator enable, mute, unmute, suspend/resume and disabled pending activation across live state packets. Existing server 4173 serves the update without a restart or any performance-state changes. Evidence: `output/coordination/performance-v29-tests-final.txt`, `output/coordination/speaker-v29-phone-browser.txt`, `output/coordination/speaker-v29-operator-browser.txt`, and `output/coordination/performance-v29-health.json`.
