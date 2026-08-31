# oold-js

Reference JavaScript validator for [OO-LD](https://github.com/OO-LD/oold-schema) schemas.

An OO-LD document is at once a valid JSON Schema and a JSON-LD remote context. This validator checks both halves and the relationship between them: that a schema is well-formed against the OO-LD dialect meta-schema, that its `@context` maps what the schema declares, and that an instance survives a round-trip through RDF and re-validates against the schema it came from.

It is the reference implementation the Python port [`oold`](https://github.com/OO-LD/oold-python) is checked against. `oold` is the maintained validator and is what a project should use; this one exists so that agreement between two independent implementations is something the test suites can assert rather than assume.

## Use

```bash
npx github:OO-LD/oold-js <schema-dir> --meta <path-to-oold-schema>/meta
```

`<schema-dir>` defaults to `./examples`, `--meta` to `./meta`, so from the root of an `oold-schema` checkout:

```bash
npx github:OO-LD/oold-js
```

The meta-schemas are not vendored here. They are owned by `oold-schema` and versioned with the specification, so pinning them is the caller's decision rather than this package's.

Exit status is non-zero when any check fails.

## What it checks

| Tier | Checks |
|---|---|
| Rule catalog | `meta/oold-rules.json` validates against its own schema |
| Schemas | meta-schema conformance, `$ref` composition resolves |
| Pattern lint | round-trip-safe `@context` (`@container: @set` on arrays, `iri-reference` on references) |
| Committed instances | validate against their schema, formats included |
| Generated instances | satisfiability: a faked instance validates against the schema that produced it |
| Round-trip | a generated instance survives JSON -> RDF -> JSON with no loss and re-validates |
| Compliance | the `examples/compliance` fixtures, where present |
| Coverage | every `x-oold-*` keyword has a fixture; every machine-checkable rule has one |

## Maintenance

This package is **conformance-maintained**. It pins a specification tag, runs the conformance suite, and keeps passing it. Nothing else: no feature work, no API surface, no npm release unless someone asks for one.

`oold-python` is the maintained implementation - it validates `oold-schema` in CI, ships the meta-schema version history, and is where new checks land. A check arrives here only when the conformance suite requires it.

A divergence from `oold-python` is a bug in this repository and is fixed, not recorded. That is the whole point: the reason to keep a second implementation is not redundancy, it is that when two implementations built from the same prose disagree, the usual cause is that the prose is ambiguous. That is a finding about the specification, and it only surfaces if divergences are investigated rather than allowed to accumulate.

`oold-python`'s parity suite runs both over the same corpus and requires the same verdict. It does not say which side is wrong.

## Licence

CC0 1.0 Universal, the same as the specification.
