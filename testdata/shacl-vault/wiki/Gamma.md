---
type: TechArticle
headline:
  - Gamma
  - Gamma The Second
wordCount: "120"
description: Breaks two constraints on purpose, and is committed that way.
---

# Gamma

This page is **already invalid as committed**, and that is the point of it.

`headline` is a two-item sequence against `sh:maxCount: 1`, so it is two
triples where the shape allows one. `wordCount` is the quoted string `"120"`
against `sh:datatype: xsd:integer`, and the quotes are what make it a
violation: the graph loader reads a quoted YAML scalar as a Python `str`, so
the triple is an `xsd:string` and not an integer. Written bare, `wordCount:
120` would satisfy the same constraint.

The reason it is committed broken rather than mutated into shape at test time
is that a baseline of zero results is a weak thing to compare. An empty set
agrees with an empty set for any reason at all, including both sides being
broken. Starting from a vault that already has results means the first thing
the test checks is the one that can actually fail.
