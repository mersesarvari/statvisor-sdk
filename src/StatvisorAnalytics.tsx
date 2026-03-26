"use client";

import { useEffect } from "react";
import { initStatvisor } from "./browser";

export interface StatvisorAnalyticsProps {
  /** Your Statvisor frontend key (visible in the dashboard under "Frontend Key") */
  frontendKey: string;
  /** Override the ingest endpoint — leave unset for the Statvisor hosted service */
  endpoint?: string;
}

/**
 * Drop this into your root `layout.tsx` to enable frontend analytics:
 *
 * ```tsx
 * import { StatvisorAnalytics } from "@statvisor/browser/react";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         {children}
 *         <StatvisorAnalytics frontendKey="vl_fe_..." />
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function StatvisorAnalytics({
  frontendKey,
  endpoint,
}: StatvisorAnalyticsProps) {
  useEffect(() => {
    initStatvisor({ frontendKey, endpoint });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
