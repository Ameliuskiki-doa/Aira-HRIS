"use client";

/**
 * The tooltip, repainted in Nocturne's terms.
 *
 * The generated primitive paints an inverted chip — `bg-foreground` with
 * `text-background` — which is a perfectly good tooltip and the wrong one
 * here: the design system's tooltip sits on `--color-surface` at `--shadow-md`
 * with `--radius-md`, so the rail's labels read as part of the same surface
 * family as the sidebar they annotate rather than as a foreign inversion.
 *
 * As with the drawer, the correction lives here rather than in
 * `components/ui/tooltip.tsx`, which `shadcn add` overwrites.
 *
 * The `[&>[data-align]]` rule is the arrow. `TooltipContent` renders it inside
 * the popup with its own `bg-foreground fill-foreground` and exposes no prop
 * for it, so a child selector is the only reach that does not require editing
 * the generated file. `data-align` is what the primitive stamps on the arrow;
 * matching on it rather than on `*` gives the rule two class-equivalents of
 * specificity, which is what makes it beat `bg-foreground` rather than depend
 * on which of the two Tailwind happened to emit last.
 */

import { TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function AppTooltipContent({
  className,
  ...props
}: React.ComponentProps<typeof TooltipContent>) {
  return (
    <TooltipContent
      data-slot="app-tooltip-content"
      className={cn(
        "rounded-md bg-card px-2.5 py-1.5 text-xs text-foreground shadow-md",
        "[&>[data-align]]:bg-card [&>[data-align]]:fill-card",
        className,
      )}
      {...props}
    />
  );
}

export {
  Tooltip as AppTooltip,
  TooltipProvider as AppTooltipProvider,
  TooltipTrigger as AppTooltipTrigger,
} from "@/components/ui/tooltip";
