---
type: sh:NodeShape
rdfs:label: TechArticle Shape
sh:targetClass: schema:TechArticle
sh:property:
  - sh:path: schema:headline
    sh:minCount: 1
    sh:maxCount: 1
    sh:datatype: xsd:string
    sh:message: TechArticle must have exactly one headline.
  - sh:path: schema:description
    sh:minCount: 1
    sh:datatype: xsd:string
    sh:message: TechArticle must have a description summary.
  - sh:path: schema:wordCount
    sh:datatype: xsd:integer
---

# TechArticle Validation Shape

Rules for `schema:TechArticle` documents. Two of the three properties declare
their own `sh:message`; `schema:wordCount` declares none, so a datatype failure
on it falls back to the default wording.
