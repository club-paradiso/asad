# Counter Mode shared storage

Counter Mode pairs two devices through a short-lived server session. On a local or single-process Node server, the built-in in-memory store is enough. On Vercel or any multi-instance/serverless deployment, use a shared Redis store so the host, guest, polling requests and message requests all see the same session.

## Recommended production setup: Upstash Redis on Vercel

The Vercel Marketplace offers Upstash Redis as a native integration. Link an Upstash Redis resource to the `tong-yuck` Vercel project and redeploy. The integration injects the Redis REST credentials into the project environment.

tong-yuck automatically recognises either of these credential pairs:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

or the Vercel integration-style names:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

No `COUNTER_STORE` switch is needed. A complete Redis URL/token pair selects the shared store automatically; otherwise the app uses the in-memory fallback.

## Behaviour

- Session keys are namespaced under `tong-yuck:counter:session:v1:`.
- Every session receives a four-hour Redis TTL.
- Sending, joining or otherwise mutating a session refreshes that TTL.
- Ending a conversation deletes the Redis key immediately.
- Message history remains capped at 500 messages per session.
- Room-code creation uses Redis `SET ... NX` so two instances cannot claim the same code.
- Session mutations use an atomic Lua compare-and-set with retries. Concurrent host/guest writes therefore merge against the newest session instead of silently overwriting a message.
- Polling remains uncached and can run from any Vercel function instance.

## Privacy

Shared storage changes one important property of Counter Mode: session contents are no longer process-local memory. While a conversation is active, its short-lived state is stored in the configured managed Redis service.

The application still does not create a durable conversation archive:

- sessions expire after four hours of inactivity,
- the end action deletes the session immediately,
- diagnostics expose counts and storage metadata only, never room codes or message text,
- application logs must not print session payloads or Redis credentials.

For deployments handling sensitive consultations, treat the Redis resource and its credentials as sensitive infrastructure. Restrict project access and rotate credentials according to the provider's operational guidance.

## Verify the deployed store

Open `/api/diagnostics` on the deployed application and inspect `counter.storage`.

A correctly configured production deployment should report values equivalent to:

```json
{
  "kind": "redis",
  "shared": true,
  "configured": true,
  "source": "upstash"
}
```

If it reports `kind: "memory"` and `shared: false`, the app is still running the local fallback and Counter Mode is not safe against cross-instance session loss.

## Local development and tests

No Redis service is required locally. With no Redis credentials, tong-yuck keeps using the deterministic in-memory store. Unit and end-to-end tests therefore remain self-contained unless a test explicitly constructs the Redis store.
