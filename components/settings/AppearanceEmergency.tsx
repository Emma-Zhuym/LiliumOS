import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { F, R, S, STATUS } from '../../utils/clayTokens';
import ClayDialog from '../os/ClayDialog';

export default function AppearanceEmergency() {
    const { updateTheme, characters, updateCharacter, resetAppearance, addToast } = useOS();
    const [action, setAction] = useState<'css' | 'all' | null>(null), [busy, setBusy] = useState(false);
    const restore = async () => {
        if (!action || busy) return;
        setBusy(true);
        try {
            if (action === 'css') {
                await updateTheme({ chatChromeCustomCss: '' });
                for (const char of characters) if (char.chromeCustomCss) updateCharacter(char.id, { chromeCustomCss: '' });
            } else await resetAppearance();
            setAction(null); addToast(action === 'css' ? '已还原聊天白框美化' : '已还原默认外观，保存的预设保留', 'success');
        } catch (error: any) { addToast(error?.message || '外观恢复未完成', 'error'); }
        finally { setBusy(false); }
    };
    const style = { minHeight: 44, background: F.surface, color: F.textPrimary, borderRadius: R.button, boxShadow: S.raisedSoft };
    return <section className="space-y-4 p-5" style={{ background: F.surface, color: F.textPrimary, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
        <div><h2 className="text-base font-semibold">外观急救</h2><p className="mt-2 text-xs leading-relaxed" style={{ color: F.textSecondary }}>自定义美化让页面难以操作时，可在这里恢复。聊天与角色资料保留。</p></div>
        <div className="flex flex-wrap gap-3"><button onClick={() => setAction('css')} className="flex-1 px-4 text-sm" style={style}>还原聊天 CSS</button><button onClick={() => setAction('all')} className="flex-1 px-4 text-sm" style={style}>还原全部外观</button></div>
        <ClayDialog isOpen={action !== null} title={action === 'css' ? '还原聊天美化' : '还原默认外观'} onClose={() => { if (!busy) setAction(null); }} footer={<button disabled={busy} onClick={() => void restore()} className="w-full px-4 text-sm font-semibold" style={{ ...style, color: STATUS.danger.ink }}>{busy ? '恢复中…' : '确认还原'}</button>}><p className="text-sm leading-relaxed">{action === 'css' ? '清空全局和所有角色的自定义聊天 CSS，其他聊天外观设置保留。' : '恢复主题、壁纸、字体、图标等默认外观，已保存的外观预设仍可重新应用。'}</p></ClayDialog>
    </section>;
}
