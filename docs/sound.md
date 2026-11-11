# Sound, projection and phone rehearsal

Use `/operator` for all controls and its **speaker button** for Main sound. This
operator computer owns Main audio through its preview. `/projection` carries
the separate visual output and no visible sound button; switching tabs does
not mute Main. Audience members enable their own sound at `/audience`.
`/study` and `/study/phone` remain compatible aliases.

The speaker button on `/operator-remote` controls Main sound on the host.
An explicit remote Enable request attempts to start the host's sound, including
its first audio context. On Mac, [remote sound mode](mac.md#enable-main-sound-from-the-remote-page)
opens Chrome with autoplay allowed so no first host click is needed. In a browser
that blocks autoplay, the status asks you to enable sound on the host instead.
Remote disable/enable actions retain the normal smooth output fades. Keep the host Operator page open.
The remote controller stays silent and audience phones retain their own sound
buttons. Playback commands are temporary and are never saved in a preset.
The remote waits for the host to confirm each change. If the host does not
respond or finish starting within about eight seconds, the remote reports
that host sound is unavailable and releases the button so it can be retried.
Keep the host Operator page open; a later confirmed response restores its status.
Page loads and reconnects never replay an old Enable request. A blocked host
activation stops waiting before the remote's completion deadline and leaves its output muted.

The operator opens in Performance. Mixer keeps all 13 layer levels and the
five texture-shaping controls beside the same preview; texture shaping starts
collapsed and shows Automatic or Manual mode. Restart performance is beside
Pause in the Performance transport. Setup contains timing, ground response,
audience information and source updates. View
changes leave the preview/audio engine and unsaved form drafts in place.

The work title is **karhutla**. Scene 1 shows program notes, Wi-Fi credentials
and two numbered joining steps: 1 join the Wi-Fi, then 2 scan the QR below it.
Scene 2 retains the Wi-Fi name, password and QR, and shows the same
instructions as phones, rendered from one shared source.
During the phone's Scene 2→3 entrance, the instruction and map opacities
interpolate between venue packets. The instruction layout and sound button
stay steady through the hold and fade; interpolation does not advance water,
input eligibility, sound cues or scene boundaries.
Ask listeners to tap the speaker button and set a comfortable media volume.
Turning Silent Mode off is an optional last resort if sound is still inaudible. Supported recent iPhone browsers also receive a playback-session request
when the speaker button is tapped; other browsers retain normal activation. This follows
[WebKit's Silent Mode guidance](https://bugs.webkit.org/show_bug.cgi?id=237322#c6).

## Start, timers and manual overrides

Start with **Restart performance** for fresh fire, then **Start timed
performance** when ready. Arrival stays paused until started. The server owns
the show clock, so page reloads and device clock differences do not advance
a separate copy. Pause/resume freezes and continues that clock.

| Scene | Default automatic duration | Main sound |
| --- | --- | --- |
| 1 Arrival | 60 seconds | Light haze; title, program notes, Wi-Fi name/password and join instruction on projection. Numbered Wi-Fi then QR steps appear together. Brief phone welcome. |
| 2 Instructions | 60 seconds | Larger instructions and QR on projection; instructions also appear on phones. Haze becomes distant burning forest. |
| 3 Participation | 600 seconds | 54% default audience rain. Low drone with thin haze, cooling tones, per-patch blobs and per-area bell/quench/material. |
| 4 Forest takeover | 60 seconds | Ground/fire return; distant forest dominates as the low drone transfers to phones with soft distortion. |
| 5 Final rain | Through the complete ending | 52-second rain rise, blackout, PA crickets with distant orangutan, then phones with sparse bird calls. |

Every scene button stays clickable, including the current cue. Clicking
immediately overrides the sequence and starts the selected scene at zero.
The selected cue then resumes its own automatic timer. The four durations
are editable in Performance timing, separately from sound-transition and
forest-restoration times. Automatic cue4 waits for restoration if a custom
restoration duration is longer than its scene timer. Manual cue5 from cue4
finishes forest restoration and starts rain immediately. Held rain continues to cool and extinguish in cue 4 while returning heat resists it. A real extinction is followed by a brief rest and gradual fire return, allowing another genuine cooling cycle. Tones, bells and materials remain audible under the dominant forest; the Main low drone transfers to phones with soft distortion. Cue 5 begins from the actual wet ground without forcing a dry snapshot.

Delayed authority ticks are split at every cue boundary, preserving exact
water, restoration and rain-cooling timing. Timer edits do not retroactively
add rain. The show clock stays ephemeral: restoring a save never resumes a
performance without the operator.

## Main mixer and bells

The mixer has independent **Bells**, **Woodfire quench**, **After-extinction
textures**, **Extinction blobs**, Soft tones, Participation low drone, Haze, Burning forest, Ash,
Rain, Moisture, Ash grains · dragging and Crickets channels. Each trim is0–200%; Main output is the
shared master. Bells default to160% and quench to100%. Existing stored
balances remain intact; new channels receive their own defaults.

Ash and moisture have three separate Main uses. The Atmosphere **Ash** and
**Moisture** sliders control continuous dry papery scattering and quiet water
seeping through moss and soil. A newly extinguished area opens into one finite
ash, moisture or haze material, controlled by **After-extinction textures**.
Moving across already extinguished ground produces short ash grains under
**Ash grains · dragging**; holding still does not sustain them. These controls
are independent: lowering an atmosphere layer does not lower the same material
in the other routes. The Moisture macro also darkens the fire's sound; its
mixer slider changes only the recorded water layer.

New bell strikes select from harmonics **2–11 of D♭2**, the shared
69.295657744 Hz reference: approximately 138.59–762.25 Hz. Their pitches use
exact frequency multiples, including the fractional pitches of the seventh
and eleventh harmonics. Lower harmonics are favoured from the start, and new
strikes descend further as the exact global fraction of confirmed-out fires
rises. The lower weighting reaches its final shape by 45% out; every harmonic
remains available. Existing strikes and tails keep their pitch. A fixed register contour
runs from 0 dB at harmonic 2 to −4 dB at harmonic 11, replacing the former
upper-register boosts.
Saved mixer levels remain effective; participant counts do not duck a bell.

An 8 ms strike excites six modes at 1, 1.43, 2.17, 3.61, 5.17 and 6.83
times the selected pitch. The lower modes carry more of the body, with less
energy in the upper resonances. The fundamental decays faster than the inharmonic
body, avoiding a long clean-sine tail. Natural decay runs from 12 seconds
at the low end to 8 seconds at the high end. Eight natural tails and eight
short overflow fades remain bounded; retiring voices are never disconnected
abruptly to admit a new strike. A dark 3.2-second room at 40% wet adds a more
audible, finite reverberant tail without another convolver per bell.
Actual loudspeaker and room response still affect perceived pitch balance.

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

Each new map tone selects one pitch from harmonics
**2–30 of D♭2**, approximately 138.59–2078.87 Hz. Map tones and bells share
the 69.295657744 Hz reference, without rounding harmonic frequencies to
equal-tempered semitones. New tone admissions favour higher harmonics early,
then move lower sooner: their weighting crosses the middle at about 21% of
fires out, rather than 50%. The lower bound is one octave below the previous
H4 floor. Every harmonic remains available.
An admitted note keeps its pitch through dragging, cooling and its release.
Scene 4 can reopen fires and move new selections higher again; this is not a
one-way descent across the whole performance. The Main drone above retains
its separate original banks and tuning.

The airy tone is built from breath excitation through two pitch-centred
noise resonators and a quieter, exactly pitched anchor. It remains airy for
the first four seconds. As held motion begins at four seconds, the breath
gradually settles around a clearer pitch over seconds 4–9, retaining some
air. Cooling also narrows the resonances. Energy compensation balances the
voice's estimated power as its character changes. The
resonators reuse the bounded native voice graph without another recording
download or per-voice convolver. Scene 4's diffuse-air endpoint, the finite
tone-to-material transition and release cleanup remain intact.

The note emerges with confirmed ground cooling rather than surface wetness
alone, with 0.3 s tracking and a 0.012 peak envelope. Several people on one
patch share its voice. Every admitted tone retains its calibrated level as
more people join. Actual signal compression and the final ceiling manage
peaks; participant and ringing-bell counts do not reduce tone or bell level.

## Limited extinction material and stronger room

Each completed area uses its representative patch’s stable ash, moisture or
haze class, with multiple independent recordings per class. Nearby same-class
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
and takeover:35Hz high-pass, flat low shelf at240Hz,1.5–2.4kHz low-pass
with moisture damping, and−9dB high shelf at1.8kHz. It emphasizes low body and
softens close crackles without sending the whole forest into the patch room.
The former +5 dB shelf exaggerated bass movement already in the recordings.
At the tested saved balance, isolated forest playback showed less than 0.001 dB
of settled compressor reduction, so the shared dynamics remain unchanged.
Ground-ember→wind-through-flame interpolation remains available.

Main rain has fixed cuts at 1030 Hz (−2 dB, Q3) and 1900 Hz (−3.5 dB, Q0.8)
to soften the sharper drop band while retaining low thunder. Main haze has
cuts at 1050 Hz (−5 dB, Q0.7) and 2050 Hz (−3 dB, Q2.5), reducing the
recordings' pitched midrange emphasis. These filters preserve the original
recordings, level controls and scene envelopes; they do not alter phone assets.

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

The default rain rise is 52 seconds, eight seconds shorter, with the same slow quintic curve
controlling sound, water and ground cooling. After every source is out:

1. **Rain overlaps into PA crickets over 30 seconds.** Complementary equal-power
   cosine/sine weights fade the rain field out while PA insects fade in.
   Projection normally fades over the same 30 seconds, independently editable.
2. **PA crickets with a distant orangutan voice in complete darkness, 12 seconds.** This starts after
   both rain and image have reached zero. There is no second cricket attack.
3. **PA→phones, 12 seconds.** Equal-power transfer continues in complete darkness.
4. **Phone cricket field, 15 seconds**, then its **60-second retreat/fade** to silence. The residual distant field dissolves over the final 12 seconds, replacing the former 2.2-second terminal tail without moving the silence deadline. Sparse bird calls pass between phones; the orangutan remains faint on Main and fades with the retreat.

Phone crickets remain silent until the PA-to-phone handoff. Their recordings
prewarm quietly during late cooling. Main’s non-cricket field has its own native
30-second cosine fade; Main master stays open through the PA hold/handoff.
With default settings the Main cricket master closes at 54 seconds after the overlap begins; an independently gated orangutan tail remains faint,
phone retreat starts at 69 seconds, and the ending finishes at 129 seconds.
The PA-only gate follows the longer duration if projection and audio overlap
have different values. Pause freezes every phase. The operator can edit the
Rain → PA cricket overlap independently of the Projection fade.

## Sources, rehearsal and validation

Catalog revision 14 contains 42 assets, including three original synthetic wildlife interpretations (one orangutan and two lower-register bird calls). Four additional Main-only blob sounds come from four independent short Stable Audio 3 Medium generations; each is 0.60–0.72 seconds with soft edges and fixed gain. The preceding four rain/haze choices come from six genuine Stable Audio 3 Medium masters: two light haze takes and two sustained rain/thunder alternatives. The new default storm is a continuous generated rain bed with a generated low thunder roll mixed at fixed gain into its middle (10–18 seconds; strongest bass at 12–15 seconds). The raw generations and exact edit placement are documented. No compressor or automatic gain rides the new rain bed. Main broad/far rain paths retain the 80–200 Hz thunder band rather than high-passing it away. The two haze takes replace the Main haze endpoints and join its six-take extinction bank. The default finale morph is natural light rain → the new storm. Phone sources retain the existing thin branch/leaf crackle and natural light rain. All
original masters, alternatives, processing, licenses and hashes remain in
`audio-assets/ATTRIBUTION.md` and `audio-assets/v3/manifest.json`.

Use `npm run study` for an isolated rehearsal, separate from the saved live
performance. The latest validation records are under
`output/coordination/palette-v24-tests-final.txt`, `output/coordination/visual-v24-browser.json`, `output/coordination/sound-blob-v24-browser.json`, and `output/coordination/phone-rain-v24-native.json`. Asset measurements and provenance are in `audio-assets/v3/storm-haze-v23-validation.json`. The preceding guide is archived in `output/coordination/performance-v23-notes.md`.




## Current balance and transitions

Phone crackle is 3 dB louder and touch rain is 4.4 dB quieter than the preceding revision; the original thin recording remains selected. Phone cricket loops run at 76% speed, with their natural repeated chirps spaced farther apart. Main recordings keep their original rates. The PA→phone transfer now follows native audio-clock gain curves on both devices, removing the extra target-filter delay from the phone entrance. A direct equal-power arc also reveals phones earlier within the transfer rather than applying a second slow ease-in. Insects are decoded and run silently during late rain so the handoff does not wait for a download or source start. The existing 30-second rain→PA-cricket overlap, 12-second dark PA hold, and12-second transfer remain editable.

Main tone reverb send rises from 0.12 to 0.15 (about 1.9 dB more wet signal), retaining the shared return. Later tone/bell dynamics changes are described below.

Phone rain uses one continuing source through long drags, sea and missing patch targets. Normal eligibility loss releases over 2.5 seconds; explicit mute, hide, disable and reset still silence immediately. The brush completion rule now matches actual fire centers, with real physics and compact shared-state regressions at awkward fractional positions.

Projection title and program notes appear with Wi-Fi details in Scene 1; Scene 2 shows instructions and QR. Participation has no persistent projection text. Phones show instructions automatically in Scene 2; program notes remain behind About. A shared 12-second opacity crossfade opens the landscape in scene 3. Side-view haze and fire move more while preserving exact geographic anchors, wet calming and reduced motion. Map smoke has a slight copper tint. Final-rain visibility now shares the audio entrance curve, making the earliest drops sparse but visible without changing rain physics.


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


## Main tone/bell level and transparent dynamics

Main tones and bells now retain their individual levels as the audience grows,
including the 28-person rehearsal case. The tone master stays at unity and the
bell bus follows only its mixer trim and scene envelope; neither participant
counts nor overlapping bell counts turn those layers down. Voice limits and
finite release tails still bound the work. Quench and blob overlap blending
counts only audible recording sources, never the audience.

After the saved Main volume and fixed **+9 dB makeup**, one native compressor
uses a **−6 dBFS threshold, 6 dB knee, 2:1 ratio, 20 ms attack and 200 ms
release**. These values refer to the signal after that fixed makeup. There is
no automatic makeup or count-driven gain ride. Below the knee, the ordinary
field passes at its calibrated level. Only louder combinations receive gentle
signal-dependent reduction. The existing smooth **.96 peak ceiling** catches
attack overshoot; its Main bend starts at .84. Metrics report the native
compressor's gain reduction for rehearsal. Phone dynamics remain unchanged.

Native offline rendering verified equivalent tone level with 1 versus 28
participants when the sounding patch is unchanged (maximum sample difference
0.00000191; RMS difference below 0.000001 dB), plus 28 tones/eight bells,
32 tones/eight bells at maximum mixer trims, and an extreme overload through
the actual output graph. All samples were finite, no samples clipped, and
peaks stayed at or below .96. Evidence:
`output/playwright/dynamics-final-native-report.txt`.


## Phone drone and wildlife ending

The Scene 4 phone drone follows Main’s original and cooling-shifted pitch banks
one octave above Main, with a +3 dB trim relative to the initial phone version
(one octave lower and 1.5 dB softer than the preceding revision). Its entrance follows the forest rise while Main's drone recedes.
A static soft drive adds audible harmonics on small speakers, with a 150 Hz
high-pass and 3.5 kHz low-pass to retain the shifted chord. Six native oscillators share one 513-point
shaper without oversampling, worklets, convolution or per-sample JavaScript.
It fades smoothly out through the 52-second final rain rise; stopping sound
retires its oscillators.

During the rain-to-cricket transition, a restrained synthetic orangutan
interpretation enters at a distance on Main. Its independent tail reaches
16% of its earlier level after the cricket handoff and follows the phone
retreat to silence. The tail still passes through Main compression/limiting.
It never loads or plays on phones. The emotional and species character is an
artistic interpretation to audition in the room.

During the phone cricket passage, one short lower-register bird call occurs
roughly every 19–25 seconds across the whole room, rotating among connected
phones. Calls play at original or slightly lower pitch, with no upward shift,
and never loop. At 28 phones this produces only a handful of calls across
the finale. The authority freezes that finale’s phone assignments; late joins
wait until a later finale for bird calls, and departed phones leave quiet gaps. Each selected phone lazily decodes its small 2.8-second mono MP3;
the orangutan MP3 is 16 seconds and Main-only. Scene changes, mute and hidden
phone screens stop these sounds; pause freezes their show-clock transport.

New default timings and rain strength apply to fresh settings. Imported or
previously saved custom settings remain available. Use Operator's Audience
rain and Final rain rise controls to apply 45% and 52 seconds to an existing
saved setup.


Final scene verification: 628 checks passed, with one Windows-only browser
launch check skipped on this Mac; 47 focused legacy/default checks also
passed. Browser checks covered Scene 1 Wi-Fi with no QR, Scene 2 projection
and phone instructions, sound activation and the return to rain interaction.
Eight native audio renders verified the shipped wildlife files, their actual
catalog mappings, fixed recording normalization and the six-pitch phone drone.
All rendered samples were finite with zero clipping. The orangutan averaged
about 6.5 dB below Main crickets in the controlled comparison and its faint
phone-phase tail remained audible in the rendered signal after the Main
cricket master closed. Evidence: `output/scene-final-tests.txt`,
`output/scene-final-followup-tests.txt`, and
`output/playwright/wildlife-drone-final-native-report.json`. These are software
and signal checks; the emotional character and room balance remain listening
judgments.

## Independent orangutan controls

Operator's Layer levels now has a Wildlife group with **Orangutan voice** and
**Orangutan tail**, each from 0–200%, initially 100%. Voice sets the overall
orangutan level. Tail adjusts its retained phone-phase level relative to that
voice: 100% keeps the composed 16% endpoint, 0% removes that tail, and 200%
retains 32%. The handoff remains smooth and the final retreat still reaches
silence. Changes reach the currently playing phrase immediately, independently
of the Crickets slider, and still pass through Main compression/limiting.

Both values persist with shared settings and travel in exported presets.
Complete older presets receive 100% for these two new controls while retaining
their other trims; malformed or incomplete original channels remain rejected.


## Finite rainwater and updated phone balance

Each phone has an authoritative rainwater supply shown as a small bar. A
fresh full tank lasts 33.5 seconds at the default 45% rain strength and default
cooling timings. Rain consumes water only while that phone is pouring.
The tank automatically refills over 12 seconds while the user is not touching
or using the Rain toggle. There is no recharge button. At empty, rain and its
phone sound stop; a still-held finger must release before refilling begins.
The Rain toggle turns off automatically at empty. Rain never restarts itself.
Reloads and reconnects retain the used supply within the running server.

Capacity adapts to cooling, settlement and rain strength, using Scene 4’s
weaker rain to allow a complete area extinction plus margin. Actual physics
tests extinguished 30–38 source patches together within 32 seconds in both
participation scenes, still fitting within the reduced default tank.
Operator settings with extremely weak rain can be physically unable to
extinguish an entire area regardless of tank size. The budget never changes
fire physics or adds water when idle. Depletion and lease boundaries are
integrated exactly, independently of network packet rate.

Phone touch rain is 4.5 dB quieter. Phone crickets are 2 dB quieter and play
at 0.62 recording speed. The current continuous field uses offline-shaped natural chirps, 35% shorter
with onsets 25% farther apart, and a gentle four-second native entrance.
The former multi-second whole-field rests are removed. They retain
the composed handoff and final retreat, without synchronizing all phones.
The distorted drone now sits one octave above Main at a +3 dB trim, using the
same lightweight native graph with less beating between its pitch banks. Real browser renders verified the exact level
ratios, six shifted frequencies, finite samples and zero clipping:
`output/playwright/phone-audio-revision-native-report.json`.

Browser checks verified identical Main/phone instructions, numbered Wi-Fi then
QR joining, a complete 50-second drain, automatic Rain toggle stop, empty and
refilling bar states, 12-second automatic refill and touch-release behavior.
Orangutan voice/tail controls changed independently of Crickets and restored
to unity. Evidence: `output/playwright/rain-supply-browser-result.txt` and
`output/playwright/orangutan-sliders-browser-result.txt`.


Final verification for this revision: 648 checks passed, one Windows-only
launch check skipped on macOS. The running server was restarted with the
new modules; its Ended cue, 2,274 saved cells, source records, total water,
rain strength and scene timings were preserved. Operator, audience and new
audio/instruction routes responded successfully. Refresh Operator, Projection
and all audience phones to load the update. Small-phone visual checks at
390×844 and 320×640 verified the water bar clears the bottom controls and
the fresh hold hint. Final regression log: `output/rainwater-revision-tests.txt`.


## Listening refinements: Wi-Fi, bells and phone wildlife

Wi-Fi credentials remain visible above the QR in both opening scenes. Main
and phones still render one identical instruction source. Sound activation
comes first; turning Silent Mode off is optional troubleshooting only when
sound remains inaudible after enabling the speaker icon and setting media
volume. Scene 2 was visually checked at 1440×900 and the phone at 390×844.

The intermittent bell weakness had several code causes: the previous random
C2–G7 range included very low fundamentals and high notes with much lower
peaks, and the Scene 4 bell bus followed the drone’s 30% endpoint (−10.46 dB).
Bells now retain their own level through the forest rise. C/G notes span
C3–G5, with a fixed +4 dB trim for the upper register to counter its weaker
early strike through Main’s existing spatial path. The surrounding tones and
spatial routing retain their controls. Native early-strike spread across all
six notes measured 3.82 dB; Scene 3 and Scene 4 levels differed by less than
0.009 dB. Sixteen overlapping strikes at maximum controls remained finite and
unclipped, below the .96 output ceiling.

A rain area’s visual centre previously retained its first touch location after
dragging, while the sound could use its first member source. The completion
anchor now follows the actual brush contacts, including their final released
position. Audio and the relayed ring use that same normalized country point.
Tests cover fast drags and overlapping contacts, and a rendered moved-ring
check measured zero-pixel position error. Bell proof:
`output/playwright/bell-v30-final-native-report.json`.

Phone crackle now has a warmer 420 Hz body emphasis and less high-frequency
energy. Body-to-air balance increased about 4 dB in the native comparison.
The phone drone is one octave lower and its fixed trim is 1.5 dB softer than
the preceding version (now one octave above Main, +3 dB from its first phone
version). The moving pitch bank contributes 20% instead of 50%, and static
drive is 2.8 instead of 3.6, reducing beating/intermodulation without adding
phone processing nodes.

Phone crickets return to a continuous field, with a four-second raised-cosine
entrance and the existing −2 dB trim. Offline edits preserve natural chirp
waveforms and pitch while making each chirp 35% shorter and its onset spacing
25% longer. The former 8–14 second whole-field mutes are removed. Three new
20-second mono mobile derivatives stay below 250 kB each; original source
recordings and Main choices remain archived. Native proof and reproducible
asset processing are recorded in
`output/playwright/phone-timbre-v30-native-report.json` and the mobile source
records beside the files.

The orangutan phrase now repeats every 27 seconds instead of 31, with a
restrained dark 1.65-second room at 12% wet. Reverb joins before its existing
voice/tail trims and ending envelope. Phones do not create a convolver.
Birds arrive 2–4 seconds into the phone handoff, then every 10–14 seconds
across the room. Their level is 6 dB higher with a gentle 950 Hz presence
boost, retaining the lower call register. Authority assigns each call to one
phone shortly before preload; phones joining late can receive future calls,
and a selected phone disconnecting leaves a quiet gap instead of duplicating
a call. This remains sparse room-wide distribution, not a call from every
phone on every cycle.


Final verification: 657 checks passed, with one Windows-only launch check
skipped on macOS. Actual browser phones played their assigned birds through
the frontend sound engine, including an enabled phone that disconnected and
rejoined after the ending began. Native phone-band rendering found the early
bird call about 10.9 dB above a full cricket bed, with finite samples and no
clipping. Controlled voice-stop rendering confirmed the subtle orangutan
reverb tail. Reverb history clears on mute, pause and scene changes without
continually allocating nodes while inactive. Enable phone sound during the
opening scenes; a brand-new phone arriving after blackout has hidden sound
controls under the deliberate all-black ending.

The running server was restarted successfully and returned to its Ended cue.
Source observations, total water, rain strength, scene timings and all sound
settings were preserved. Operator, Projection, audience and new mobile
recording URLs responded. Refresh all views before rehearsing these changes.
Evidence: `output/sound-refinement-tests.txt`,
`output/playwright/wildlife-audibility-native-report.json`, and
`output/playwright/wildlife-phone-handoff-report.json`.


## Joining continuity, visible water and long-tone motion

Both joining headings now share one font size and layout rule. Their numbered
circles, text, panel and QR have identical geometry in Scenes 1 and 2. The
complete instruction/Wi-Fi/QR overlay retains that layout into Scene 3 and
fades as one panel, instead of immediately dropping Wi-Fi and restyling QR.
Actual browser comparisons at 1440×900 and 1280×720 found no position or size
change at Scene 2→3 start or mid-fade.

The rainwater panel has a dark backing, brighter 9–10 px fill, larger labels
and a stacking position above rain/contact effects. Landscape phones use a
wider bottom-centred panel beside the Sound and Rain controls; portrait phones
retain the space above that row. Checks at 844×390, 568×320 and 390×844 verified
clear labels, a draining value, active rain and no control overlap. The panel
retains the existing blackout behaviour and does not intercept map touches.

Main patch tones remain unchanged for their first four seconds. Sustained tones
then ease over eight seconds into independent slow amplitude motion, up to
±3.5% at approximately 0.07–0.11 Hz. Pitch and cooling physics remain unchanged.
Motion fades out on release or completion and is disposed with the existing
bounded voice graph. Native comparison measured about 0.52 dB peak-to-peak
movement, unchanged initial samples/fundamental, finite unclipped 32-voice
output and silent releases.

Birds are 4.5 dB quieter than the preceding version, with 20–26-second
room-wide gaps and four calls in the default ending. Their early entrance is
retained. Main and phone wildlife banks are now separate: only Main retains
the orangutan URL; phones retain only birds. Phone controller load guards also
reject the orangutan file, including an accidental wrong-role source. Native
proof confirmed no orangutan fetch, decode or playback on phones. The prior
phone scheduler already selected bird events; no prior orangutan playback
leak was established.

Evidence: `output/playwright/opening-continuity-browser-report.json`,
`output/playwright/water-landscape-active-verified.png`,
`output/playwright/water-portrait-visible.png`,
`output/playwright/held-tone-motion-native-report.json` and
`output/playwright/sparser-wildlife-native-report.json`.


Final validation for the continuity/tone revision: 661 checks passed, one
Windows-only launch check skipped. The running server was restarted and
returned to Ended; cell count, total water, source observations, scene timings,
sound settings and rain strength were preserved. Updated pages and modules
responded successfully. Regression log: `output/continuity-and-tone-tests.txt`.
Refresh Operator, Projection and audience phones before rehearsing.


## Magnified aiming, shorter supply and wider Main stereo

Scene 2 explicitly tells listeners to enable sound now and wait until Scene 3
(Participation) before expecting phone audio. Main and phone still use the
same instruction source; the opening phone caption and footer agree.

Rainwater capacity is multiplied by 0.67 after the existing calibration, so
the default tank is now 33.5 seconds. The automatic idle refill remains
12 seconds. Default stationary-area extinction still fits within one tank;
slow custom physics settings can require cooperation or additional refills.
Long-held tone modulation starts at four seconds, eight seconds earlier than
before, and retains its eight-second entrance and gentle depth.

A 124 px, 2× magnifier appears above a phone pointer while raining and follows
dragging. Near screen edges it clamps or moves beside the finger. It copies
only a small region of the already-rendered map, at most 24 times per second,
with a bounded 186×186 backing bitmap and no separate animation loop. It
briefly retains a frozen frame for 450 ms after a quick tap, then hides.
Cancellation, empty supply, hidden pages and scene exits clear it immediately.
Actual browser tests covered portrait/landscape, dragging, edges, reduced
motion, real supply depletion and cleanup.

Main spatial paths now use a shared position helper and a modest native stereo
focus stage after the existing HRTF. Original HRTF coordinates, source distance,
centre and bell-register calibration remain intact. Stereo fallback spreads
fully left/right with a smooth pan curve. Native tests measured about 6.7 dB
more left/right separation for tones and 8 dB for bells, with an unchanged
centre. Tested mono fold-down improved, and stress renders remained finite
and unclipped. The wider image requires stereo output and separated speakers;
this adds no phone audio processing.

Birds have another 4 dB reduction, irregular 30–43-second room-wide gaps, and
varied short playback windows instead of repeatedly starting the same clip.
The schedule is seeded by the authoritative performance start, shared by all
phones and the owner allocator. Adjacent calls alternate source recordings;
offset, duration and rate also vary. Main-only orangutan protection remains.

Final verification: 671 checks passed, one Windows-only launch check skipped.
The running server was restarted successfully and returned to Ended, preserving
cell count, total water, source observations, rain strength, scene timings and
sound settings. Updated modules and both new routes responded. Evidence:
`output/magnifier-spatial-tests.txt`,
`output/playwright/phone-magnifier-browser-report.json`,
`output/playwright/main-spatial-native-report.json`,
`output/playwright/main-spatial-bells-native-report.json` and
`output/playwright/bird-variation-native-report.json`.


## Two-times magnifier and occasional phone chirps

The current magnifier uses 2× throughout: a 62 CSS px source region fills the
124 CSS px lens. Its visible label is derived from the same zoom constant.
Actual portrait and landscape browser checks confirmed both the ratio and
label, retaining the bounded bitmap, drawing limit and touch cleanup.

The phone bird bank now contains three new, short, isolated tropical chirps
(`rainforest-chirp-{a,b,c}-v31`). These replace the earlier low, hollow coos,
which could resemble the Main animal voice. They are original generated bird
interpretations, not species-verified field recordings. Each plays once at its
natural rate, with no looping, repeated phrase windows or pitch slowing.
Calls begin 4–8 seconds after the phone cricket handoff finishes; subsequent
room-wide gaps vary from 45–65 seconds, giving one or two calls during the
default ending. The authoritative allocation still assigns only one phone
to each call, and adjacent calls use different recordings.

Phone bird gain is now 12 dB below the cricket gain, and the former 950 Hz
presence boost is removed. Fixed recording preparation uses each chirp's
active body rather than its silent padding, preventing a brief chirp from
being boosted by a low whole-file average. This adds no real-time analysis or
compression. Native renders through the actual phone graph measured active
chirps 14.0–15.1 dB below the cricket bed in the 500–4000 Hz band during the
initial phone-only stage. Main orangutan preparation, cadence and reverb
remain unchanged.

The phone controller rejects both orangutan and retired coo URLs. A fresh
audience page with Main audio disabled fetched and decoded the three cricket
layers and a new chirp, then played that chirp once at 1×. No orangutan or
retired coo was requested. No prior Main voice routing leak was reproduced;
the old coo's voice-like timbre is the likely explanation. Fully reload each
phone page to replace previously decoded recordings and the old scheduler.

All 672 checks passed; one Windows-only launch check was skipped. The live
server was restarted and returned to Ended, preserving saved sound/scene
settings, rain strength, source observations, identities, total water and cell
count. Catalog version 15 and the new audio URLs responded successfully.
Evidence: `output/chirp-replacement-tests.txt`,
`output/chirp-replacement-live-verification.json`,
`output/playwright/magnifier-two-browser-report.json`,
`output/playwright/wildlife-v31-live-phone.json`,
`output/playwright/wildlife-v31-level-check.json` and
`output/playwright/wildlife-v31-preview.json`. The 12-second balance preview
at `output/audio/phone-chirp-balance-preview.wav` retains the authored phone
level, with one chirp at six seconds and Main disabled.


## Quieter phone crickets and clearer occasional coos

The current phone cricket gain is another 4 dB lower (6 dB below the original
0.04 reference). Bird gain is 3 dB higher than the preceding revision; its
relationship to the new cricket gain changes from −12 dB to −5 dB. Recording
dynamics, the four-second cricket entrance, rhythm and final fade remain
intact. The periodic sounds throughout the earlier balance preview were the
cricket bed; that file contained only one bird-clip playback near six seconds.
One clip can contain more than one perceived note, so call counts describe
playback events rather than individual audible chirps.

The active bird bank now mixes two short coos (`rainforest-coo-{a,b}-v32`) with
the retained chirp C. The coos are derivatives of the earlier original model
outputs, with a nine-semitone pitch/rate lift and filtering baked into compact
1.46-second files. Their dominant frequencies measure about 694/648 Hz versus
342 Hz for Main's longer, breathier orangutan phrase. This establishes a
different register and duration; listening determines the perceived animal
character. No phone pitch processor or additional real-time effect is added.
All 45 prior assets and Main's orangutan recording remain unchanged.

Bird calls now have irregular 8–18-second room-wide gaps, retaining the first
call 4–8 seconds after the cricket transfer completes. Adjacent calls select
different recordings. Exactly one phone owns each event regardless of crowd
size; the default test seed produces six calls in total with 1, 2 or 28 phones.
The shared authority and phone scheduler use the same minimum-gap bound so a
long custom ending cannot truncate valid late calls. New coos never overlap
at this cadence. Orangutan routing remains Main-only.

Catalog revision 16 contains 47 assets. All 673 checks passed, with one
Windows-only launch check skipped; the extra routing case covers a valid call
beyond the old event-count bound. The live server restarted successfully and
returned to Ended, preserving saved scene/sound settings, rain strength,
identities, source observations, total water and cell count. Fully reload the
phone pages to receive the new audio bank, balance and timing.

Evidence: `output/cricket-coo-balance-tests.txt`,
`output/cricket-coo-balance-live-verification.json` and
`audio-assets/v3/rainforest-coos-v32-validation.json`.

The 45-second `output/audio/phone-birds-crickets-balance-v32.mp3` preview uses
the actual phone graph and 160 ms scheduler at the current gains, with no
post-render normalization. It represents a single-phone rehearsal: crickets
alone for the first 6.58 seconds, coo B at 6.58, chirp C at 17.46 and coo A at
32.66 seconds. The normal ending fade continues during the excerpt. In the
audience those calls are distributed among phones. Its full event/source
record is `output/playwright/wildlife-v32-preview.json`.
A fresh real audience page also decoded and played a new coo and chirp at 1×,
without requesting any orangutan or retired coo recording; routing evidence is
`output/playwright/wildlife-v32-live-phone.json`. Its isolated browser/server
were closed after verification; the live performance server remains running.


## Additional phone level and spacing adjustment

Phone crickets are another 3 dB softer and bird calls another 3 dB louder than
the preceding revision. Cricket gain is now −9 dB from the original 0.04
reference, and bird gain is +1 dB relative to that new cricket gain. This is a
6 dB change in their relative balance while preserving the requested absolute
3 dB adjustment to each. Bird call onsets now occur 4–8 seconds apart across
the room, with the first call still 4–8 seconds after the handoff completes.
Each event belongs to one phone. The default test seed produces eleven calls;
the coos' 1.46-second duration leaves no overlapping calls at this cadence.

All 674 checks passed; one Windows-only launch check was skipped. Tests cover
the absolute gain changes, owner allocation with 1/2/28 phones and maximum
allowed scene timings. At most 104 calls fit the 420-second phone window, so
the existing 128-event representation remains sufficient. The live server
restarted and returned to Ended, preserving saved settings, rain strength,
identities, source observations, total water and cell count. Fully reload
phone pages to receive the revised levels and scheduler.

Evidence: `output/phone-balance-v33-tests.txt` and
`output/phone-balance-v33-live-verification.json`.
The updated 45-second single-phone preview is
`output/audio/phone-birds-crickets-balance-v33.mp3`, with exact authored gains,
Main disabled and no post-render normalization. It begins with crickets alone
until 6.58 seconds, then includes seven non-looping bird calls at the actual
4–8-second cadence. Event/source metadata is
`output/playwright/wildlife-v33-preview.json`; its isolated browser/server
were closed after export.


## Forest rain, calm arrival, regular crickets and smooth Main switching

Instruction 2 now says the phone stays silent “until the next scene begins.”
Main and phone still mount the exact same instruction source. Actual browser
checks compared their text and the Operator's 54% rain control. The shared
rain default, initial controls and client fallbacks now use 0.54; the live
saved strength was explicitly set to 0.54 while preserving other settings.
The calibrated default supply remains 33.5 seconds and refills while idle.

Held-tone amplitude motion now grows from four to eight seconds, reaching
±14% at 0.12–0.18 Hz. Fundamental pitch stays fixed. A native render measured
about 2.5 dB peak-to-peak movement, identical first-four-second samples, finite
unclipped 32-voice output and a silent release. Explicitly anchoring the
modulation depth at release prevents a trailing native ramp from interpolating
back toward the entrance instead of preserving the held depth.

Catalog revision 17 contains 51 entries, including four newly generated
recordings from the retained local Stable Audio workflow: a heavy canopy
downpour (`rain-canopy-heavy-v34`), two soft-air haze endpoints
(`haze-calm-air-v34` / `haze-calm-drift-v34`) and one regular cricket source
(`cricket-steady-phone-v34`). The rain prompt targets diffuse foliage and
forest-floor wash rather than roof/tile impacts. Calmer independent haze
takes replace the opening endpoints; offline filtering removes low wind
weight, and a fixed arrival-only −6 dB trim keeps normalization from undoing
the softer presentation. The old 47 full/mobile asset hashes remain intact.
The bounded local catalog limit rises from 48 to 64 to retain that provenance.
Technical validation does not certify perceived setting or animal species.

The new phone cricket bed uses 16 distinct excerpts from its new generated
source on a slow, nearly even grid. One native loop replaces three independently
offset perspective layers. At the retained 0.76 playback rate, native onsets
measure a median 1.200 seconds (1.190–1.220), including the loop seam. Phone
crickets are another 3 dB softer; birds are another 4.5 dB louder. Bird gain is
now 8.5 dB above the new cricket gain. Phone-only fixed active-note preparation
prevents quiet cricket gaps from amplifying individual notes; Main and rain
preparation stay sample-identical. Native 500–4000 Hz measurements put the
reference coo body about 7.6 dB above cricket notes. Bird timing remains
4–8 seconds room-wide with exactly one phone per call and Main-only orangutan.

The corrected phone drone keeps its prior output gain. A shared native
wavetable adds small upper harmonics; moving-bank weight rises from 0.20 to
0.28, with 0.8/1.0/1.2 Hz offsets for modestly deeper, faster beating. It still
uses six oscillators, one static shaper and two filters, without oversampling
or per-sample JavaScript. Twelve native before/after cases increased the
700–3500 Hz energy share; full-triad improvements were 1.38–3.71 dB, while
overall RMS changed by at most +0.073 dB. Cleanup and silent endings passed.

Main enable/unmute now uses a 0.85-second rounded activation fade; mute/disable
uses 0.65 seconds. A final output gate covers every Main path, including the
orangutan return, independently of score fades. Rapid reversals continue from
the current gain. Source cleanup and context suspension wait until the gate
is silent, with a bounded 60 ms cleanup allowance. Native waveform and real
audio-context checks confirmed continuous toggles, exact mute silence, no
overshoot, no premature suspension and complete destruction.

All 682 checks passed; one Windows-only launch check was skipped. The live
server restarted and returned to Ended with 54% rain. Scene/sound settings,
identities, source observations, total water, physical parameters and cell
count were preserved. Updated pages, modules and the new audio files responded.
All isolated verification browsers/servers were closed. Fully reload Operator,
Projection and phones to replace cached modules and decoded recordings.

Evidence: `output/scene-refinements-v34-tests.txt`,
`output/scene-refinements-v34-live-verification.json`,
`output/playwright/refinement-v34-ui-report.json`,
`output/playwright/held-tone-motion-v34-native-report.json`,
`output/playwright/cricket-v34-native-proof.json`,
`output/playwright/cricket-v34-rhythm-balance.json`,
`output/playwright/phone-drone-v34-independent-native-report.json` and
`output/playwright/main-fade-{native,device}-v35-report.json`.
The authored phone balance preview is
`output/audio/phone-steady-cricket-birds-v34.mp3`; Main is disabled and no
post-render normalization is added.


## Previous rain/haze restored and phone ending lifted

Catalog revision 18 restores the previous rain endpoints (`rain-natural-light`
and `rain-storm-v23`), haze endpoints (`haze-air-v23` / `haze-float-v23`) and
the earlier six-entry haze residue bank. The rejected v34 rain/haze recordings
remain inactive catalog studies with their files and provenance retained.
The quieter −6 dB arrival-only haze trim remains in effect. The new steady
phone cricket recording stays selected.

Phone crickets and bird calls are both 3.5 dB louder than the preceding mix.
Cricket gain changes from −12 to −8.5 dB relative to 0.04; the bird/cricket
gain difference stays 8.5 dB, so both rise by the same exact factor. Their
regular cricket rhythm, bird allocation, 4–8-second call spacing and score
fade remain intact.

All 682 checks passed, with one Windows-only launch check skipped. The live
server restarted and returned to Ended with the restored selections and new
phone level. Rain strength, scene/sound settings, identities, source data,
total water, simulation parameters and cell count were preserved. Fully
reload Operator, Projection and phones to replace decoded source banks and
the phone gain module. Evidence: `output/rain-haze-restore-phone-lift-tests.txt`
and `output/rain-haze-restore-phone-lift-live-verification.json`.


## Live phone mixer on Operator

The Operator's Mixer tab now includes a separate **Phone sound** section with
Overall phone level, Crackle, Rain, Crickets, Bird calls and Distorted drone
sliders. Each ranges from 0–200%; 100% retains the current authored balance.
Reset phone mixer returns only these six controls to 100%. Main layer/output
controls remain independent.

Phone trims are saved as `soundSettings.phoneMixer`, broadcast to connected
phones, restored for late/reconnecting phones and included in settings-file
export/import. Earlier saves and presets receive unity defaults. Each remote
channel has a small native gain stage downstream of its asset envelope;
Overall phone level covers every phone path before existing output protection.
Audible edits use short rounded ramps while preserving scene and cricket-fade
automation. Slider changes do not create or resume an audio context, fetch
recordings or restart sources. Participants still enable audio locally and
choose their device's media volume.

Phone-only updates skip unrelated Main/macro/automation changes. Concurrent
channel edits merge in the Operator's existing save batch; pending sliders
resist stale server echoes, and a failed save restores confirmed phone values.
Reload Operator and phones once to load this feature; subsequent changes
arrive live without refreshing pages.

Muted, hidden, disabled or suspended phones commit trim targets immediately;
unfinished ramps also settle before the audio context resumes. This prevents
a channel set to zero from briefly replaying its earlier gain after returning.
The six trims add 81 bytes to the default phone summary; existing compactness
budgets retain their original margin with that exact schema allowance.

Final validation: 702 checks passed and one Windows-only launch check skipped.
Browser checks verified all six slider values reaching a phone in one batch,
saved values after reload, independent resets, stale-echo protection, failed
save rollback and narrow-screen layout. An enabled native phone in Scene 4
reached exact silence through the drone and overall trims while keeping the
same six oscillators and crackle source. Phone-only edits called no unrelated
macro, Main mixer, automation or local-level setters. Verification used a
silent test sink and isolated server, both closed afterward.

The live server restarted and returned to Ended with all phone controls at
100%, preserving the authored balance, rain strength, Main settings, source
observations, identities, physical parameters, total water and cell count.
Evidence: `output/phone-mixer-full-tests.txt`,
`output/phone-mixer-settings-tests.txt`,
`output/playwright/phone-mixer-ui-report.json`,
`output/playwright/phone-mixer-enabled-ui-report.json` and
`output/live-phone-mixer-verification.json`.


## Scene fades retain the current Main mix

The Scene 1→2 haze surge came from removing the arrival-only −6 dB recording
trim at the cue boundary, immediately before the timed fade. That calibration
now follows the opening haze through Instructions. Native audio comparison
measured the first-half-second surge falling from 5.836 dB to 0.000 dB, at
both unity and a reduced Main haze fader setting.

Main cue transitions capture the outgoing pre-mixer scene balance and macro
character, then move toward the destination endpoint on its cue trajectory.
Early, skipped, repeated, rapid and reverse cues no longer invent a full
forest starting level or abruptly remove the remaining haze/drone. Captures
include field attenuation so reversing the ending cannot restore a faded
rain layer to full amplitude while its bus reopens. Manual texture settings
remain manual; downstream mixer trims stay live and are never baked twice
into a captured scene weight.

Main output volume now has its own smooth 160 ms native trim, separate from
the score master. This removes ending-volume steps when a new master curve
is scheduled. The common trim also covers the Main wildlife return exactly
once. Voice and Tail controls remain independent and live through reversed
cues, including zero→nonzero changes on the same ongoing call. Inactive or
interrupted contexts settle the requested output level before resuming.

The Operator also protects pending Main output, macro and automation edits
from older shared-state packets. A reproduced 25% output edit previously
returned to 55%, and 22% Manual haze returned to 35% Automatic; both now retain
the pending edit. Confirmed later remote edits take over after release, failed
saves restore confirmed values, and old failures cannot undo newer edits.
Existing Main channel and phone mixer guards remain in effect.

For manual phone cues, an early Forest takeover→Final rain carries the
current distorted-drone weight instead of jumping to full strength. Returning
phones to Arrival/Instructions uses a 350 ms native master exit while holding
only already-sounding sources, then cleans up in silence. Mute, hide, disable
or interruption discards that exit so it cannot replay on resume. The normal
phone entry, transfer and ending curves remain sample-identical.

Final validation: 723 automated checks passed; one Windows-only check skipped.
Independent native verification passed 23 objective checks across 29 scenarios,
including forward/early/rapid/reverse cues, manual mode, custom/zero trims,
ending output edits, pause/resume and live orangutan-tail changes. All output
remained finite and unclipped; the normal phone ending's maximum sample
difference was zero. An actual isolated Operator/iframe check also retained
muted haze and 60% forest through a cue inside the save debounce, with a
monotonically falling haze gain. These are native/browser checks, not a claim
of listening on every phone or loudspeaker system.

The running server serves the final checked files directly; no restart,
performance reset or live setting mutation was needed. Reload the host
Operator, any controller pages and phones once, then enable Main sound again.
All isolated verification browsers and servers were closed.

Evidence: `output/scene-transition-final-tests.txt`,
`output/scene-transition-live-verification.json`,
`output/scene-transitions/native-transition-summary.json`,
`output/scene-transitions/native-transition-final.json`,
`output/playwright/scene-transition-ui-report.json` and
`output/playwright/main-controls-echo-final-report.json`.

## Drone beating, rain loop and orangutan release · 7 November 2026

The phone distorted drone rises four semitones from its previous register
(a major third; now sixteen semitones above Main). The moving bank increases
from 28% to 38%, with minimum pair offsets of 1.4, 1.7 and 2 Hz instead of
0.8, 1 and 1.2 Hz. This gives the beating more depth and speed while retaining
six native oscillators, the existing harmonic spectrum and output trim.
The live phone Drone slider continues to control its balance.

The restored `rain-storm-v23` recording contains about 700 ms of near-silence
at its tail. The former 400 ms trim limit left part of it in the loop overlap.
Rain loop preparation now removes quiet edges for up to two seconds or 10%
of the recording before the existing equal-power join. The selected rain
recording, its interior weather dynamics and the native looping perspectives
are retained; cricket rests keep their separate short join.

Main orangutan reverb increases from 12% wet / 1.65 seconds to 24% wet /
2.8 seconds, retaining the dark 1.4 kHz return. Each phrase now has a smooth
three-second release that keeps its original position after a pause. A native
gate shared by dry voice and reverb reaches exact silence over the last six
seconds of the ending (or the full phone fade when shorter). Reverse cues
hold that gate at its current level while the existing scene fade carries the
call, so the old ending deadline cannot cut it off. Voice and Tail sliders
remain independent; phones still never load or play the orangutan recording.

Validation: 218 audio checks pass. Native drone rendering measured the
four-semitone shift and deeper beating (isolated pair: 5.95→9.76 dB,
1→1.7 Hz). The actual heavy-rain loop's 4.11 dB join dip is removed, with
all six original rain sources continuous for 150 seconds. Fourteen Main
orangutan cases cover real phrases, custom endings, pause/resume, live trims,
mute and reverse carry; phone wildlife remains sample-identical. These are
native audio measurements, not physical speaker listening tests.

The active packaged server now serves the three checked audio modules too;
its scene/settings were preserved and it was not restarted. Reload Operator
and phones once, then re-enable sound. Verification browsers and isolated
servers have been closed.

Evidence: `output/audio-refinements-nov7-audio-tests.txt`,
`output/audio-refinements-nov7-live-verification.json`,
`output/playwright/phone-drone-v37-native-results.json`,
`output/playwright/phone-drone-v37-mixer-results.json`,
`output/playwright/rain-loop-audit/summary.json` and
`output/orangutan-reverb-fade/native-summary.json`.

## Recovery during a performance

A phone that joins, reloads or needs to resume audio during the dark ending
shows a small sound-recovery button. Tap it to enable or resume sound; the
control disappears once playback works. This also works in fullscreen.
Working phones and the completed performance remain black.

Transient recording-download failures retry automatically after 1, 3 and
8 seconds, with a 12-second download timeout. Sound on can start another
attempt after those retries are exhausted. During the cricket ending, a
phone whose current cricket download still needs recovery exposes the same
button. Missing or invalid recordings do not download repeatedly.

Phone map assets retry automatically up to three times. If they still cannot
load, check the Wi-Fi connection and use **Retry map**. A successful retry
restores participation without a page reload.

Ground strength and timing prepared before the first Start now survive a
restart. If the source snapshot is empty, Final rain still runs its full
configured rise and then completes the ending; no fire counts are invented.

## Held-tone motion, bell balance and first-drag magnifier

Held-tone motion still begins four seconds after that geographic patch's
native voice starts. It now reaches full depth within one second, at ±32%,
with a 0.32–0.42 Hz cycle. Previously the four-second rise and 0.12–0.18 Hz
cycle left very little motion just after four seconds. Pitch stays fixed;
the native gain modulation, smooth release and bounded voice pool remain.
The native LFO starts at four seconds with only 0–150 ms of phase variation,
so notes admitted together have a clearer first swell instead of averaging
away through widely scattered starts; their differing speeds then separate.
Dragging into a newly admitted patch starts that patch's own four-second
clock. Many independently moving notes can sound less like a single pulse.

Main bells now have individual note trims rather than one gain for each
octave. Relative to the 0.026 base: C3 0 dB, G3 −2 dB, C4 0 dB, G4 +2 dB,
C5 +6 dB and G5 +6 dB. Compared with the previous mix, only G3 (−2 dB),
G4 (+2 dB), C5 (+2 dB) and G5 (+2 dB) change. The 12/10/8-second register decays,
inharmonic partials and spatial placement are retained. These are fixed
calibration trims; participant counts do not turn bells down.

The 2× phone magnifier paints the first touch immediately. During movement,
its small cached-map crop refreshes on the next animation frame, coalescing
input and capping sustained copies at 60 Hz. Idle lens animation remains
24 Hz and the main map remains 20 Hz. Its 124 CSS-pixel diameter and maximum
186-pixel backing canvas are unchanged. A quick release flushes the final
point; hiding cancels pending callbacks. No extra map, simulation or network
request is added.

Each phone chooses one distorted-drone transposition when its audio controller
is created: the current register, +3 semitones (minor third), +8 semitones
(minor sixth), or +12 semitones (octave), with equal probability. That choice
stays fixed through updates, mute/resume and scene re-entry for the page's
audio session. Reloading the phone can choose again. The entire drone voice
follows the choice; its six oscillators, fixed-Hz beating and output trim are
retained. The existing phone Drone mixer slider still controls all variants.

Restart performance is now directly available in the main Performance tab,
beside Pause. It keeps the existing reset behavior: fresh landscape and paused
Arrival, preserving sound settings, timings and audience information. Setup
no longer contains a duplicate restart panel.

Validation: 817 checks pass with one native Windows launch check skipped on
macOS. Native Main-output renders measured 8-note held motion increasing
from 1.07 to 4.79 dB at 5–8 seconds, and 32-note motion from 1.57 to 5.36 dB.
The first four seconds retain their original sound; short releases cannot
start late motion. Bell K-weighted active-body spread falls from as much as
5.68 dB to 2.27 dB across the tested left, center and right positions, with
only 0.19–0.38 dB change in ensemble energy. Overlapping bell bursts remain
finite and unclipped. This improves the note family while retaining spatial
color; actual PA speakers and room acoustics still affect perceived balance.

In an isolated phone-page browser check, with venue messages delayed 400 ms,
median immediate-drag crop delay fell from 78.9 to 11.1 ms. This is browser
verification, not a physical-phone latency measurement. The moved Restart
button was checked at 1440, 1024, 390 and 320 CSS pixels, including reset from
Participation and Ended and from a silent remote controller. Each action
keeps settings and sends only one reset.
All four phone-drone variants also passed native phone-output checks, with
the requested pitch steps, unchanged gain trim, six active oscillators and
exact silence after mute. Their measured RMS span is 0.57 dB.

Evidence: `output/listening-operator-final-tests.txt`,
`output/held-tone-audibility/native-summary.json`,
`output/playwright/bell-balance/summary.json`,
`output/magnifier-first-drag/summary.json` and
`output/operator-restart-layout/report.json` and
`output/phone-drone-transposition/native-summary.json`.

## Larger water supply and audio-led Participation entrance

Rainwater capacity increases by 1.5× from the previous setting: 33.5→50.25
seconds at defaults, with the same proportional increase for custom cooling
timings. Capacities serialize at millisecond precision. Automatic idle refill
still takes 12 seconds; a finger held down at empty cannot recharge or add
water. Rain strength and the landscape's cooling physics are unchanged.

For the initial Scene 2→3 entrance, the existing transition duration is now
split into three parts. The low Main drone rises over 40% of the configured
sound transition; the complete instruction panel, Wi-Fi and QR then remain
fully visible for a fixed 4.8 seconds with the drone fully on; finally, the
landscape and complete panel crossfade over another 40% of that setting.
At the default 12-second sound setting, this is a 4.8-second drone rise,
4.8-second full-instructions hold, then a 4.8-second map reveal: 14.4 seconds
overall. Other sound ramps retain their timing, and
later returns to Participation do not show the instructions again.

Every display computes the same visual curve from the shared show clock,
including after pause or a late join. A delayed cue on an already-running
Main output catches the drone up over 850 ms rather than stretching its old
zero level across the entire remaining visual transition. Mixer trims and
Main volume remain downstream and live. No extra scene or preset fields
are serialized.

Following listening feedback, the highest bell pair (C5/G5) is reduced by
3 dB from the preceding calibration. Current note trims relative to the
0.026 base are C3 0, G3 −2, C4 0, G4 +2, C5 +3 and G5 +3 dB. This is an
intentional register balance correction; the earlier K-weighted equal-body
measurements describe the prior +6 dB upper pair. Natural decay, partials,
placement and the lower four note trims are retained.

Validation: 832 checks pass; the native Windows launch check is skipped on
macOS. Native three-view verification confirms the full drone beneath fully
opaque instructions throughout the fixed hold, followed by map reveal on
projection and phones. Existing 350 ms CSS opacity smoothing settles the
14.4-second nominal reveal by about 14.9 seconds in that browser. Main output
and drone mixer trims stay unchanged. Late cue catch-up, pause, late join and
manual return also pass. Native bell output confirms a 3.000 dB reduction for
both upper notes; lower control notes and natural decays are unchanged, with
finite, unclipped overlapping bursts.

Evidence: `output/water-entry-bells-final-4p8-tests.txt`,
`output/rain-supply-1point5/focused-tests.txt`,
`output/drone-before-landscape/fixed-hold-summary.json`,
`output/drone-before-landscape/summary.json` and
`output/bell-register-listening/native-summary.json`.
