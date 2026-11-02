# F8 — the render audit's glyph list: a literal, or a registry

## the fork

`render.contract.integration.test.ts` matches an artifact header with `/^(🔮|⛵|🦺|🧿) /`. this
change added `🧿` for the guardian. a reviewer asks for one glyph source a new role enrolls into.

- (a) build a role-glyph registry now and derive the audit's predicate from it
- (b) keep the literal; build the registry when a role ships a glyph through a path other than
  this audit

## taken, and why

(b). the audit is the only reader of the glyph set. a registry with one consumer moves the
same four glyphs into a second file and adds an import, with no seam a caller feels
(`rule.prefer.wet-over-dry`). the literal also fails loud: a new role whose glyph is absent
reddens this audit on its first render, so the list cannot drift silently.

## rework

clean. a registry is one exported list and a one-line predicate change; no skill hardens
against the literal.

## confidence

85%.

## where

- `src/domain.roles/render.contract.integration.test.ts`

## verdict once ruled

_(awaits council)_
