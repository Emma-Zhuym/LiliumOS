// [EM-START: text-voice-favorites]
import { useEffect, useRef } from 'react';
import type React from 'react';

/** Keep long-press selection separate from the following click/play/advance. */
export function useVoiceFavoriteGesture() {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const consumed = useRef(false);
    const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
    useEffect(() => clear, []);
    return (open: () => void) => ({
        onTouchStart: (event: React.TouchEvent) => {
            event.stopPropagation(); clear(); consumed.current = false;
            if (event.touches.length !== 1) return;
            timer.current = setTimeout(() => { timer.current = null; consumed.current = true; open(); }, 450);
        },
        onTouchMove: (event: React.TouchEvent) => { event.stopPropagation(); clear(); },
        onTouchEnd: (event: React.TouchEvent) => { event.stopPropagation(); clear(); },
        onTouchCancel: (event: React.TouchEvent) => { event.stopPropagation(); clear(); consumed.current = false; },
        onMouseDown: (event: React.MouseEvent) => { event.stopPropagation(); },
        onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); clear(); consumed.current = true; open(); },
        onClickCapture: (event: React.MouseEvent) => {
            if (!consumed.current) return;
            event.preventDefault(); event.stopPropagation(); consumed.current = false;
        },
    });
}
// [EM-END: text-voice-favorites]
