---
type:
  - schema:TechArticle
  - schema:SoftwareApplication
headline: Delta
name: Delta
description: The page both shapes constrain.
---

# Delta

Two shapes apply here, which is what makes this page the only place in the
fixture where a shape's own `sh:message` and the app's fallback wording are
checked against each other in the same report.

Emptying `description` here produces two results from two different sources:

- `Tech_Article_Shape` declares `sh:message` on `schema:description`, so its
  result carries `TechArticle must have a description summary.`
- `Software_Application_Shape` declares none, so its result falls back to
  `Less than 1 values on wiki:Delta->schema:description`

The fallback interpolates the focus node, which is why the focus node has to be
spelled identically on both sides for this page to compare at all.
