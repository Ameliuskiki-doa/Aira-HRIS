import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DARK_CLASS, DEFAULT_THEME, THEME_SCRIPT } from "./theme-script";

/**
 * Inter, self-hosted by `next/font`. Nocturne's own stylesheet pulls Inter
 * from Google's font CDN; that stylesheet is vendored for provenance and never
 * linked, so no request leaves for Google at runtime.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Aira",
    template: "%s · Aira",
  },
  description:
    "Simple HRIS and payroll for small and medium businesses in Indonesia.",
  applicationName: "Aira",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The theme script rewrites `class` and `style` on this element before
      // React hydrates, which is the whole point of running it before paint.
      suppressHydrationWarning
      className={`${inter.variable} ${DEFAULT_THEME === "dark" ? DARK_CLASS : ""} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
