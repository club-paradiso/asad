# Sermon Mode: booth product contract

## Product premise

ASAD Sermon Mode is an **AI copilot for a human simultaneous interpreter working inside an existing church interpretation setup**.

A supported church already has:

- a human interpreter or interpretation volunteer;
- an interpretation booth, room, or dedicated operating position;
- a microphone used by the interpreter;
- an existing audio path that delivers the interpreter's voice to foreign-language congregants;
- a church PA/broadcast system from which the Korean sermon can be monitored.

ASAD does not replace any of those pieces. It adds a second screen and an AI-assisted listening/context layer for the interpreter.

## Signal flow

```text
Korean speaker microphone
        |
        v
church mixer / broadcast system
        |
        +--> sanctuary / stream
        |
        +--> clean interpreter feed --> ASAD input
                                  |
                                  v
                          transcript + cues
                                  |
                                  v
                         HUMAN INTERPRETER
                                  |
                                  v
                    interpretation microphone
                                  |
                                  v
             existing church interpretation system
                                  |
                                  v
                       foreign congregants
```

The congregation receives the **human interpreter's voice through the church's existing equipment**. ASAD has no congregation-facing output path in Sermon Mode.

## What ASAD is responsible for

- Korean streaming speech recognition;
- short interpreter-ready English cues rather than subtitle prose;
- Scripture reference detection and normalisation;
- theological and church terminology;
- session-specific names and terminology from Prep;
- cultural references, idioms, humour and wordplay warnings/adaptation;
- bounded rolling context and terminology consistency;
- graceful degradation when the LLM is unavailable.

## What the human interpreter remains responsible for

- listening and deciding what matters;
- choosing whether to use, ignore or reformulate an ASAD cue;
- tone, pastoral register and delivery;
- correcting recognition errors and context mistakes;
- speaking the final English interpretation;
- ethical and pastoral judgement.

## Non-goals

Sermon Mode is deliberately **not**:

- audience-facing live captions;
- a QR sermon-translation page;
- AI text-to-speech sermon interpretation;
- a listener-facing translation app;
- a replacement for an interpretation booth or church distribution hardware;
- a replacement for a human interpreter.

Counter Mode is a separate product surface and may continue to use QR/session links. These non-goals apply specifically to Sermon Mode.

## Booth audio policy

For a real service, input quality outranks model cleverness.

Preferred order:

1. dedicated AUX / MATRIX / monitor feed from the church mixer;
2. USB audio interface receiving that feed;
3. broadcast-computer audio input;
4. device microphone only as a fallback.

The ASAD feed should contain the Korean speaker/program audio and should **not** contain the interpreter's own English microphone. A mix-minus feed avoids the recogniser hearing the interpreter and treating English output as new Korean input.

The launcher therefore treats **Input Device** and **Speech Recognition Provider** as different decisions. Deepgram/OpenAI can consume a specifically selected browser audio input; Web Speech uses the browser/system default input and cannot be reliably device-routed by ASAD.

### Exact-device rule

When the operator explicitly selects a mixer or USB audio interface, ASAD requests that exact browser device. The browser is not allowed to silently substitute another microphone.

This is deliberate. A missing mixer must be visible rather than turning into an apparently healthy session that is actually listening to a laptop microphone, room microphone or the interpreter's own output.

If a selected input is unavailable at startup, reconnect it or choose **System default**, then retry. If an audio track disappears during a running session, ASAD:

1. stops the affected capture path;
2. aborts in-flight interpretation work tied to that live engine;
3. marks STT/input health as down;
4. returns the console to a visible **Try again** state.

ASAD does not automatically fail over to another physical microphone.

## Booth preflight

Before a real service, open `/booth-preflight` from the home screen and verify the hardware path before starting Sermon Mode.

The preflight is deliberately local-only:

- it requests microphone/audio-input permission only after the interpreter presses **Test input**;
- it opens the selected browser-visible mixer or audio-interface input using the same exact-device rule as Live;
- it displays a coarse signal meter (no signal / low / usable / very hot) rather than pretending to be a calibrated dBFS meter;
- it does not start STT, call the interpretation API, or send the test audio to a cloud provider;
- stopping the test closes the AudioContext and every capture track;
- after permission is granted, the browser can expose real device labels so the operator can confirm the correct USB/mixer input;
- if that input disconnects during the test, the meter stops and the operator gets an explicit reconnect/reselect message.

The operator should also confirm the mix-minus invariant: the Korean speaker/program feed is present, while the interpreter's English microphone is absent from the ASAD input.

### Ready for live

Preflight reports **Ready for live** only after both conditions are true:

1. the current input test has actually observed a usable signal; and
2. the operator has explicitly confirmed mix-minus.

A verified signal remains latched after **Stop test** so the operator can finish the checklist without keeping the test stream open. Starting a new test, changing the selected device, a capture failure or a hardware disconnect clears that readiness.

A successful preflight proves only the local ASAD capture path. It does not replace a real sound check of the church's congregation-facing interpretation system.

### Handoff to the launcher

A completed Preflight is handed to the Sermon launcher as short-lived operational evidence, not as a permanent preference.

- the acknowledgement lives only in same-tab `sessionStorage`;
- it is scoped to an explicitly selected physical audio device; the mutable
  **System default** alias is deliberately never carried as verified;
- it stores only the opaque device id and check timestamp;
- it expires after four hours;
- losing readiness or changing the Preflight input clears it immediately;
- no audio, transcript, device label, church name or service metadata is stored.

For raw-audio Sermon STT, the launcher's existing **Input** readiness row is `Ready` only when that fresh acknowledgement matches the selected device. Otherwise the row is `Limited` and recommends Booth Preflight. Starting remains possible: Preflight is a safety aid, not a hard gate that can lock an interpreter out during an emergency.

## Rescue

Rescue is an emergency re-entry aid for a human interpreter who has fallen behind the current thought.

During an active, non-Demo Sermon session:

- press **Rescue · R** or the `R` key;
- ASAD builds a bounded request from recent stable Korean context;
- Rescue returns at most a couple of short, speakable English bridge cues;
- the cue is displayed separately from the normal English stream and is not added to session history;
- the cue expires automatically;
- dismissing a loading Rescue aborts that Rescue request;
- leaving the active booth lifecycle (disconnect, settings/correction work, mode change or session end) unmounts Rescue and aborts any in-flight Rescue request.

Rescue never mutates the ordinary interpretation queue and does not replace listening or judgement. If no recent stable Korean is safe to use, it fails closed rather than inventing a bridge.

## Recognition terminology policy

Recognition hints are scarce and can bias the recogniser. ASAD therefore never sends the complete church glossary blindly.

The live STT hint budget is ranked as:

1. today's speaker;
2. prepared entities and names;
3. today's explicit Prep glossary;
4. glossary terms actually present in today's title, Scripture, notes or outline, including the volunteer 447-headword community glossary;
5. a conservative core set of common sermon terminology.

The recogniser receives at most 50 hints. The full glossary remains available to the local matcher and interpretation model after recognition.

## Failure principle

An ASAD failure must never become an interpretation-system failure.

If AI assistance stops, the interpreter continues speaking through the church's existing system. Local transcript stabilisation, Scripture detection and glossary matching should remain useful whenever their upstream recognition input is available. The booth must remain operational without ASAD.

This principle also means ASAD prefers a visible failure over a misleading fallback. A disconnected selected mixer is an error the operator can fix; silently changing to a different microphone is not resilience.
