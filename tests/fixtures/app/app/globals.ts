import { css } from '@avonao/purser';
import { t } from '../lib/tokens';

css.globals({
  ':root': { colorScheme: { default: 'light', ':is(.dark)': 'dark' } },
  '*, ::before, ::after': { boxSizing: 'border-box', margin: 0 },
  body: {
    fontFamily: t.font.sans,
    color: t.color.text,
    backgroundColor: t.color.surface,
  },
  '::selection': { backgroundColor: t.color.selection },
  '@font-face': { fontFamily: 'Inter', src: 'url("/fonts/inter.woff2") format("woff2")', fontDisplay: 'swap' },
});
