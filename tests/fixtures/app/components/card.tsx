import { css } from '@avonao/purser';
import { bp, t } from '@/lib/tokens';

const surface = {
  backgroundColor: t.color.surface,
  boxShadow: t.shadow.card,
} as const;

const s = css.create({
  card: {
    ...surface,
    padding: t.space[4],
    borderRadius: t.radius.md,
    color: { default: t.color.text, ':hover': t.color.accent },
    display: { default: 'block', [bp.md]: 'flex', [bp.lg]: 'grid' },
    gap: `calc(${t.space[2]} * 2)`,
    '::before': { content: '""', backgroundColor: t.color.line, height: 1 },
  },
  active: { color: t.color.accent },
  title: {
    fontSize: { default: t.fontSize.sm, [bp.md]: t.fontSize.md },
    lineHeight: t.lineHeight.body,
    marginBlock: 0,
    whiteSpace: 'nowrap',
  },
});

export function Card({ active, title }: { active?: boolean; title: string }) {
  return (
    <section className={css.props(s.card, active && s.active)}>
      <h2 className={css.props(s.title)}>{title}</h2>
    </section>
  );
}
