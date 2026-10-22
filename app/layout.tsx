import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Spotlight Month",
  description: "Physics / CS in the Spotlight: events, check-in, exhibits and awards",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#0f172a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900"><RegisterSW />{children}</body>
    </html>
  );
}
