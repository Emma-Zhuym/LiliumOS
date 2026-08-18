export const PHOTO_STYLE_PRESETS = [
  { value: '', label: '无', prompt: '' },
  {
    value: 'realistic-candid',
    label: '真实随拍',
    prompt: 'photorealistic candid smartphone photography, realistic facial proportions, natural skin texture, soft available light, authentic everyday atmosphere, subtle depth of field, unretouched detail, not illustration, not anime, not 3D render',
  },
  {
    value: 'japanese-watercolor',
    label: '日系透明水彩',
    prompt: 'Japanese romantic character illustration, translucent watercolor washes, delicate graphite and fine ink linework, visible cold-pressed watercolor paper grain, subtle pigment blooms and granulation, luminous diffused backlight, restrained warm neutral palette, elegant detailed facial features, airy hand-painted finish; apply this as visual treatment only and preserve the scene, pose, camera angle, expression, and clothing described earlier',
  },
  {
    value: 'semi-real-fantasy',
    label: '半写实幻想',
    prompt: 'semi-realistic anime and realism fusion, elegant stylized facial proportions, luminous expressive eyes, smooth painterly skin with minimal pore detail, realistically rendered wet hair, jewelry, water, and fabrics, cinematic fantasy lighting, polished beauty illustration; refined but not hyperreal, avoid uncanny photorealistic facial features',
  },
  {
    value: 'soft-film',
    label: '柔光胶片',
    prompt: 'analog film photography, warm natural light, fine film grain, gentle halation, muted colors, soft focus, candid composition',
  },
  {
    value: 'korean-webtoon',
    label: '韩系精绘',
    prompt: 'polished Korean webtoon and otome game illustration, crisp elegant linework, clean stylized shapes, refined cel shading blended with soft airbrushed volume, glossy material highlights, detailed objects and fabrics, expressive commercial character-art finish; use only the rendering and line-art style, preserve the requested scene and do not impose any fixed color palette, background, interface overlay, text, or props',
  },
  {
    value: 'clean-anime',
    label: '清透日漫',
    prompt: 'polished Japanese anime illustration, clean delicate lineart, soft cel shading, luminous natural colors, refined facial features, airy composition',
  },
  {
    value: 'cinematic-portrait',
    label: '电影写真',
    prompt: 'cinematic editorial portrait photography, soft directional lighting, realistic skin texture, rich natural color grading, shallow depth of field, intimate 35mm composition',
  },
  {
    value: 'painterly-illustration',
    label: '厚涂插画',
    prompt: 'refined painterly digital illustration, layered visible brushwork, rich color transitions, sculpted light and shadow, detailed expressive face, sophisticated concept art finish',
  },
] as const;

export const getPhotoStylePrompt = (value?: string): string =>
  PHOTO_STYLE_PRESETS.find(preset => preset.value === value)?.prompt || '';
