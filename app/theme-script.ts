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

/**
 * Read the theme the document is *currently* wearing.
 *
 * Module-private: `toggleTheme` is the only caller, and an exported reader
 * nothing reads is a claim about an API that does not exist.
 *
 * The class on `<html>` is the truth, not React state: the blocking script
 * above sets it before hydration, so any component that kept its own copy
 * would start out disagreeing with the page on every load that resolved to
 * light. Reading the DOM has no such window.
 */
function currentTheme(): Theme {
  return document.documentElement.classList.contains(DARK_CLASS)
    ? "dark"
    : "light";
}

/**
 * The writer — the half Story 1.2 left missing.
 *
 * `resolveTheme` and `THEME_SCRIPT` could already read a preference, but
 * nothing in the repo could write one, so light was unreachable and half the
 * theme CSS guarded a state no user could enter. This closes that.
 *
 * Three effects, deliberately in this order and deliberately not conditional
 * on each other:
 *
 *   1. the class, which is what `@custom-variant dark (&:is(.dark *))` reads;
 *   2. `color-scheme`, so form controls, scrollbars and the canvas the browser
 *      paints behind the page follow the choice — the class alone does not
 *      move them;
 *   3. `localStorage`, so the next load's blocking script resolves the same
 *      way and the choice survives a reload.
 *
 * The write is wrapped and the throw swallowed. A denied `localStorage` costs
 * persistence, which is a degraded session; letting it propagate would abort
 * the click handler *after* the class flip, which is a broken one.
 */
export function applyTheme(theme: Theme): Theme {
  const element = document.documentElement;
  element.classList.toggle(DARK_CLASS, theme === "dark");
  element.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage denied. The page still wears the theme for this session.
  }
  return theme;
}

/** Flip to the other theme and persist it. Returns the theme now in effect. */
export function toggleTheme(): Theme {
  return applyTheme(currentTheme() === "dark" ? "light" : "dark");
}
