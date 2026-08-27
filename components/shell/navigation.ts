/**
 * The navigation, as data.
 *
 * One definition, three renderings: the 236px sidebar, the 64px icon rail and
 * the off-canvas drawer all map over this array. That is the point — a nav
 * item added here appears in all three, and an item that exists in only one of
 * them cannot happen. The alternative, three JSX lists that happen to agree,
 * disagrees the first time someone edits two of them.
 *
 * Icons come from `@phosphor-icons/react/ssr`. The default entry fails
 * `next build` inside a Server Component (`createContext is not a function`);
 * the `/ssr` entry prerenders an inline `<svg>` and ships no client JS for the
 * icon itself. The `…Icon`-suffixed names are the current ones — the bare
 * `SquaresFour` spelling is deprecated in 2.1.x.
 *
 * Counts are absent on purpose. The Approvals badge belongs to the dashboard's
 * `approvalTotal`, which has no data layer yet; a hardcoded badge would be a
 * wrong number rendered confidently.
 */
import {
  AirplaneTakeoffIcon,
  CalendarDotsIcon,
  ChartLineIcon,
  CheckSquareOffsetIcon,
  CreditCardIcon,
  FingerprintIcon,
  ReceiptIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/ssr";

/**
 * A Phosphor icon component. Taken as `typeof` one of the imports rather than
 * as the library's exported `Icon` type, which lives behind the package's
 * default entry — the entry this story may not import from.
 */
export type NavIcon = typeof SquaresFourIcon;

export type NavItem = {
  /** Indonesian label. Visible in the sidebar and drawer, the accessible name
   *  everywhere — in the rail it is visually hidden rather than removed. */
  readonly label: string;
  /** Destination. Every one of these has a stub route under `app/(app)`. */
  readonly href: string;
  /**
   * The route segment directly below `app/(app)` that this item owns, or
   * `null` for the index route. `useSelectedLayoutSegment()` returns exactly
   * this — `null` on the layout's own page — which is why active state is a
   * comparison against a segment and not string-matching a pathname.
   */
  readonly segment: string | null;
  readonly icon: NavIcon;
};

export type NavGroup = {
  /** Stable key, and the `id` half of the group's label element. */
  readonly id: string;
  /** Indonesian group heading. Hidden in the rail, shown in sidebar and drawer. */
  readonly label: string;
  readonly items: readonly NavItem[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "ringkasan",
    label: "Ringkasan",
    items: [
      { label: "Dasbor", href: "/", segment: null, icon: SquaresFourIcon },
      {
        label: "Laporan",
        href: "/laporan",
        segment: "laporan",
        icon: ChartLineIcon,
      },
    ],
  },
  {
    id: "karyawan",
    label: "Karyawan",
    items: [
      {
        label: "Data Karyawan",
        href: "/karyawan",
        segment: "karyawan",
        icon: UsersThreeIcon,
      },
      {
        label: "Absensi",
        href: "/absensi",
        segment: "absensi",
        icon: FingerprintIcon,
      },
      {
        label: "Cuti",
        href: "/cuti",
        segment: "cuti",
        icon: AirplaneTakeoffIcon,
      },
      {
        label: "Jadwal Shift",
        href: "/jadwal-shift",
        segment: "jadwal-shift",
        icon: CalendarDotsIcon,
      },
    ],
  },
  {
    id: "payroll",
    label: "Payroll",
    items: [
      {
        label: "Proses Payroll",
        href: "/payroll",
        segment: "payroll",
        icon: ReceiptIcon,
      },
      {
        label: "Persetujuan",
        href: "/persetujuan",
        segment: "persetujuan",
        icon: CheckSquareOffsetIcon,
      },
    ],
  },
  {
    id: "pengaturan",
    label: "Pengaturan",
    items: [
      {
        label: "Konfigurasi",
        href: "/konfigurasi",
        segment: "konfigurasi",
        icon: SlidersHorizontalIcon,
      },
      {
        label: "Langganan",
        href: "/langganan",
        segment: "langganan",
        icon: CreditCardIcon,
      },
    ],
  },
];

/** Every item, flattened. The order the groups are drawn in. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items,
);

/**
 * Whether `item` is the one the current route selects.
 *
 * Written once, here, because "exactly one item is active" is a property of
 * the whole list rather than of any item, and three call sites each deciding
 * it independently is how a screen ends up with two highlighted rows or none.
 */
export function isNavItemActive(item: NavItem, segment: string | null): boolean {
  return item.segment === segment;
}
