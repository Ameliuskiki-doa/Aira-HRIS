"use client";

import { ListIcon } from "@phosphor-icons/react/ssr";
import { useEffect } from "react";

import {
  AppDrawer,
  AppDrawerPanel,
  AppDrawerTitle,
  AppDrawerTrigger,
} from "@/components/app/drawer";
import { Button } from "@/components/ui/button";

import { Brand } from "./brand";
import { NavList } from "./nav-list";

export type NavDrawerProps = {
  readonly activeSegment: string | null;
  readonly planLabel: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

/**
 * The navigation below 768px.
 *
 * Three ways out, and all three are required: the backdrop, `Esc`, and
 * following a link. The first two come from Base UI's popup — this component
 * only has to be controlled for the third, which is why `open` is lifted
 * rather than left to `defaultOpen`. Focus is trapped while the panel is open
 * and returns to the trigger on close, both from the same popup.
 *
 * `swipeDirection="left"` is what tells the primitive which edge this panel
 * belongs to; the geometry itself is in `components/app/drawer.tsx`.
 *
 * The fourth way out is not a user action. The trigger is `md:hidden`, so a
 * window widened past 768px while the panel is open leaves a modal drawer with
 * focus trapped inside it, no visible control to close it, and a focus-return
 * target that is no longer rendered. The panel has to leave when its band does.
 */
export function NavDrawer({
  activeSegment,
  planLabel,
  open,
  onOpenChange,
}: NavDrawerProps) {
  useEffect(() => {
    if (!open) return;
    // The `md` breakpoint, as the browser evaluates it — the same 48rem the
    // trigger's `md:hidden` uses, so the panel and its only control cannot
    // disagree about which band they are in.
    const sidebarBand = window.matchMedia("(width >= 48rem)");
    const close = (event: MediaQueryListEvent) => {
      if (event.matches) onOpenChange(false);
    };
    sidebarBand.addEventListener("change", close);
    return () => sidebarBand.removeEventListener("change", close);
  }, [open, onOpenChange]);

  return (
    <AppDrawer open={open} onOpenChange={onOpenChange} swipeDirection="left">
      <AppDrawerTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-slot="nav-drawer-trigger"
            // Icon-only, so the name has to be written. Without it the control
            // is announced as "button" and nothing else.
            aria-label="Open navigation menu"
            className="md:hidden"
          />
        }
      >
        <ListIcon aria-hidden="true" className="size-4" />
      </AppDrawerTrigger>

      <AppDrawerPanel className="gap-6 px-3.5 py-5">
        {/* Named for the accessibility tree; the brand below is the visible
            heading, and repeating it in type would be a second title. */}
        <AppDrawerTitle className="sr-only">Navigation</AppDrawerTitle>
        <Brand planLabel={planLabel} variant="drawer" />
        <NavList
          activeSegment={activeSegment}
          variant="drawer"
          onNavigate={() => onOpenChange(false)}
        />
      </AppDrawerPanel>
    </AppDrawer>
  );
}
