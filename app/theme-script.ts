/**
 * The theme resolver that runs before first paint.
 *
 * The Claude Design artboard writes every variable onto
 * `document.documentElement.style` from JavaScript on mount. That is a canvas
 * runtime pattern and it flashes: the first paint happens before the script
 * runs. Here the stylesheet already carries both themes, and the only thing
 * that has to happen early is choosing which one — a single class toggle,
 * emitted as a blocking inline `<script>` in `<head>`.
 *
 * The server renders `<html class="dark">`, so dark is what a visitor with no
 * stored preference and a visitor with no JavaScript both get. The script only
 * ever removes the class, and only for a stored light preference.
 */

/** `localStorage` key holding the preference. Set by the artboard; kept. */
export const THEME_STORAGE_KEY = "aira-theme";

/** The two themes. Anything else in storage resolves to `dark`. */
export type Theme = "dark" | "light";

/** Class on `<html>` that selects the dark theme, per shadcn's dark variant. */
export const DARK_CLASS = "dark";

/** The theme the document is server-rendered with. */
export const DEFAULT_THEME: Theme = "dark";

/**
 * Resolve a stored value to a theme. Total: storage can hold anything, and
 * anything that is not exactly `"light"` means dark.
 */
export function resolveTheme(stored: string | null | undefined): Theme {
  return stored === "light" ? "light" : "dark";
}

/**
 * Source of the blocking inline script.
 *
 * Kept to one statement and wrapped in `try`, because it runs before anything
 * else on the page: a throw here — Safari private mode denying `localStorage`
 * is the usual one — would block the rest of the document. Failing means
 * keeping the server-rendered dark theme, which is the default anyway.
 */
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=s!=="light";var e=document.documentElement;e.classList.toggle(${JSON.stringify(
  DARK_CLASS,
)},d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;
