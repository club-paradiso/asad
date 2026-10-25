# Zero-budget audio bridge: MacBook Air M1 ↔ SIU-1000 feasibility

**Verdict: `HARDWARE_TEST_REQUIRED`**, with a firm sub-finding of
**`PHYSICAL_CONNECTION_BLOCKED` for the equipment exactly as listed.**

Nothing in this document is a recommendation to buy anything. It records what
the Mac can do, what the listed cables can and cannot do electrically, what
was verified on this machine on 2026-10-25, and the exact ten-minute test to
run in the booth that turns `HARDWARE_TEST_REQUIRED` into one of the other
verdicts. A detected device is never reported here as a captured signal.

## 1. What was verified on the machine

| Fact | Evidence |
| --- | --- |
| MacBook Air (M1, 2020), `MacBookAir10,1`, macOS 15.6.1, 8 GB | `system_profiler SPHardwareDataType`, `sw_vers` |
| Audio devices seen by CoreAudio at the time of audit | [`evidence/2026-10-25-macbook-air-m1-devices.json`](./evidence/2026-10-25-macbook-air-m1-devices.json) |
| USB bus | **empty** on both USB 3.1 controllers — the Daiso adapter was not connected during the audit |
| 3.5 mm jack | no `External Microphone` data source present — nothing was plugged into the jack |
| Built-in microphone captures real samples | [`evidence/2026-10-25-builtin-mic-capture.json`](./evidence/2026-10-25-builtin-mic-capture.json): `USABLE`/`TOO_LOW` depending on room noise, 44.1 kHz mono, frames flowing |
| Microphone permission for the shell | authorised (the probe asked once through `AVCaptureDevice.requestAccess`) |

Devices enumerated:

| # | Device | Transport | In / Out | Can macOS record from it? |
| --- | --- | --- | --- | --- |
| 0 | MacBook Air 마이크 | built-in | 1 / 0 | yes — acoustic, hears the room |
| 1 | MacBook Air 스피커 | built-in | 0 / 2 | no, output only |
| 2 | ‘좌영춘의 Z Fold8’ 마이크 | continuity-wired | 1 / 0 | yes — a phone microphone, acoustic |
| 3 | ZoomAudioDevice | virtual (Zoom) | 2 / 2 | yes — carries whatever Zoom plays, nothing else |
| 4 | 다중 출력 기기 | aggregate | 0 / 2 | no, output only |

None of these is a path from the SIU-1000. Items 0 and 2 are microphones in
the air; item 3 only carries audio if the sermon is already inside a Zoom
meeting on this Mac.

## 2. The connectors, electrically

### 2.1 The Mac's 3.5 mm jack

The M1 MacBook Air's jack is a **TRRS combo socket**: stereo headphone output
on tip and ring 1, and a **headset microphone input** on ring 2 (CTIA
layout), with a small bias voltage for an electret capsule.

Three consequences matter here:

1. **It is a microphone-level input, not a line input.** Apple's spec sheet
   for this model lists a headphone jack only; there is no line-in. A
   headphone or line output from the console is typically 20–40 dB hotter than
   a headset capsule. Reducing the input volume in System Settings attenuates
   *after* the analogue stage, so a hot source can clip before software ever
   sees it. The probe's `capture` command reports clipping precisely so this
   is measured rather than argued.
2. **Microphone detection is by impedance on ring 2.** The codec decides at
   plug-in whether the plug carries a microphone by the resistance between
   ring 2 and sleeve. A plain stereo (TRS, three-pole) plug shorts ring 2 to
   sleeve and is treated as headphones only: **no input device appears at
   all.** Community reports on M1-era Macs match this: a two-ring plug does
   not register a microphone, a three-ring (TRRS) one does. A console
   headphone output presents a very low impedance that may also read as "no
   microphone" even on a TRRS lead. This cannot be settled from a datasheet;
   it is what the booth test below is for.
3. **The jack is one-directional per contact.** Audio from the Mac goes out on
   T/R1; audio into the Mac comes in on R2 only, mono.

### 2.2 The PC headset splitter (TRRS female → green TRS male + red TRS male)

This adapter exists to let a *TRRS headset* plug into a *PC with two separate
jacks*. Its wiring is fixed:

- socket tip / ring 1 (headset earpieces) → **green** plug tip / ring
- socket ring 2 (headset mic) → **red** plug tip (and usually ring)
- socket sleeve → both plugs' sleeves

The green and red plugs share **only ground**. There is no path from one to
the other, and no path from either plug into the socket's microphone contact
except from the red plug itself. So:

- Plugging the **green** plug into the console's headphone output puts console
  audio on the socket's earpiece contacts — useful only for listening on a
  TRRS headset, not for reaching the Mac.
- Plugging the **red** plug into the console's headphone output puts console
  audio on the socket's microphone contact. Reaching the Mac from there needs
  a **TRRS male-to-male lead**, which is not in the inventory. The red plug
  into the Mac directly is a three-pole plug: headphones, no microphone.
- Plugging an ordinary aux lead into the socket (if one were found) connects
  it to the green plug's side, never to the microphone contact.

**Conclusion: with this splitter alone, no combination delivers console audio
to the Mac's microphone contact.** It is the wrong direction of adapter. The
adapter that *would* do it is the mirror image — a **TRRS male** on one end
and separate headphone/microphone **female** sockets on the other (sold as a
"headset Y adapter for laptops"); plugging an aux lead from the console into
its pink/microphone socket would present the console on the Mac's ring 2 with
the correct plug geometry. Nothing in the listed inventory is that adapter;
churches often have one in a drawer, so it is worth one look before anyone
concludes a purchase is needed.

### 2.3 The Daiso USB-C "charging + audio" adapter

These dongles are one of two things, and the label never says which:

- **Passive analogue pass-through.** Works only on phones that put analogue
  audio on the USB-C pins. A Mac does not. **No audio device will appear at
  all.**
- **A USB Audio Class codec.** Appears to macOS as a USB device with one or
  two output channels and, on most such chips, **one microphone input
  channel** expecting a CTIA headset. In that case it behaves exactly like the
  built-in jack in §2.1, including the TRRS-detection and mic-level caveats,
  but with its own (usually cruder) ADC.

When the adapter is connected, `audio-probe list` answers this in one line:
either a new `usb` transport device with `input 1 ch` appears, or nothing
does. The audit could not run that line because the adapter was not present.

### 2.4 The in-ear monitors

They are transducers on the console's headphone output. They are not a cable
and play no part in any capture path. The design goal — the interpreter keeps
hearing the floor through them, through the church system — is unaffected by
everything else here.

### 2.5 The console side

No manual or specification for an "SIU-1000" interpreter unit could be found
online under that name (searches in Korean and English returned unrelated
products). The only facts that matter are printed on the unit itself:

- whether it has a **REC / LINE OUT / AUX OUT** socket in addition to the
  interpreter headphone socket (a line output is the right source; a
  headphone output is usable with attenuation);
- the socket size (3.5 mm or 6.35 mm) and whether the headphone output is
  stereo or mono;
- whether that output carries the **floor (original) channel only**, or can
  be switched to it. If it carries the interpreter's own channel, the
  mix-minus rule in [`sermon-booth.md`](../sermon-booth.md) is violated and
  ASAD will hear English as Korean.

Photograph the rear and front panels before the booth test; every answer
above is on them.

## 3. Software-only alternatives, honestly classified

| Path | Class | Available here? | Verdict |
| --- | --- | --- | --- |
| Console → cable → Mac jack / USB codec | direct physical capture | blocked by inventory (§2.2); unverified electrically (§2.1) | `HARDWARE_TEST_REQUIRED` |
| Church broadcast / streaming computer → loopback (BlackHole) or network | existing digital source | unknown — depends on whether the church runs one and where it stands | not evaluated; would be a `SOFTWARE_ONLY_ALTERNATIVE` only if that computer already receives the floor feed |
| Sermon inside a Zoom/Teams meeting on this Mac → `ZoomAudioDevice` as ASAD input | existing digital source | the virtual device exists on this Mac; whether the service is in a meeting does not | conditional; latency 0.3–1 s, acceptable; not a booth feed |
| MacBook microphone / Continuity phone microphone | acoustic capture | yes, verified capturing | **not a solution for this booth**: the sermon is not audible on speakers in the booth, and an in-ear held to a laptop microphone is not a feed |
| Headphone output → "line in" | unsupported connection | this Mac has no line input | impossible |

An acoustic path is never reported by ASAD or by this document as direct
signal capture. The launcher and the preflight now say in words when the
selected input is the laptop's own microphone or a phone.

## 4. The booth test (ten minutes, no purchases)

Run on the MacBook, in the booth, with the console powered and the floor
feed live. Build the probe once:

```bash
cd tools/audio-probe && ./build.sh
```

1. **Watch while plugging.**
   ```bash
   ./audio-probe watch
   ```
   Then plug the Daiso adapter into the Mac. One of two lines appears:
   `+ added … transport usb · in 1 ch` (the adapter has a codec with a
   microphone input — continue) or nothing (passive dongle — the adapter
   cannot be an input; skip to step 4).
2. **Present the console to the input.** Using whatever TRRS-ended lead can be
   found (see §2.2 for which adapter geometry works), connect the console's
   line/record output — or, failing that, a spare headphone output at low
   volume — to the adapter's socket, or to the Mac's own jack. `watch` prints
   `input source now: External Microphone` (jack) or a data-source change on
   the USB device when the plug is detected as a headset. If no input source
   appears, the plug was detected as headphones: the lead is three-pole, or
   the source impedance is too low for the detector. That is a
   `PHYSICAL_CONNECTION_BLOCKED` result for that lead; try the other adapter
   geometry before giving up.
3. **Capture while the floor is live.**
   ```bash
   ./audio-probe capture --device "External Microphone" --seconds 15 --wav /tmp/floor.wav
   # or:  --device "USB"   (the probe matches on a substring of the name)
   ```
   Read the verdict line:
   - `USABLE` — real samples at speech level. Listen to `/tmp/floor.wav`
     to confirm it is the preacher and not the room; then open
     `/booth-preflight` in Chrome, choose the same device, and confirm the
     meter moves with the sermon and **not** with the interpreter's own
     microphone. Only then is the overall verdict `DIRECT_CAPTURE_VERIFIED`.
   - `CLIPPING` — turn the console output down and repeat. If it still clips
     at the lowest usable monitor volume, the source needs a passive
     attenuator; record the result as `INPUT_CAPABILITY_PRESENT_BUT_ROUTE_UNVERIFIED`.
   - `SILENT` or `TOO_LOW` — the input exists but the console is not reaching
     it: wrong console socket, muted channel, or a lead wired as in §2.2.
   - `NO_SAMPLES` — macOS enumerates the device but delivers no buffers;
     unplug, replug, repeat once.
4. **If no input ever appears**, the result is `PHYSICAL_CONNECTION_BLOCKED`
   for the inventory, and ASAD continues to be useful for everything that does
   not need the feed — preparation, terminology, Scripture, Rescue — with the
   browser recogniser on whatever microphone is available.

Keep the console's interpreter headphone feed to the in-ears exactly as it is
throughout. Nothing above touches the church's interpretation output path.

## 5. What ASAD now does with whatever path exists

Independently of the verdict, the application side of the bridge is
implemented and tested (see [`../audits/asad-autonomous-audit.md`](../audits/asad-autonomous-audit.md)):

- the capture path measures every frame it sends and the console says
  **No signal** after twelve silent seconds and **Input too loud** on
  sustained clipping, naming the exact device in Session settings;
- the launcher and the preflight classify the selected input (built-in
  microphone, phone, Bluetooth, USB, external jack, virtual) and say in
  Korean when it is not a console feed;
- `/booth-preflight` is a four-step volunteer checklist with a
  symptom-by-symptom troubleshooting list;
- `/diagnostics` has a local level check that tells no device, wrong device,
  permission denied, no signal, weak signal and clipping apart;
- the 48 kHz → 16 kHz resampler feeding cloud recognisers no longer drops
  1.6 % of its samples or aliases content above 8 kHz into the speech band.

ASAD never silently falls back from a selected input to the laptop
microphone; that rule predates this work and is unchanged.

## 6. Limits of this document

- The SIU-1000's outputs are unknown; everything about it above is
  conditional on its panel.
- The Daiso adapter's internals are unknown until it is plugged in.
- No cable in the inventory was tested because none can complete a path.
- The probe's verdict is about samples, not provenance: a `USABLE` reading
  from the built-in microphone is a working microphone, not a console feed.
