"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** "View in 3D" on the 2D pages, "Switch to 2D view" inside the 3D world: same incident, other view. */
export function ViewSwitch({ shift, incidentId }: { shift: "night" | "morning"; incidentId?: string }) {
  const pathname = usePathname();
  if (!incidentId) return null;
  const in3d = pathname?.endsWith("/3d") ?? false;
  const href = `/${shift}${in3d ? "" : "/3d"}?incident=${encodeURIComponent(incidentId)}`;
  return <Link className="view-switch" href={href}>{in3d ? "Switch to 2D view" : "View in 3D"}</Link>;
}
