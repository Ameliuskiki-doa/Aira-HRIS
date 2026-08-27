"use client";

import { Brand } from "./brand";
import { NavList } from "./nav-list";

export type SidebarProps = {
  readonly activeSegment: string | null;
  readonly planLabel: string;
};

/**
 * The persistent left column, in its two forms.
 *
 *   >= 1200px  236px, brand over four labelled groups, items at the drawn
 *              7px/8px density.
 *   768-1199px 64px icon rail. Labels and group headings hide, items rise to
 *              44px, the active item keeps its ring — without a label the ring
 *              is the only cue that anything is selected.
 *   < 768px    gone. The drawer in the header takes over.
 *
 * All three are one element and one media query set, not three components: a
 * second copy of the nav would be a second thing to keep in step, and the
 * drawer already is one.
 */
export function Sidebar({ activeSegment, planLabel }: SidebarProps) {
  return (
    <div
      data-slot="sidebar"
      // `self-start` before `sticky`: a flex child stretches to the row height
      // by default, which leaves `sticky` nothing to move within and silently
      // does nothing. Held at its own height, it pins for the whole scroll.
      className="bg-card border-border sticky top-0 hidden h-svh shrink-0 flex-col gap-6 self-start overflow-y-auto border-r md:flex md:w-16 md:px-2.5 md:py-5 desk:w-59 desk:px-3.5"
    >
      <Brand planLabel={planLabel} variant="sidebar" />
      <NavList activeSegment={activeSegment} variant="sidebar" />
    </div>
  );
}
