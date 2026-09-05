import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

export const MOBILE_SHEET_MAX_WIDTH_PX = 820;
export const MOBILE_SHEET_DRAG_DISMISS_PX = 82;
export const MOBILE_SHEET_DRAG_MAX_OFFSET_PX = 150;

interface MobileSheetDragProps {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function useMobileSheetDrag(onDismiss: () => void): {
  sheetStyle: CSSProperties | undefined;
  dragHandleProps: MobileSheetDragProps;
} {
  const dragStartYRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const [dragState, setDragState] = useState({ active: false, offset: 0 });

  const resetDrag = useCallback(() => {
    dragStartYRef.current = null;
    dragOffsetRef.current = 0;
    setDragState({ active: false, offset: 0 });
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const isDedicatedHandle = event.currentTarget.matches(
      ".explorer-mobile-sheet-handle, .playground-mobile-sheet-handle",
    );
    const isInteractiveTarget = Boolean(
      target.closest("button, input, select, textarea, a"),
    );
    const isMobileSheet =
      typeof window === "undefined" ||
      window.matchMedia(`(max-width: ${MOBILE_SHEET_MAX_WIDTH_PX}px)`).matches;

    if (
      (isInteractiveTarget && !isDedicatedHandle) ||
      !isMobileSheet ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragStartYRef.current = event.clientY;
    dragOffsetRef.current = 0;
    setDragState({ active: true, offset: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragStartYRef.current === null) return;

    event.preventDefault();
    event.stopPropagation();
    const offset = Math.max(0, event.clientY - dragStartYRef.current);
    dragOffsetRef.current = offset;
    setDragState({
      active: true,
      offset: Math.min(offset, MOBILE_SHEET_DRAG_MAX_OFFSET_PX),
    });
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (dragStartYRef.current === null) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (dragOffsetRef.current >= MOBILE_SHEET_DRAG_DISMISS_PX) {
        onDismiss();
      }
      resetDrag();
    },
    [onDismiss, resetDrag],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      resetDrag();
    },
    [resetDrag],
  );

  return {
    sheetStyle:
      dragState.offset > 0
        ? {
            transform: `translateY(${dragState.offset}px)`,
            transition: dragState.active ? "none" : undefined,
          }
        : undefined,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
