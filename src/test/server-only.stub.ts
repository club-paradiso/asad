/**
 * Stand-in for the `server-only` package under test.
 *
 * That package exists to make a build fail loudly if server code is imported
 * into a client bundle, and it does that by resolving to a module that throws
 * under any browser-ish condition. Vitest runs in jsdom, so it trips the guard
 * and no server route can be imported into a test at all.
 *
 * Aliasing it here keeps the guard doing its real job in `next build` — which
 * is where it matters — while letting route handlers be tested directly.
 */
export {};
