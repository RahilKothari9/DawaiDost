"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, MoreHorizontal } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { useShell } from "./ShellContext";
import { BrandMark } from "./TopBar";
import { NAV, NAV_GROUPS, isActive } from "./nav";

function useNavCounts() {
  const { state, assessments } = useDistrict();
  return {
    "/decisions": state.decisions.filter((d) => d.status === "pending").length,
    "/transfers": state.transfers.filter((t) => t.status === "approved" || t.status === "in_transit" || t.status === "proposed").length,
    "/map": assessments.filter((a) => a.risk === "stockout" || a.risk === "critical").length,
  } as Record<string, number>;
}

export function NavRail() {
  const pathname = usePathname();
  const counts = useNavCounts();
  const { state } = useDistrict();
  const officer = state.district.officer;
  const initials = officer.name.replace(/^Dr\.?\s*/, "").split(" ").map((p) => p[0]).join("").slice(0, 2);
  return (
    <nav className="rail" aria-label="Primary">
      <Link href="/" className="rail__brand">
        <BrandMark size={30} />
        <span className="rail__wordmark">
          <strong>Dawai Dost</strong>
          <small>District medicine desk</small>
        </span>
      </Link>

      {NAV_GROUPS.map((g) => (
        <div className="rail__group" key={g.id}>
          <p className="rail__group-label">{g.label}</p>
          <ul>
            {NAV.filter((n) => n.group === g.id).map((n) => {
              const active = isActive(pathname, n.href);
              const count = counts[n.href];
              const Icon = n.icon;
              return (
                <li key={n.href}>
                  <Link href={n.href} className={`rail__link ${active ? "is-active" : ""} ${n.href === "/decisions" ? "rail__link--decision" : ""}`} aria-current={active ? "page" : undefined} title={n.label}>
                    <Icon size={17} strokeWidth={1.8} aria-hidden />
                    <span className="rail__label">{n.label}</span>
                    {n.external ? <ArrowUpRight size={13} className="rail__ext" aria-label="opens full screen" /> : null}
                    {count ? (
                      <span className={`rail__count ${n.href === "/decisions" ? "rail__count--decision" : n.href === "/map" ? "rail__count--risk" : ""}`} aria-label={`${count} open`}>
                        {count}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="rail__foot">
        <div className="rail__officer">
          <span className="rail__avatar" aria-hidden>{initials}</span>
          <span className="rail__officer-copy">
            <strong>{officer.name}</strong>
            <small>{officer.title}, {state.district.name}</small>
          </span>
        </div>
        <p className="rail__disclaimer">Synthetic scenario. Clinics, people and counts are fictional.</p>
      </div>
    </nav>
  );
}

export function MobileTabs() {
  const pathname = usePathname();
  const counts = useNavCounts();
  const { setPaletteOpen } = useShell();
  return (
    <nav className="mtabs" aria-label="Primary (compact)">
      {NAV.filter((n) => n.primary).map((n) => {
        const active = isActive(pathname, n.href);
        const Icon = n.icon;
        const count = counts[n.href];
        return (
          <Link key={n.href} href={n.href} className={`mtabs__link ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="mtabs__icon">
              <Icon size={19} strokeWidth={1.8} aria-hidden />
              {count ? <i className={`mtabs__dot ${n.href === "/decisions" ? "is-decision" : ""}`} aria-hidden /> : null}
            </span>
            <span>{n.short}</span>
          </Link>
        );
      })}
      <button type="button" className="mtabs__link" onClick={() => setPaletteOpen(true)}>
        <span className="mtabs__icon">
          <MoreHorizontal size={19} aria-hidden />
        </span>
        <span>More</span>
      </button>
    </nav>
  );
}
