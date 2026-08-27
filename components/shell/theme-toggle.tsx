"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react/ssr";

import { Button } from "@/components/ui/button";
import { toggleTheme } from "@/app/theme-script";

/**
 * The writer's one user-facing surface.
 *
 * Story 1.2 shipped a resolver, a storage key and a blocking script, and
 * nothing that could write a preference — so the light theme was unreachable
 * and half the stylesheet guarded a state no user could enter. This button is
 * what closes that loop.
 *
 * Two decisions worth stating:
 *
 * **The label names the action, not the state.** "Ganti tema" is true before
 * and after the press. A label that named the state ("Tema gelap") would be
 * read by a screen reader as what the button *is* rather than what it does,
 * and would be wrong for half of the press.
 *
 * **The icon swaps in CSS, not in React.** The theme is decided by a class the
 * blocking script writes before hydration, so a component holding its own copy
 * in state would render the wrong glyph on the first paint of every load that
 * resolved to light, then correct itself. `dark:` variants have no such
 * window: the icon that shows is whichever one the class already selected.
 */
export function ThemeToggle() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-slot="theme-toggle"
      aria-label="Ganti tema"
      onClick={() => toggleTheme()}
    >
      <MoonIcon aria-hidden="true" className="size-3.5 dark:hidden" />
      <SunIcon aria-hidden="true" className="hidden size-3.5 dark:block" />
    </Button>
  );
}
