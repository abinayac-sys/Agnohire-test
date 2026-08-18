// Entry point wrapper — MUST run before anything else. Native async work
// (bcrypt hash/compare, crypto, DNS lookups, fs) is farmed out to libuv's
// threadpool, which defaults to only 4 threads regardless of CPU count.
// Under mass-login load (thousands of candidates + staff hitting
// bcrypt.compare concurrently), that 4-wide pool serializes everything else
// waiting on the same pool behind login traffic. UV_THREADPOOL_SIZE must be
// set before Node's first threadpool-consuming call, and env vars set from
// within app.ts itself are too late (module imports run before any of app.ts's
// own code). This file sets it, then dynamically imports app.ts so the real
// entry point only loads after the env var is in place.
process.env.UV_THREADPOOL_SIZE ??= '64';

await import('./app.js');
