import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import type { ShellUser } from "./fixtures";

export type UserBlockProps = {
  readonly user: ShellUser;
};

/**
 * Initials, name and role at the end of the header.
 *
 * Below 768px it collapses to the avatar alone — the name and role are already
 * a tap away in the drawer, and the header's remaining width belongs to the
 * company name. The avatar keeps the person's name as its accessible label so
 * the collapse costs nothing to a screen reader.
 */
export function UserBlock({ user }: UserBlockProps) {
  return (
    <div data-slot="user-block" className="flex min-w-0 items-center gap-2">
      <Avatar size="sm" className="size-7">
        <AvatarFallback
          // `role="img"` is what makes the label count: `aria-label` on a bare
          // <span> is ignored, so without it the initials are the whole
          // accessible name and the person is "SW" below 768px.
          role="img"
          aria-label={user.name}
          className="bg-brand-800 text-brand-100 text-2xs font-medium"
        >
          {user.initials}
        </AvatarFallback>
      </Avatar>
      <div className="hidden min-w-0 flex-col md:flex">
        <span data-slot="user-name" className="truncate text-xs font-medium">
          {user.name}
        </span>
        {/*
          Omitted rather than blanked when there is no role. A session with no
          active membership genuinely has none, and an empty line under the
          name reads as a rendering fault — while inventing a default would put
          a permission on screen that the database does not grant.
        */}
        {user.role !== null && (
          <span data-slot="user-role" className="text-3xs text-ui-muted truncate">
            {user.role}
          </span>
        )}
      </div>
    </div>
  );
}
