import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { AppFooter, AppHeader } from "../components/AppHeader";
import { I18nProvider } from "../components/I18nProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "vietnamese"], display: "swap", variable: "--font-inter" });

export const metadata = {
  title: "RiskIT: transaction risk for cross-border sellers",
  description: "AI-verified, human-approved profit, cash-flow and risk assessment for small cross-border sellers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <I18nProvider>
          <AppHeader />
          <div id="main" tabIndex={-1}>{children}</div>
          <AppFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
