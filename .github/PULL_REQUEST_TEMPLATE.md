## What and why

<!-- The behaviour change and the reason for it. Link the issue if there is one. -->

## Checklist

- [ ] `npm test` passes
- [ ] The guarantees still hold (no overrides, no `!important`, colours as tokens, `lab()` output, one stylesheet)
- [ ] Tests cover the change (exclusivity cases, golden output, extraction errors, types)
- [ ] Golden files regenerated with `npm run test:update` and the diff reviewed (if output changed)
- [ ] `types/*.d.ts` and `docs/` updated (if the API changed)
- [ ] `CHANGELOG.md` updated (class name changes are breaking)
