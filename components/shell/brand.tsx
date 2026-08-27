import { PulseIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

export type BrandProps = {
  /** The organisation's active plan, shown under the wordmark. */
  readonly planLabel: string;
  /**
   * Whether the wordmark and plan line collapse in the icon rail. The sidebar
   * keeps the mark and drops the words between 768px and 1199px; the drawer
   * has the full 236px and never does.
   */
  readonly variant: "sidebar" | "drawer";
};

/**
 * The mark, the wordmark and the plan line.
 *
 * The accent here is a line — a 1px border and a 15px glyph — not a fill. That
 * is the design system's rule for the accent generally, and this is the one
 * place on the shell where breaking it would be tempting.
 */
export function Brand({ planLabel, variant }: BrandProps) {
  return (
    <div
      data-slot="brand"
      className={cn(
        "flex min-w-0 items-center gap-2.25",
        variant === "sidebar" && "justify-center desk:justify-start",
      )}
    >
      <span
        aria-hidden="true"
        className="border-brand flex size-6.5 shrink-0 items-center justify-center rounded-md border"
      >
        <PulseIcon className="text-brand size-3.75" />
      </span>
      <span
        data-slot="brand-wordmark"
        className={cn(
          "min-w-0 flex-col",
          variant === "sidebar" ? "hidden desk:flex" : "flex",
        )}
      >
        <span className="truncate text-sm font-medium">Aira</span>
        <span
          data-slot="brand-plan"
          className="text-4xs text-ui-muted truncate tracking-widest uppercase"
        >
          {planLabel}
        </span>
      </span>
    </div>
  );
}
