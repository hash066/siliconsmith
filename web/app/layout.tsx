import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SiliconSmith — change the chip to fit the code", template: "%s · SiliconSmith" },
  description:
    "SiliconSmith profiles C code, invents a custom RISC-V instruction for the hot loop, writes the Verilog, and proves it before it opens a pull request.",
  applicationName: "SiliconSmith",
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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
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
