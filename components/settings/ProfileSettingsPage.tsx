// [EM-START: settings-ios-list]
/**
 * 设置 → 个人档案：原来桌面上「档案」App 的内容（头像、名字、分角色聊天头像、关于我），
 * 收进设置最顶上那张卡里。桌面图标拿掉了，apps/UserApp.tsx 仍在、AppID.User 仍能打开。
 */

import React, { useRef } from 'react';
import { Camera } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { processImage } from '../../utils/file';
import { migrateDataUrlToRef } from '../../utils/blobRef';
import PerCharAvatarRows from './PerCharAvatarRows'; // [EM: settings-subpages-f]
import { FieldRow, Group } from './SettingsParts';
import TokenImg from '../os/TokenImg';
import { F, FONT, R } from '../../utils/clayTokens';
import { SETTINGS_HUE, SettingsTextButton } from './SettingsHome';

export default function ProfileSettingsPage() {
    const { userProfile, updateUserProfile, addToast } = useOS();
    const fileRef = useRef<HTMLInputElement>(null);

    const changeAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const base64 = await processImage(file);
            updateUserProfile({ avatar: await migrateDataUrlToRef(base64) });
            addToast('头像已更新', 'success');
        } catch (err: any) {
            addToast(err?.message || '头像没换成', 'error');
        }
    };

    return (
        <div className="flex flex-col" style={{ gap: 22 }}>
            <div className="flex flex-col items-center" style={{ gap: 4, paddingTop: 8 }}>
                <button type="button" onClick={() => fileRef.current?.click()} aria-label="换头像"
                    className="relative active:opacity-60 transition-opacity" style={{ background: 'transparent', border: 'none', padding: 0 }}>
                    <span className="flex items-center justify-center overflow-hidden"
                        style={{ width: 88, height: 88, borderRadius: R.pill, background: SETTINGS_HUE.tint, color: SETTINGS_HUE.ink, fontFamily: FONT.heading, fontSize: 34, fontWeight: 700 }}>
                        {userProfile.avatar ? <TokenImg value={userProfile.avatar} className="w-full h-full object-cover" /> : (userProfile.name || '我').slice(0, 1)}
                    </span>
                    <span className="absolute flex items-center justify-center"
                        style={{ right: 0, bottom: 0, width: 28, height: 28, borderRadius: R.pill, background: SETTINGS_HUE.main, border: `2px solid ${F.appBg}` }}>
                        <Camera size={14} weight="bold" color={F.surface} />
                    </span>
                </button>
                <SettingsTextButton onClick={() => fileRef.current?.click()}>换头像</SettingsTextButton>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={changeAvatar} />
            </div>

            {/* [EM: settings-subpages-f] 名字、关于我也是分组里的填写行；分角色头像换成一行一个角色 */}
            <Group foot="名字是所有聊天里默认的「我」；关于我会发给角色，让 TA 更了解你。">
                <FieldRow label="名字" value={userProfile.name} placeholder="你的名字" onDraft={v => updateUserProfile({ name: v })} onCommit={() => {}} />
                <FieldRow label="关于我 / 设定" value={userProfile.bio} multiline rows={8} placeholder="描述你自己…" onDraft={v => updateUserProfile({ bio: v })} onCommit={() => {}} />
            </Group>

            <PerCharAvatarRows />
        </div>
    );
}
// [EM-END: settings-ios-list]
