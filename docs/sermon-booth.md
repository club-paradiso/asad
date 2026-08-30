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
