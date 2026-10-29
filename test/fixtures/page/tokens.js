import { defineTokens } from '@avonao/purser';

export const bp = { md: '@media (width >= 768px)', lg: '@media (width >= 1024px)' };

export const t = defineTokens({
  axes: {
    mode: { light: ':not(.dark)', dark: '.dark' },
    contrast: { normal: ':not(.hc)', high: '.hc' },
    wallpaper: { a: ':not(.bg2):not(.bg0)', b: '.bg2', none: '.bg0' },
  },
  tokens: {
    color: {
      text: { default: '#1a1a1a', 'mode=dark': '#ededed', 'contrast=high': '#000', 'mode=dark&contrast=high': '#fff' },
      accent: 'oklch(71.57% 0.1797 33.51)',
      surface: { default: '#fff', 'mode=dark': '#121212', 'wallpaper=b': 'rgb(255 255 255 / 0.7)', 'mode=dark&wallpaper=b': 'rgb(18 18 18 / 0.7)' },
      line: { default: 'oklab(0 0 0 / 0.1)', 'mode=dark': 'lab(100 0 0 / 0.12)' },
      focus: 'hsl(210 100% 50%)',
    },
    space: { 1: '4px', 2: '8px', 4: '16px' },
    radius: { md: '10px' },
    shadow: { card: { default: '0 1px 2px rgb(0 0 0 / 0.08)', 'mode=dark': '0 0 0 1px #ffffff1f' } },
  },
});
