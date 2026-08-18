import { describe, expect, it } from 'vitest';
import { getPhotoStylePrompt, PHOTO_STYLE_PRESETS } from './photoStylePresets';

describe('photo style presets', () => {
  it('keeps preset values unique', () => {
    const values = PHOTO_STYLE_PRESETS.map(preset => preset.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('describes the watercolor preset as style-only treatment', () => {
    const prompt = getPhotoStylePrompt('japanese-watercolor');
    expect(prompt).toContain('translucent watercolor washes');
    expect(prompt).toContain('cold-pressed watercolor paper grain');
    expect(prompt).toContain('preserve the scene, pose, camera angle');
  });

  it('keeps the semi-realistic preset stylized instead of hyperreal', () => {
    const prompt = getPhotoStylePrompt('semi-real-fantasy');
    expect(prompt).toContain('stylized facial proportions');
    expect(prompt).toContain('minimal pore detail');
    expect(prompt).toContain('not hyperreal');
  });

  it('uses the Korean illustration reference as line-art style only', () => {
    const prompt = getPhotoStylePrompt('korean-webtoon');
    expect(prompt).toContain('crisp elegant linework');
    expect(prompt).toContain('use only the rendering and line-art style');
    expect(prompt).toContain('do not impose any fixed color palette');
  });

  it('returns no suffix for no style or an old unknown value', () => {
    expect(getPhotoStylePrompt('')).toBe('');
    expect(getPhotoStylePrompt('cozy-home')).toBe('');
  });
});
