// [EM-START: char-drives-engine]
/** 查手机状态小组件的那句话：每种心思 × 档位一句，不出现数字（components/checkphone/StatusWidget.tsx）。 */
export type DriveStatusLevel = 'mid' | 'high';

const PHRASES: Record<string, Record<DriveStatusLevel, string>> = {
    miss: { mid: '有点想你', high: '很想你' },
    curious: { mid: '有点坐不住', high: '想到处看看' },
    reminisce: { mid: '想起以前的事', high: '一直在想以前的事' },
    social: { mid: '想找朋友说说话', high: '很想出去见人' },
    stress: { mid: '工作上有点烦', high: '被工作压得喘不过气' },
    sulk: { mid: '心里有点堵', high: '在闹别扭' },
    concern: { mid: '有点挂心你', high: '很担心你' },
    desire: { mid: '有点念想', high: '念想很重' },
    tired: { mid: '有点累', high: '累坏了' },
};

export const statusPhrase = (drives: { drive: string; level: DriveStatusLevel }[]): string =>
    drives.map(d => PHRASES[d.drive]?.[d.level]).filter(Boolean).join(' · ');
// [EM-END: char-drives-engine]
