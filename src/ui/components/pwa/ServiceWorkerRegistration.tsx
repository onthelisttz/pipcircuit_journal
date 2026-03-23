"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let hasReloadedForUpdate = false;

    const register = async () => {
      try {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (hasReloadedForUpdate) return;
          hasReloadedForUpdate = true;
          window.location.reload();
        });

        // Temporary cache disable: comment out the line below to stop registering `/sw.js`.
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // If a new SW is waiting, tell it to activate immediately
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        // Listen for future updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New SW installed while old one still controls – activate it
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    };

    void register();
  }, []);

  return null;
}
