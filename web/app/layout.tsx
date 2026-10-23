import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono, Space_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";
import "./brand.css";

const display = Unbounded({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Space_Grotesk({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const code = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Hardwright: agents that design hardware, and prove it", template: "%s · Hardwright" },
  description:
    "Hardwright is a workstation for hardware makers: agents propose chips, boards and parts, and verifiers the model cannot argue with decide what is true.",
  applicationName: "Hardwright",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0b" },
    { media: "(prefers-color-scheme: light)", color: "#f2f3ee" },
  ],
  colorScheme: "dark light",
};

// Set the theme before first paint so there is no flash. Dark unless the visitor chose light.
const themeScript = `try{var t=localStorage.getItem("ss-theme");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${display.variable} ${body.variable} ${code.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-signal focus:px-3 focus:py-2 focus:text-on-signal"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
