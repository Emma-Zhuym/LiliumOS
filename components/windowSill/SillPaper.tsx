// [EM-START: window-sill]
/**
 * 纸纹：一层很淡的云状斑驳（纸浆厚薄不匀）+ 细小的深色颗粒 + 细小的浅色亮点，没有方向。
 * 阿萌 11-10：第一版拉长的横纹看着像木头，真纸的纤维短、方向乱，所以三层都是各向同性的噪点。
 * 铺在纸面最底下，pointer-events: none，不挡点击。颜色跟着这一套主题走。
 */

import React, { useId } from 'react';

import type { SillTheme } from '../../utils/sillTokens';

const SillPaper: React.FC<{ theme: SillTheme }> = ({ theme }) => {
    const id = useId().replace(/:/g, '');
    const [r, g, b] = theme.grain.split(' ');
    return (
        <svg aria-hidden width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <filter id={`${id}m`} x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves={3} seed={4} result="cloud" />
                <feColorMatrix type="matrix" in="cloud" values={`0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 0.55 -0.22`} />
            </filter>
            <filter id={`${id}g`} x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={2} seed={7} result="noise" />
                <feColorMatrix type="matrix" in="noise" values={`0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 1.1 -0.5`} />
            </filter>
            <filter id={`${id}s`} x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={2} seed={21} result="noise" />
                <feColorMatrix type="matrix" in="noise" values="0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.94  0 0 0 1.2 -0.62" />
            </filter>
            <rect width="100%" height="100%" filter={`url(#${id}m)`} />
            <rect width="100%" height="100%" filter={`url(#${id}g)`} />
            <rect width="100%" height="100%" filter={`url(#${id}s)`} />
        </svg>
    );
};

export default SillPaper;
// [EM-END: window-sill]
