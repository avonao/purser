import { css } from '@avonao/purser';
import { t } from '../lib/tokens';

const pulse = css.keyframes({
  from: { opacity: 0.6 },
  to: { opacity: 1 },
});

const s = css.create({
  button: {
    paddingInline: t.space[4],
    paddingBlock: t.space[2],
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: t.color.line, ':focus-visible': t.color.focus },
    backgroundColor: { default: t.color.surface, ':hover': { default: t.color.line, '@media (hover: none)': null } },
    color: { default: t.color.text, '[aria-pressed="true"]': t.color.accent, ':disabled': t.color.muted },
    transitionProperty: 'color, background-color',
    transitionDuration: t.duration.fast,
    transitionTimingFunction: t.easing.out,
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
  },
  busy: { animationName: pulse, animationDuration: '1s', animationIterationCount: 'infinite' },
});

export function Button(props: { pressed?: boolean; busy?: boolean }) {
  return <button aria-pressed={props.pressed} className={css.props(s.button, props.busy && s.busy)} />;
}
