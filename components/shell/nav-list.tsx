"use client";

import { cn } from "@/lib/utils";

import { NavItem, type NavItemVariant } from "./nav-item";
import { NAV_GROUPS } from "./navigation";

export type NavListProps = {
  readonly activeSegment: string | null;
  readonly variant: NavItemVariant;
  readonly onNavigate?: () => void;
  readonly className?: string;
};

/**
 * The four groups, rendered from `NAV_GROUPS`.
 *
 * Each group is a `<ul>` with its own heading rather than one flat list: the
 * grouping is meaning, not decoration, and `aria-labelledby` is what carries
 * it to a screen reader once the rail hides the heading visually.
 */
export function NavList({
  activeSegment,
  variant,
  onNavigate,
  className,
}: NavListProps) {
  return (
    <nav
      data-slot="nav-list"
      aria-label="Main navigation"
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      {NAV_GROUPS.map((group) => {
        const headingId = `nav-group-${variant}-${group.id}`;
        return (
          <div key={group.id} className="flex min-w-0 flex-col gap-1">
            <p
              id={headingId}
              data-slot="nav-group-heading"
              className={cn(
                // 9px, so `--ui-muted` rather than `--ui-faint`: the design
                // system's own compliance note puts faint at 5.25:1 and warns
                // it is unlikely to hold at this size.
                "px-2 text-4xs tracking-widest text-ui-muted uppercase",
                variant === "sidebar" ? "hidden desk:block" : "block",
              )}
            >
              {group.label}
            </p>
            <ul
              aria-labelledby={headingId}
              className="flex min-w-0 flex-col gap-0.5"
            >
              {group.items.map((item) => (
                <li key={item.href} className="min-w-0">
                  <NavItem
                    item={item}
                    activeSegment={activeSegment}
                    variant={variant}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
