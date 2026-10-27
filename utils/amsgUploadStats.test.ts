import { beforeEach, describe, expect, it } from 'vitest';
import {
  TOOL_PACK_SIG_TTL_MS,
  forgetToolPackUploads,
  hashStateValue,
  isToolPackUploaded,
  readAmsgUploadStats,
  recordAmsgUploadStats,
  rememberToolPackUploaded,
} from './amsgUploadStats';

beforeEach(() => localStorage.clear());

describe('tool_pack 指纹', () => {
  it('同一份内容同一个指纹，改一个字就变', () => {
    expect(hashStateValue('{"a":1}')).toBe(hashStateValue('{"a":1}'));
    expect(hashStateValue('{"a":1}')).not.toBe(hashStateValue('{"a":2}'));
  });

  it('记过才算传过；换 worker / 换角色 / 内容变了都不算', () => {
    rememberToolPackUploaded('w1|u', 'c1', 'sig', 1000);
    expect(isToolPackUploaded('w1|u', 'c1', 'sig', 2000)).toBe(true);
    expect(isToolPackUploaded('w2|u', 'c1', 'sig', 2000)).toBe(false);
    expect(isToolPackUploaded('w1|u', 'c2', 'sig', 2000)).toBe(false);
    expect(isToolPackUploaded('w1|u', 'c1', 'other', 2000)).toBe(false);
  });

  it('过了 24 小时照传一次', () => {
    rememberToolPackUploaded('w|u', 'c', 'sig', 0);
    expect(isToolPackUploaded('w|u', 'c', 'sig', TOOL_PACK_SIG_TTL_MS - 1)).toBe(true);
    expect(isToolPackUploaded('w|u', 'c', 'sig', TOOL_PACK_SIG_TTL_MS)).toBe(false);
  });

  it('作废一个角色只清那个角色，不传 charId 全清', () => {
    rememberToolPackUploaded('w|u', 'c1', 's');
    rememberToolPackUploaded('w|u', 'c2', 's');
    forgetToolPackUploads('c1');
    expect(isToolPackUploaded('w|u', 'c1', 's')).toBe(false);
    expect(isToolPackUploaded('w|u', 'c2', 's')).toBe(true);
    forgetToolPackUploads();
    expect(isToolPackUploaded('w|u', 'c2', 's')).toBe(false);
  });
});

describe('最近一次上传的体积', () => {
  it('存了就读得回来，坏数据当没有', () => {
    expect(readAmsgUploadStats()).toBeNull();
    recordAmsgUploadStats({ at: 1, ok: true, totalBytes: 10, chars: [] });
    expect(readAmsgUploadStats()?.totalBytes).toBe(10);
    localStorage.setItem('amsg2_last_upload_stats', '{oops');
    expect(readAmsgUploadStats()).toBeNull();
  });
});
