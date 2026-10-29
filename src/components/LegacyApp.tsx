"use client";

import { useEffect } from "react";
import { installClaudeShim } from "@/lib/claude-shim";

declare global {
  interface Window { __sfLegacyLoaded?: boolean }
}

/**
 * Boots the original Superfinancials script (public/legacy/superfinancials.js)
 * and its add-ons (news-feed.js) once, after installing the window.claude shim it expects. The script renders
 * into the static shell that the page puts in #sf-root.
 */
export function LegacyApp() {
  useEffect(() => {
    if (window.__sfLegacyLoaded) return;
    window.__sfLegacyLoaded = true;
    installClaudeShim();
    // Ordered, non-async scripts run in sequence: the add-ons extend the main script's globals.
    for (const src of ["/legacy/superfinancials.js", "/legacy/news-feed.js"]) {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      document.body.append(s);
    }
  }, []);
  return null;
}
