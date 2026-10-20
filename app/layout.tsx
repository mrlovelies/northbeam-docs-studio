import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Northbeam Docs Studio",
  description: "Draft, publish, and version documentation articles.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 bg-white">
          <nav className="mx-auto flex max-w-3xl items-center gap-6 px-4 py-3">
            <span className="font-semibold">Northbeam Docs Studio</span>
            <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900">
              Docs
            </Link>
            <Link href="/studio" className="text-sm text-neutral-600 hover:text-neutral-900">
              Studio
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
