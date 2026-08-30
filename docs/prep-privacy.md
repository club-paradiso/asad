# Prep privacy

Prep can contain substantially more sensitive material than one live interpretation turn: a speaker's name, pastoral notes, testimonies, and sometimes an entire unpublished sermon outline or manuscript.

For that reason, **opening `/prep` or typing into the form does not authorise cloud processing.** The form is stored in this browser as ordinary Prep state. Cloud processing is a separate action.

## Building an AI interpretation brief

When the configured LLM routing chain includes a free-tier provider that may use submissions to improve its products, ASAD shows a Prep-specific disclosure **before** the first cloud brief request.

The disclosure names the providers reported by `/api/config` and explains that the Prep material may be sent to them. Prep has its own acknowledgement key; accepting the live-session disclosure does not silently authorise uploading an entire Prep outline.

If the routing/privacy configuration cannot be determined, Prep fails closed. An unknown provider state is not treated as permission to upload the material.

## Build local-only brief

`Build local-only brief` is a real local path, not a cosmetic label.

It runs the deterministic Prep engine directly in the browser and uses:

- the speaker/title/organisation fields already on the page;
- Scripture reference normalisation;
- the built-in and community terminology matchers;
- local name romanisation;
- local cultural/wordplay detection;
- the genre-specific interpretation difficulty and anticipated-phrase rules.

It does **not** call `/api/prep`, and no Prep content is sent to an AI provider.

The server's existing deterministic fallback remains in place for ordinary cloud-route failures, but explicitly choosing local-only never needs that server round trip.

## Consent semantics

There are two distinct choices:

- **Accept cloud processing:** the workflow-specific acknowledgement may be remembered in this browser so the same disclosure is not shown on every use.
- **Choose local-only:** this is **not** stored as permission for future cloud processing. A later attempt to use cloud preparation must still satisfy the cloud-consent gate.

This distinction also applies to Live Mode. Choosing a local-only alternative is evidence that the user declined cloud processing for that run; it cannot be transformed into remembered cloud consent for a later run.

## Session terminology

The Session terminology editor is browser-local. Adding, editing, overriding or removing Korean → English terminology does not make a model request. Those terms only become part of a cloud prompt later if the interpreter separately chooses an authorised cloud workflow.

## Operational rule

If an outline contains anything that should not leave the room, use the local-only brief and keep the live interpretation route local as well. The fact that an AI provider is convenient or free is not a privacy policy.
