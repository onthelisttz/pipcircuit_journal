"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * useScrollPersistence
 * Saves window scroll position to sessionStorage and restores it on mount.
 * Useful for keeping user place in long lists (e.g., Dashboard) after navigation.
 * 
 * @param key Unique key for storage (default: current pathname)
 * @param waitFor Whether persistence is active and if the component is ready to restore scroll
 */
export function useScrollPersistence(key?: string, waitFor: boolean = true) {
    const pathname = usePathname();
    const storageKey = `scroll_pos_${key || pathname}`;
    // We use a ref to track if we still need to restore.
    // Start as true (need to restore).
    const needsRestore = useRef(true);

    // Restore scroll when 'waitFor' becomes true
    useEffect(() => {
        if (!waitFor) return;
        if (!needsRestore.current) return;

        const container = document.querySelector("main");
        if (!container) return;

        const stored = sessionStorage.getItem(storageKey);
        if (stored) {
            try {
                const { y } = JSON.parse(stored);
                // Attempt restore with a few retries for safety against layout shifts
                let attempts = 0;
                const tryRestore = () => {
                    // check if scrollable
                    if (container.scrollHeight > container.clientHeight && container.scrollHeight >= y) {
                        container.scrollTop = y;
                        // Verify if it stuck (sometimes layout isn't fully ready even if height is enough)
                        if (Math.abs(container.scrollTop - y) < 10) {
                            needsRestore.current = false;
                            return;
                        }
                    }

                    if (container.scrollHeight > y || attempts > 5) {
                        // If we are big enough OR output timed out, just set it and give up
                        container.scrollTop = y;
                        needsRestore.current = false;
                    } else {
                        attempts++;
                        setTimeout(tryRestore, 50);
                    }
                };

                // Trigger first attempt
                setTimeout(tryRestore, 10);

            } catch (e) {
                console.error("Failed to restore scroll position", e);
                needsRestore.current = false;
            }
        } else {
            needsRestore.current = false;
        }
    }, [waitFor, storageKey]);

    // Save scroll on change
    useEffect(() => {
        // Don't save if we are still waiting to restore (avoid overwriting with 0)
        if (!waitFor) return;

        const container = document.querySelector("main");
        if (!container) return;

        const handleScroll = () => {
            if (needsRestore.current) return;

            const pos = { x: container.scrollLeft, y: container.scrollTop };
            sessionStorage.setItem(storageKey, JSON.stringify(pos));
        };

        let timeoutId: NodeJS.Timeout;
        const debouncedScroll = () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(handleScroll, 100);
        };

        container.addEventListener("scroll", debouncedScroll);
        return () => {
            container.removeEventListener("scroll", debouncedScroll);
            clearTimeout(timeoutId);
        };
    }, [waitFor, storageKey]);
}

