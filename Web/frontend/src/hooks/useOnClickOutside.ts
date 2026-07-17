import { type RefObject, useEffect } from "react";

/**
 * Calls `handler` when a pointerdown/touchstart occurs outside the referenced
 * element, or when Escape is pressed. Used by the navbar popovers.
 */
export function useOnClickOutside<T extends HTMLElement>(
  ref: RefObject<T>,
  handler: () => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return;

    const onPointer = (event: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el || el.contains(event.target as Node)) return;
      handler();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handler();
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, handler, active]);
}
