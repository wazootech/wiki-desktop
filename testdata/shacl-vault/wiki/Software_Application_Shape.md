---
type: sh:NodeShape
rdfs:label: SoftwareApplication Shape
sh:targetClass: schema:SoftwareApplication
sh:property:
  - sh:path: schema:name
    sh:minCount: 1
    sh:datatype: xsd:string
  - sh:path: schema:softwareVersion
    sh:datatype: xsd:string
  - sh:path: schema:description
    sh:minCount: 1
    sh:datatype: xsd:string
---

# SoftwareApplication Validation Shape

Rules for `schema:SoftwareApplication` documents. No property here declares an
`sh:message`, so every result this shape raises falls back to the default
wording — which is what keeps `DEFAULT_MESSAGES` measured rather than
remembered.
