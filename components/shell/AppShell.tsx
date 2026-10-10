"use client";
import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { usePathname } from "next/navigation";
import { DistrictProvider } from "@/lib/district/store";
import { ShellProvider } from "./ShellContext";
import { NavRail, MobileTabs } from "./NavRail";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { TimelineToaster, ToastViewport } from "./Toaster";
import { isBare } from "./nav";

/** Client root: district state lives here so it survives route changes. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const bare = isBare(pathname);
  return (
    <MotionConfig reducedMotion="user">
      <DistrictProvider>
        <ShellProvider>
          {bare ? (
            // Pharmacist and public surfaces own their full-page layout but share district state.
            <div className="app-bare">{children}</div>
          ) : (
            <>
              <a href="#main" className="skip-link">Skip to content</a>
              <div className="app">
                <NavRail />
                <div className="app__main">
                  <TopBar />
                  <main id="main" className="app__content" tabIndex={-1}>
                    {children}
                    <footer className="app__foot">
                      <span>Synthetic scenario. Every clinic, person and count here is fictional.</span>
                      <span>Approvals change this dashboard only; nothing is dispatched or ordered.</span>
                    </footer>
                  </main>
                </div>
              </div>
              <MobileTabs />
              <ToastViewport />
              <TimelineToaster />
            </>
          )}
          <CommandPalette />
        </ShellProvider>
      </DistrictProvider>
    </MotionConfig>
  );
}
