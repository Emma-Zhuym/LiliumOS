// [EM-START: meet-extra]
import React from 'react';
import { CaretLeft } from '@phosphor-icons/react';
import { F, FONT, iconButtonBare } from '../../utils/clayTokens';

/** 番外几页共用的顶栏：裸 icon 返回 + 衬线居中标题 + 右边动作（APP_CONVENTIONS A） */
export const ExtraHeader: React.FC<{ title: string; onBack: () => void; right?: React.ReactNode; color?: string }> = ({ title, onBack, right, color = F.textPrimary }) => (
    <header className="relative shrink-0 flex items-center justify-between" style={{ paddingTop: 'var(--chrome-top)', paddingLeft: 4, paddingRight: 4, minHeight: 52 }}>
        <button type="button" aria-label="返回" onClick={onBack} className="grid place-items-center active:opacity-40 transition-opacity" style={{ ...iconButtonBare, color }}>
            <CaretLeft size={22} weight="bold" />
        </button>
        <h1 className="absolute left-1/2 -translate-x-1/2 truncate" style={{ margin: 0, bottom: 12, maxWidth: '60%', fontFamily: FONT.heading, ...FONT.navTitle, color }}>{title}</h1>
        <div className="flex items-center">{right}</div>
    </header>
);
// [EM-END: meet-extra]
