/**
 * A `process` global, so `next/link` can be imported in a browser.
 *
 * `next/link` reads `process.env.__NEXT_ROUTER_BASEPATH` at module scope. In
 * the app that name is substituted at build time by the bundler; here the
 * module is loaded as-is and there is no `process` in a browser, so the import
 * throws `ReferenceError: process is not defined` before a single test runs.
 *
 * An empty `env` is the right stand-in rather than a fuller fake: every value
 * Next reads through it is optional, and supplying one would be inventing a
 * configuration the app does not have.
 *
 * This must be the first import of any suite that reaches `next/link`. ES
 * modules evaluate in import order, so being first is what makes it run before
 * the link module's body.
 *
 * The cast, rather than a `declare global`: `@types/node` already declares
 * `process` as Node's full `Process`, and re-declaring it as this narrower
 * shape is a type error. Widening `globalThis` locally says what is true —
 * something may or may not be there, and after this line something is.
 */
const runtime = globalThis as unknown as {
  process?: { env: Record<string, string | undefined> };
};

runtime.process ??= { env: {} };

export {};
