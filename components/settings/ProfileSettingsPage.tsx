// [EM-START: settings-ios-list]
/**
 * 设置 → 个人档案：原来桌面上「档案」App 的内容（头像、名字、分角色聊天头像、关于我），
 * 收进设置最顶上那张卡里。桌面图标拿掉了，apps/UserApp.tsx 仍在、AppID.User 仍能打开。
 */

import React, { useRef, useState } from 'react';
import { Camera } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { processImage } from '../../utils/file';
import { migrateDataUrlToRef } from '../../utils/blobRef';
import PerCharAvatarPicker from '../user/PerCharAvatarPicker';
import TokenImg from '../os/TokenImg';
import { F, FONT, R } from '../../utils/clayTokens';
import { SETTINGS_HUE, SettingsTextButton } from './SettingsHome';

const fieldStyle = (focused: boolean): React.CSSProperties => ({
    width: '100%', background: F.surfaceSunken, borderRadius: R.input, outline: 'none',
    border: `1px solid ${focused ? F.accent : 'transparent'}`, color: F.textPrimary,
});

export default function ProfileSettingsPage() {
    const { userProfile, updateUserProfile, addToast } = useOS();
    const fileRef = useRef<HTMLInputElement>(null);
    const [focus, setFocus] = useState<'name' | 'bio' | null>(null);

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

            <div className="flex flex-col" style={{ gap: 6 }}>
                <label htmlFor="settings-profile-name" className="px-1" style={{ fontSize: 12, color: F.textTertiary }}>名字</label>
                <input id="settings-profile-name" value={userProfile.name}
                    onChange={e => updateUserProfile({ name: e.target.value })}
                    onFocus={() => setFocus('name')} onBlur={() => setFocus(null)}
                    placeholder="你的名字"
                    style={{ ...fieldStyle(focus === 'name'), height: 48, padding: '0 14px', fontSize: 16 }} />
                <div className="px-1" style={{ fontSize: 12, lineHeight: '18px', color: F.textTertiary }}>所有聊天里默认的「我」。</div>
            </div>

            <div className="flex flex-col" style={{ gap: 6 }}>
                <label htmlFor="settings-profile-bio" className="px-1" style={{ fontSize: 12, color: F.textTertiary }}>关于我 / 设定</label>
                <textarea id="settings-profile-bio" value={userProfile.bio}
                    onChange={e => updateUserProfile({ bio: e.target.value })}
                    onFocus={() => setFocus('bio')} onBlur={() => setFocus(null)}
                    placeholder="描述你自己…"
                    className="resize-none"
                    style={{ ...fieldStyle(focus === 'bio'), height: 208, padding: '12px 14px', fontSize: 15, lineHeight: '23px' }} />
                <div className="px-1" style={{ fontSize: 12, lineHeight: '18px', color: F.textTertiary }}>会发给角色，让 TA 更了解你。</div>
            </div>

            {/* 分角色聊天头像：上游组件，样子暂时还是旧的 */}
            <PerCharAvatarPicker />
        </div>
    );
}
// [EM-END: settings-ios-list]
