/**
 * Error raised for any rule violation. `path` locates the offending value
 * inside the style object (for example ['card', 'color', ':hover']).
 */
export class PurserError extends Error {
  /**
   * @param {string} message
   * @param {(string|number)[]} [path]
   */
  constructor(message, path = []) {
    super(message);
    this.name = 'PurserError';
    this.path = path;
  }
}

/** Human-readable path such as `card.color[":hover"]`. */
export function formatPath(path) {
  let out = '';
  for (const p of path) {
    if (typeof p === 'string' && /^[A-Za-z_$][\w$]*$/.test(p)) out += out ? `.${p}` : p;
    else out += `[${JSON.stringify(p)}]`;
  }
  return out;
}
