import { css } from '@avonao/purser';
import { bp, t } from './tokens.js';

css.globals({
  ':root': { colorScheme: { default: 'light', ':is(.dark)': 'dark' } },
  '*, ::before, ::after': { boxSizing: 'border-box', margin: 0 },
  body: { color: t.color.text, backgroundColor: t.color.surface, fontFamily: 'system-ui, sans-serif' },
  'h1, h2, p': { marginBlockEnd: t.space[2] },
});

const fade = css.keyframes({ from: { opacity: 0.5 }, to: { opacity: 1 } });

export const s = css.create({
  page: { paddingInline: t.space[4], paddingBlock: { default: t.space[2], [bp.md]: t.space[4] } },
  card: {
    padding: t.space[4],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: t.color.line, ':hover': t.color.accent },
    borderRadius: t.radius.md,
    boxShadow: t.shadow.card,
    color: { default: t.color.text, ':hover': t.color.accent },
    display: { default: 'block', [bp.md]: 'flex', [bp.lg]: 'grid' },
    gap: t.space[2],
    '::before': { content: '"•"', color: { default: t.color.line, ':hover': t.color.accent } },
  },
  active: { color: t.color.accent, borderColor: t.color.accent },
  title: { marginBlockStart: 0, marginBlockEnd: { default: t.space[1], [bp.md]: t.space[2] }, fontSize: { default: '16px', [bp.md]: '20px' } },
  button: {
    paddingInline: t.space[4],
    paddingBlock: t.space[2],
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: { default: t.color.line, ':focus-visible': t.color.focus },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineColor: t.color.focus,
    backgroundColor: { default: t.color.surface, ':hover': { default: t.color.line, '@media (hover: none)': null } },
    color: { default: t.color.text, '[aria-pressed="true"]': t.color.accent, ':disabled': t.color.line },
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
    animationName: fade,
    animationDuration: '200ms',
  },
  wide: { marginTop: t.space[4], marginInlineStart: t.space[2] },
  probe: { color: t.color.accent },
});
