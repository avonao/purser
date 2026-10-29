import { defineTokens } from '@avonao/purser';

// Erasable TypeScript only: Node strips the types when the build loads this file.
export const bp = {
  md: '@media (width >= 768px)',
  lg: '@media (width >= 1024px)',
} as const;

export const t = defineTokens({
  axes: {
    mode: { light: ':not(.dark)', dark: '.dark' },
    contrast: { normal: ':not(.hc)', high: '.hc' },
    wallpaper: { a: ':not(.bg2):not(.bg0)', b: '.bg2', none: '.bg0' },
  },
  tokens: {
    color: {
      text: { default: '#1a1a1a', 'mode=dark': '#ededed', 'contrast=high': '#000', 'mode=dark&contrast=high': '#fff' },
      muted: { default: 'oklch(55% 0.01 260)', 'mode=dark': 'oklch(70% 0.01 260)' },
      accent: 'oklch(71.57% 0.1797 33.51)',
      surface: { default: '#fff', 'mode=dark': 'rgb(18 18 18)', 'wallpaper=b': 'rgb(255 255 255 / 0.72)', 'mode=dark&wallpaper=b': 'rgba(18, 18, 18, 0.72)' },
      line: { default: 'oklab(0 0 0 / 0.1)', 'mode=dark': 'lab(100 0 0 / 0.12)' },
      focus: 'hsl(210 100% 50%)',
      selection: 'color(display-p3 1 0.8 0.2 / 0.4)',
    },
    space: { 1: '4px', 2: '8px', 4: '16px', 6: '24px' },
    radius: { md: '10px', full: '9999px' },
    shadow: { card: { default: '0 1px 2px rgb(0 0 0 / 0.08)', 'mode=dark': '0 0 0 1px #ffffff1f' } },
    font: { sans: 'Inter, ui-sans-serif, system-ui, sans-serif' },
    fontSize: { sm: '14px', md: '16px' },
    lineHeight: { body: 1.5 },
    duration: { fast: '120ms' },
    easing: { out: 'cubic-bezier(0.2, 0, 0, 1)' },
    z: { overlay: 50 },
  },
});
