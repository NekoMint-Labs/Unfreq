"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { desktopNavItems } from "@/lib/copy";

type RadioShellProps = {
  children: ReactNode;
};

export function RadioShell({ children }: RadioShellProps) {
  const pathname = usePathname();
  const isGalaxyRoute = pathname.startsWith("/galaxy");
  const usesTopFadeMask =
    pathname.startsWith("/me") || pathname.startsWith("/result");

  return (
    <div className="radio-shell">
      {usesTopFadeMask ? (
        <span aria-hidden="true" className="radio-top-fade-mask" />
      ) : null}
      <span aria-hidden="true" className="radio-viewfinder radio-viewfinder-tl" />
      <span aria-hidden="true" className="radio-viewfinder radio-viewfinder-tr" />
      <span aria-hidden="true" className="radio-viewfinder radio-viewfinder-bl" />
      <span aria-hidden="true" className="radio-viewfinder radio-viewfinder-br" />

      <nav aria-label="主导航" className="radio-hud-nav">
        {desktopNavItems.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`radio-nav-item ${active ? "radio-nav-item-active" : ""}`}
              href={item.href}
              key={item.href}
            >
              <span className="radio-nav-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <main className={isGalaxyRoute ? "radio-main radio-main-galaxy" : "radio-main"}>
        {children}
      </main>
    </div>
  );
}
