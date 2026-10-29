import { css } from '@avonao/purser';
import { t } from '../tokens.js';

export const s = css.create({
  raw: { color: 'red' },
  important: { width: '1px !important' },
  shorthand: { border: '1px solid' },
  unknownToken: { color: 'var(--color-nope)' },
  dynamic: { width: window.innerWidth },
  fine: { color: t.color.text },
});
