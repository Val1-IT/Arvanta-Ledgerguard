## Summary

## Tests
- [ ] `pnpm verify` (or equivalent unit/typecheck/lint)
- [ ] Integration tests if this touches Postgres execution

## Invariants
- [ ] LLM/model output is not treated as authority
- [ ] No new arbitrary write SQL
- [ ] Verify-before-commit still holds
- [ ] Core/policy isolation not broken
