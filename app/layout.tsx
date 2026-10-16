import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Northbeam Docs Studio",
  description: "Draft, publish, and version documentation articles.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
