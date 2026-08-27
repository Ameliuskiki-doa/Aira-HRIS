"use client";

import Link from "next/link";

import {
  AppTooltip,
  AppTooltipContent,
  AppTooltipTrigger,
} from "@/components/app/tooltip";
import { cn } from "@/lib/utils";

import { isNavItemActive, type NavItem as NavItemData } from "./navigation";

/**
 * Where this item is being drawn. The two places differ in more than styling,
 * so the difference is a prop rather than a media query repeated in five
 * class lists:
 *
 *   sidebar — collapses to a 64px icon rail between 768px and 1199px. The
 *             label is visually hidden there and surfaces as a tooltip.
 *   drawer  — only ever exists below 768px, where labels are always shown and
 *             there is no rail for a tooltip to explain.
 */
export type NavItemVariant = "sidebar" | "drawer";

export type NavItemProps = {
  readonly item: NavItemData;
  readonly activeSegment: string | null;
  readonly variant: NavItemVariant;
  /** Called when the item is followed. The drawer uses it to close itself. */
  readonly onNavigate?: () => void;
};

export function NavItem({
  item,
  activeSegment,
  variant,
  onNavigate,
}: NavItemProps) {
  const active = isNavItemActive(item, activeSegment);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      data-slot="nav-item"
      // Visual state alone is not state. Without this the highlighted row is
      // invisible to a screen reader, which is defect 4 in the interaction
      // spec's accessibility list.
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        // Only a plain primary click is a navigation. Cmd/Ctrl opens a new
        // tab, Shift a new window, middle-click a background tab — in every
        // one of those the current page does not move, so closing the drawer
        // would dismiss the menu the user is still working through.
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        onNavigate?.();
      }}
      className={cn(
        "group/nav-item flex items-center gap-2.25 rounded-md transition-colors",
        // 44px is the touch minimum, reached by block padding so the type
        // scale stays where it is. The sidebar band relaxes back to the drawn
        // 7px/8px density; the drawer never does, because it is a phone.
        "min-h-11 px-2",
        variant === "sidebar" &&
          "justify-center desk:min-h-0 desk:justify-start desk:py-1.75",
        active
          ? "bg-ui-active-bg text-ui-active-fg inset-ring-1 inset-ring-brand/40"
          : "text-ui-nav hover:bg-ui-hover hover:text-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3.75 shrink-0" />
      {/*
        Hidden from the eye in the rail, never from the accessibility tree.
        `hidden` would have removed the label from the accessible name and left
        every rail item nameless — an icon-only link with no name at all.
      */}
      <span
        className={cn(
          "min-w-0",
          variant === "sidebar" ? "sr-only desk:not-sr-only" : "truncate",
        )}
      >
        {item.label}
      </span>
    </Link>
  );

  if (variant === "drawer") return link;

  return (
    <AppTooltip>
      <AppTooltipTrigger render={link} />
      {/*
        The rail's only label. `desk:hidden` retires it in the sidebar band,
        where the label is already on screen and a tooltip repeating it is
        noise. Base UI opens this on hover *and* on keyboard focus, which is
        the half a mouse-only test would never notice was missing.
      */}
      <AppTooltipContent side="right" sideOffset={8} className="desk:hidden">
        {item.label}
      </AppTooltipContent>
    </AppTooltip>
  );
}
