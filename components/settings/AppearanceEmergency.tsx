import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import { F, R, STATUS } from '../../utils/clayTokens';
import ClayDialog from '../os/ClayDialog';
import { Group, Page, Row } from './SettingsParts';

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
    // [EM: settings-subpages-f] 两个还原改成红字行，确认还在雾面 sheet 里
    return <Page testId="settings-appearance-page">
        <Group foot="自定义美化把页面弄得没法点时，从这里还原。聊天记录和角色资料都不动。">
            <Row title="还原聊天 CSS" sub="清空全局和所有角色的白框自定义 CSS" tone="danger" onClick={() => setAction('css')} />
            <Row title="还原全部外观" sub="主题、壁纸、字体、图标回到默认；存过的外观预设还在" tone="danger" onClick={() => setAction('all')} />
        </Group>
        <ClayDialog isOpen={action !== null} title={action === 'css' ? '还原聊天美化' : '还原默认外观'} onClose={() => { if (!busy) setAction(null); }}
            footer={<button disabled={busy} onClick={() => void restore()} className="w-full clay-press disabled:opacity-50"
                style={{ height: 46, borderRadius: R.button, border: 'none', background: STATUS.danger.main, color: F.surface, fontSize: 15, fontWeight: 600 }}>{busy ? '恢复中…' : '确认还原'}</button>}>
            <p className="text-sm leading-relaxed" style={{ color: F.textSecondary }}>{action === 'css' ? '清空全局和所有角色的自定义聊天 CSS，其他聊天外观设置保留。' : '恢复主题、壁纸、字体、图标等默认外观，已保存的外观预设仍可重新应用。'}</p>
        </ClayDialog>
    </Page>;
}
