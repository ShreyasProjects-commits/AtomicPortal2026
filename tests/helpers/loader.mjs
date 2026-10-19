// Node can't import https:// modules, which the Supabase Edge Functions use
// (Deno style). This hook swaps those two imports for local stubs so the real
// function code can be loaded and tested without changing any production file.
const STUBS = {
  "https://deno.land/": new URL("./stubs/deno-server.mjs", import.meta.url).href,
  "https://esm.sh/": new URL("./stubs/supabase-js.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  for (const [prefix, url] of Object.entries(STUBS)) {
    if (specifier.startsWith(prefix)) return { url, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
