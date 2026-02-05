"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

const SCROLL_THRESHOLD = 400;

interface ScrollButtonsProps {
  /** Pixels scrolled before top button appears (default 400) */
  threshold?: number;
  /** CSS selector for scroll container (e.g. "main"). If not provided, uses window. */
  containerSelector?: string;
}

export function ScrollToTop({ threshold = SCROLL_THRESHOLD, containerSelector }: ScrollButtonsProps) {
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  const scrollToTop = useCallback(() => {
    const el = containerSelector ? document.querySelector(containerSelector) : null;
    if (el && "scrollTo" in el) {
      (el as HTMLElement).scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [containerSelector]);

  const scrollToBottom = useCallback(() => {
    const el = containerSelector ? document.querySelector(containerSelector) : null;
    if (el && "scrollTo" in el) {
      const scrollHeight = (el as HTMLElement).scrollHeight;
      (el as HTMLElement).scrollTo({ top: scrollHeight, behavior: "smooth" });
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    }
  }, [containerSelector]);

  useEffect(() => {
    const el = containerSelector ? document.querySelector(containerSelector) : null;

    const checkScroll = () => {
      if (el) {
        const { scrollTop, scrollHeight, clientHeight } = el as HTMLElement;
        setShowTop(scrollTop > threshold);
        setShowBottom(scrollTop < scrollHeight - clientHeight - threshold);
      } else {
        const scrollTop = window.scrollY ?? document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = window.innerHeight;
        setShowTop(scrollTop > threshold);
        setShowBottom(scrollTop < scrollHeight - clientHeight - threshold);
      }
    };

    if (el) {
      el.addEventListener("scroll", checkScroll, { passive: true });
      checkScroll();
      return () => el.removeEventListener("scroll", checkScroll);
    }
    window.addEventListener("scroll", checkScroll, { passive: true });
    checkScroll();
    return () => window.removeEventListener("scroll", checkScroll);
  }, [threshold, containerSelector]);

  if (!showTop && !showBottom) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {showTop && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="Scroll to top"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/95 shadow-lg backdrop-blur hover:bg-accent transition-colors"
        >
          <ChevronUp className="w-5 h-5 text-foreground" />
        </button>
      )}
      {showBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/95 shadow-lg backdrop-blur hover:bg-accent transition-colors"
        >
          <ChevronDown className="w-5 h-5 text-foreground" />
        </button>
      )}
    </div>
  );
}
