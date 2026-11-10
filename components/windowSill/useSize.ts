// [EM-START: window-sill]
import { useLayoutEffect, useState, type RefObject } from 'react';

/** 量一个元素的宽高（牌面图案按牌的大小画）。 */
export const useSize = (ref: RefObject<HTMLElement | null>) => {
    const [size, setSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => setSize(prev => (prev.width === el.offsetWidth && prev.height === el.offsetHeight ? prev : { width: el.offsetWidth, height: el.offsetHeight }));
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);
    return size;
};
// [EM-END: window-sill]
