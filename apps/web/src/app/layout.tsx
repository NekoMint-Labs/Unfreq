import type { Metadata, Viewport } from "next";
import { RadioShell } from "@/components/layout/RadioShell";
import { FrontendErrorReporter } from "@/components/pwa/FrontendErrorReporter";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { productName } from "@/lib/copy";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-500.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import "@fontsource/noto-sans-sc/chinese-simplified-700.css";
import "@fontsource/noto-serif-sc/chinese-simplified-400.css";
import "@fontsource/noto-serif-sc/chinese-simplified-600.css";
import "@fontsource/noto-serif-sc/chinese-simplified-700.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: productName,
  description: "一个黑白风格的匿名信号星图",
  applicationName: productName,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: productName,
  },
  icons: {
    apple: "/icons/apple-touch-icon.svg",
    icon: [
      { url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0A0A12",
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body>
        <FrontendErrorReporter />
        <ServiceWorkerRegistration />
        <RadioShell>{children}</RadioShell>
      </body>
    </html>
  );
}
