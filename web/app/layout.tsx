import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "PortPy VMAT Planner",
  description: "TJU-style web UI for PortPy VMAT demos"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
