import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { MadeBy } from "@/components/MadeBy";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Rulebook Trader",
  description: "Rules-based paper trading on Alpaca with a Claude risk reviewer",
};

const NAV = [
  ["/", "Dashboard"],
  ["/strategies", "Strategies"],
  ["/performance", "Performance"],
  ["/activity", "Activity"],
  ["/journal", "Journal"],
  ["/settings", "Settings"],
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans`}>
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Rulebook Trader <span className="ml-1 rounded bg-warn/15 px-1.5 py-0.5 text-xs font-medium text-warn">PAPER</span>
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm text-ink-2">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-ink">{label}</Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <MadeBy />
      </body>
    </html>
  );
}
