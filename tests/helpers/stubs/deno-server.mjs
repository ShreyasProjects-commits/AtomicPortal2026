// Stand-in for deno.land's `serve`: just remember the handler so tests can call it.
export function serve(handler) {
  globalThis.__capturedHandler = handler;
}
