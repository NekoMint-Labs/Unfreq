import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#050505",
    description: "一个黑白风格的匿名信号星图",
    display: "standalone",
    icons: [
      {
        sizes: "192x192",
        src: "/icons/icon-192.svg",
        type: "image/svg+xml",
      },
      {
        sizes: "512x512",
        src: "/icons/icon-512.svg",
        type: "image/svg+xml",
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: "/icons/maskable-icon.svg",
        type: "image/svg+xml",
      },
    ],
    id: "/",
    lang: "zh-CN",
    name: "Unfreq",
    orientation: "portrait",
    scope: "/",
    short_name: "Unfreq",
    start_url: "/",
    theme_color: "#050505",
  };
}
