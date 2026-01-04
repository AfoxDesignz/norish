"use client";

import { usePathname } from "next/navigation";
import { useScroll, useMotionValueEvent } from "motion/react";
import { useRef, useState, useEffect, useCallback } from "react";

interface AutoHideOptions {
  scrollThreshold?: number;
  idleDelay?: number;
  topOffset?: number;
  disabled?: boolean;
}

export function useAutoHide({
  scrollThreshold = 2,
  idleDelay = 1500,
  topOffset = 50,
  disabled = false,
}: AutoHideOptions = {}) {
  const pathname = usePathname();
  const { scrollY } = useScroll();
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);
  const isHoveringRef = useRef(false);
  const [isScrollable, setIsScrollable] = useState(true);

  // Track if user is actively scrolling (wheel/touch in progress)
  const isUserScrollingRef = useRef(false);
  const userScrollEndTimeout = useRef<NodeJS.Timeout | null>(null);

  // Check if page is scrollable
  useEffect(() => {
    const checkScrollable = () => {
      const hasVerticalScroll = document.documentElement.scrollHeight > window.innerHeight;

      setIsScrollable(hasVerticalScroll);
      // If not scrollable, always show
      if (!hasVerticalScroll) {
        setIsVisible(true);
      }
    };

    checkScrollable();
    window.addEventListener("resize", checkScrollable);
    // Also check when content changes
    const observer = new MutationObserver(checkScrollable);

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("resize", checkScrollable);
      observer.disconnect();
    };
  }, []);

  const show = useCallback(() => {
    if (disabled) return;
    setIsVisible(true);
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
  }, [disabled]);

  const hide = useCallback(() => {
    if (disabled || !isScrollable) return;
    if (!isHoveringRef.current) {
      setIsVisible(false);
    }
  }, [disabled, isScrollable]);

  // Reset state on route change - show nav and sync scroll position
  useEffect(() => {
    setIsVisible(true);
    if (scrollTimeout.current) {
      clearTimeout(scrollTimeout.current);
      scrollTimeout.current = null;
    }
    // Give time for any programmatic scroll to settle, then sync lastScrollY
    const timer = setTimeout(() => {
      lastScrollY.current = scrollY.get();
    }, 300);

    return () => clearTimeout(timer);
  }, [pathname, scrollY]);

  // Initialize lastScrollY on mount
  useEffect(() => {
    lastScrollY.current = scrollY.get();
  }, [scrollY]);

  // Track user scroll gestures (wheel/touch)
  // Only process scroll events while user is actively interacting
  useEffect(() => {
    const markUserScrolling = () => {
      isUserScrollingRef.current = true;

      // Clear previous timeout
      if (userScrollEndTimeout.current) {
        clearTimeout(userScrollEndTimeout.current);
      }

      // Mark as not scrolling after gesture ends (150ms debounce)
      userScrollEndTimeout.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 150);
    };

    window.addEventListener("wheel", markUserScrolling, { passive: true });
    window.addEventListener("touchmove", markUserScrolling, { passive: true });

    return () => {
      window.removeEventListener("wheel", markUserScrolling);
      window.removeEventListener("touchmove", markUserScrolling);
      if (userScrollEndTimeout.current) {
        clearTimeout(userScrollEndTimeout.current);
      }
    };
  }, []);

  useMotionValueEvent(scrollY, "change", (latest) => {
    const prev = lastScrollY.current;
    const diff = latest - prev;

    if (disabled || !isScrollable) {
      lastScrollY.current = latest;

      return;
    }

    // Ignore scroll events that aren't from user interaction
    if (!isUserScrollingRef.current) {
      lastScrollY.current = latest;

      return;
    }

    // Always visible near top
    if (latest < topOffset) {
      show();
      lastScrollY.current = latest;

      return;
    }

    if (Math.abs(diff) > scrollThreshold) {
      if (diff > 0) hide();
      else show();
    }

    lastScrollY.current = latest;

    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      if (latest > topOffset) hide();
    }, idleDelay);
  });

  // Clear timeout and stay visible when disabled
  useEffect(() => {
    if (disabled) {
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
        scrollTimeout.current = null;
      }
      setIsVisible(true);
    }
  }, [disabled]);

  useEffect(() => {
    return () => {
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    };
  }, []);

  const onHoverStart = useCallback(() => {
    isHoveringRef.current = true;
    show();
  }, [show]);

  const onHoverEnd = useCallback(() => {
    isHoveringRef.current = false;
    const currentScroll = scrollY.get();

    if (currentScroll > topOffset && isScrollable) {
      scrollTimeout.current = setTimeout(() => hide(), idleDelay);
    }
  }, [hide, idleDelay, scrollY, topOffset, isScrollable]);

  return {
    isVisible,
    show,
    hide,
    onHoverStart,
    onHoverEnd,
  };
}
