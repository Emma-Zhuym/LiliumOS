// 设置 → 主动消息 2.0：最近一次把角色快照传上云的时候，每块多大（2026-10-26，worker 被撑过 CPU 上限后加的）。
import React, { useEffect, useState } from 'react';
import { formatKb, readAmsgUploadStats, type AmsgUploadStats } from '../../utils/amsgUploadStats';
import { Group, Row } from './SettingsParts';

const timeLabel = (at: number) => new Date(at).toLocaleString('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

const AmsgUploadSizeGroup: React.FC = () => {
  const [stats, setStats] = useState<AmsgUploadStats | null>(null);
  useEffect(() => { setStats(readAmsgUploadStats()); }, []);

  return (
    <Group
      title="最近一次同步到云端"
      foot="每聊完一轮都会把角色的快照传一次。大小是加密前的，实际上传再大三分之一左右。"
    >
      {stats ? [
        <Row
          key="total"
          title="这一批"
          sub={timeLabel(stats.at)}
          value={`${stats.ok ? '' : '失败 · '}${formatKb(stats.totalBytes)}`}
          valueTone={stats.ok ? 'plain' : 'bad'}
        />,
        ...stats.chars.map((c, i) => (
          <Row
            key={`${c.name}-${i}`}
            title={c.name}
            sub={[
              `系统提示词 ${c.systemPromptChars.toLocaleString()} 字`,
              `最近对话 ${c.transcriptChars.toLocaleString()} 字${c.transcriptCapped ? '（更早的已省略）' : ''}`,
              c.toolPackBytes == null ? '记忆包没变，没传' : `记忆包 ${formatKb(c.toolPackBytes)}`,
            ].join(' · ')}
            value={formatKb(c.firePackBytes + (c.toolPackBytes ?? 0))}
          />
        )),
      ] : (
        <Row title="还没有记录" sub="跟开了主动消息的角色聊一轮再来看" />
      )}
    </Group>
  );
};

export default AmsgUploadSizeGroup;
