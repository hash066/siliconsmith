import type { Metadata } from "next";
import "@/components/app/app.css";

export const metadata: Metadata = { title: "App", description: "The Hardwright app: Matter, Silicon and Board workbenches with an Agent that acts in the app and verifiers that decide what is true." };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
