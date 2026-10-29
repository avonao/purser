import { css } from '@avonao/purser';
import { s } from './styles.js';

/** Render the fixture page body (no framework needed). */
export function renderBody() {
  const c = (...args) => css.props(...args);
  return `
<main class="${c(s.page)}">
  <h1 class="${c(s.title)}">Fixture</h1>
  <p>Global margins only.</p>
  <section id="card" data-hover class="${c(s.card)}"><h2 class="${c(s.title)}">Card</h2><p class="${c(s.wide)}">Body</p></section>
  <section id="card-active" data-hover class="${c(s.card, s.active)}"><h2 class="${c(s.title, s.wide)}">Active</h2></section>
  <button id="btn" data-hover data-focus class="${c(s.button)}">Button</button>
  <button id="btn-pressed" data-hover aria-pressed="true" class="${c(s.button)}">Pressed</button>
  <button id="btn-disabled" data-hover disabled class="${c(s.button)}">Disabled</button>
  <span id="probe" class="${c(s.probe)}">probe</span>
</main>`;
}
