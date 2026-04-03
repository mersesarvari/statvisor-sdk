"use client";

import { useState, useEffect } from "react";
import { grantConsent, revokeConsent, hasConsent } from "./browser";

export interface ConsentBannerConfig {
  enabled: boolean;
  position: "bottom-bar" | "bottom-left" | "bottom-right";
  backgroundColor: string;
  textColor: string;
  acceptButtonColor: string;
  acceptButtonTextColor: string;
  declineButtonColor: string;
  declineButtonTextColor: string;
  headingText: string;
  bodyText: string;
  acceptLabel: string;
  declineLabel: string;
  privacyPolicyUrl: string;
}

const DEFAULTS: ConsentBannerConfig = {
  enabled: true,
  position: "bottom-bar",
  backgroundColor: "#18181b",
  textColor: "#fafafa",
  acceptButtonColor: "#6366f1",
  acceptButtonTextColor: "#ffffff",
  declineButtonColor: "#3f3f46",
  declineButtonTextColor: "#a1a1aa",
  headingText: "We use analytics",
  bodyText:
    "We collect anonymous usage data to improve the experience. No third-party trackers or ads.",
  acceptLabel: "Accept",
  declineLabel: "Decline",
  privacyPolicyUrl: "",
};

export interface StatvisorConsentBannerProps {
  /** Your Statvisor frontend key — used to fetch the project's banner config */
  frontendKey: string;
  /** Override the Statvisor endpoint. Leave unset for the hosted service. */
  endpoint?: string;
  /**
   * Pass a full or partial config to skip the API fetch and use these values
   * instead (useful for testing or fully self-hosted setups).
   */
  config?: Partial<ConsentBannerConfig>;
}

/**
 * Drop-in GDPR consent banner for Statvisor analytics.
 *
 * Shows on first visit until the visitor accepts or declines.
 * Calls `grantConsent()` / `revokeConsent()` from @statvisor/sdk/browser
 * which controls whether the persistent _sv_vid visitor-ID cookie is set.
 *
 * ```tsx
 * // app/layout.tsx
 * import { StatvisorAnalytics } from "@statvisor/sdk/react";
 * import { StatvisorConsentBanner } from "@statvisor/sdk/consent";
 *
 * <StatvisorAnalytics frontendKey="vl_fe_..." />
 * <StatvisorConsentBanner frontendKey="vl_fe_..." />
 * ```
 */
export function StatvisorConsentBanner({
  frontendKey,
  endpoint,
  config: configOverride,
}: StatvisorConsentBannerProps) {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<ConsentBannerConfig>({
    ...DEFAULTS,
    ...configOverride,
  });

  useEffect(() => {
    // Already decided — don't show again
    if (typeof document !== "undefined") {
      const match = document.cookie.match(/(?:^|; )_sv_consent=([^;]*)/);
      if (match) return;
    }

    if (configOverride !== undefined) {
      const merged = { ...DEFAULTS, ...configOverride };
      if (merged.enabled) setVisible(true);
      return;
    }

    // Fetch project banner config from Statvisor
    const base = endpoint
      ? endpoint.replace(/\/ingest\/frontend\/?$/, "")
      : "https://statvisor.com";

    fetch(`${base}/api/ingest/frontend/config?key=${encodeURIComponent(frontendKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.consentBanner) {
          const merged = { ...DEFAULTS, ...data.consentBanner };
          setConfig(merged);
          if (merged.enabled) setVisible(true);
        } else {
          // No config saved yet — show with defaults
          setVisible(true);
        }
      })
      .catch(() => {
        // Network error — still show with defaults so the site stays compliant
        setVisible(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  function handleAccept() {
    grantConsent();
    setVisible(false);
  }

  function handleDecline() {
    revokeConsent();
    setVisible(false);
  }

  const isBar = config.position === "bottom-bar";
  const isLeft = config.position === "bottom-left";

  const wrapperStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 9999,
    backgroundColor: config.backgroundColor,
    color: config.textColor,
    boxShadow: "0 -2px 16px rgba(0,0,0,0.18)",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    ...(isBar
      ? {
          bottom: 0,
          left: 0,
          right: 0,
          padding: "12px 24px",
          display: "flex",
          flexDirection: "row" as const,
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap" as const,
        }
      : {
          bottom: "16px",
          [isLeft ? "left" : "right"]: "16px",
          maxWidth: "360px",
          width: "calc(100% - 32px)",
          borderRadius: "10px",
          padding: "16px",
          display: "flex",
          flexDirection: "column" as const,
          gap: "12px",
        }),
  };

  return (
    <div style={wrapperStyle} role="dialog" aria-label="Cookie consent">
      <div style={{ flex: 1, minWidth: 0 }}>
        {config.headingText && (
          <p
            style={{
              margin: 0,
              fontWeight: 600,
              fontSize: "14px",
              lineHeight: 1.4,
            }}
          >
            {config.headingText}
          </p>
        )}
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            opacity: 0.85,
            lineHeight: 1.5,
            marginTop: config.headingText ? "3px" : 0,
          }}
        >
          {config.bodyText}
          {config.privacyPolicyUrl && (
            <>
              {" "}
              <a
                href={config.privacyPolicyUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "inherit", textDecoration: "underline" }}
              >
                Privacy Policy
              </a>
            </>
          )}
        </p>
      </div>
      <div
        style={{ display: "flex", gap: "8px", flexShrink: 0, flexWrap: "wrap" }}
      >
        <button
          onClick={handleDecline}
          style={{
            background: config.declineButtonColor,
            color: config.declineButtonTextColor,
            border: "none",
            borderRadius: "6px",
            padding: "7px 16px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          {config.declineLabel}
        </button>
        <button
          onClick={handleAccept}
          style={{
            background: config.acceptButtonColor,
            color: config.acceptButtonTextColor,
            border: "none",
            borderRadius: "6px",
            padding: "7px 16px",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          {config.acceptLabel}
        </button>
      </div>
    </div>
  );
}
