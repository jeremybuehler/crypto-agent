import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACT — Autonomous Crypto Trader",
  description: "Paper trading dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-terminal-bg">
      <body className="min-h-screen bg-terminal-bg text-terminal-text font-mono">
        {children}
      </body>
    </html>
  );
}
