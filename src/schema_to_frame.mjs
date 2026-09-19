// Minimal schema-to-frame derivation for OO-LD.
//
// Compaction alone reconstructs literals and references from RDF, but an embedded
// object is flattened into a separate (blank) node and compaction never re-nests a
// flat graph. Framing does. This module derives, from an OO-LD schema, the minimal
// JSON-LD frame needed to reconstruct a schema's instances:
//
//   - @type is the schema's instance rdf:type(s) (x-oold-instance-rdf-type), so the
//     exported root - which materializes that type - is the frame root and embedded
//     objects nest beneath it rather than surfacing as sibling graph nodes;
//   - @context is the schema's own context (or a reference to it), so terms compact
//     back to their property names;
//   - an empty subframe {} is added for each property that embeds an object, detected
//     as a @context term carrying a scoped @context. Reference-valued and literal
//     properties need no subframe: a referenced IRI with no local triples stays
//     { id: ... } and literals compact directly.
//
// Use with jsonld.frame(rdf, frame, { omitDefault: true }) so a property absent from a
// given instance is omitted rather than emitted as null.

// Collect the object-valued term definitions of a @context (which may be a string, an
// array, or an object), keyed by term name; keyword entries (@vocab, @version, ...) are
// skipped.
export function contextTerms(context, out = {}) {
  if (Array.isArray(context)) {
    for (const c of context) contextTerms(c, out);
    return out;
  }
  if (context && typeof context === "object") {
    for (const [term, def] of Object.entries(context)) {
      if (term.startsWith("@")) continue;
      if (def && typeof def === "object") out[term] = def;
    }
  }
  return out;
}

// An embed is an *object* value: type "object" with its own properties. A $ref alone is not
// enough - it may point at a scalar DataType leaf (a literal, not an embed) - and after
// dereferencing a real embed is inlined as such an object anyway.
const isEmbed = (node) => {
  if (!node || typeof node !== "object") return false;
  if (node.type === "object" && node.properties) return true;
  if (node.items) return isEmbed(node.items);
  for (const kw of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[kw]) && node[kw].some(isEmbed)) return true;
  }
  return false;
};

// Properties may live in allOf members (a dereferenced subclass chain inlines each
// superclass as an allOf entry), so collect the full composed property map.
const collectProps = (node, out = {}) => {
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node.properties || {})) if (!(k in out)) out[k] = v;
  for (const sub of node.allOf || []) collectProps(sub, out);
  return out;
};

// The IRI/URI-family formats OOLD-EXT-6ea3 recommends for an IRI-valued property.
const IRI_FORMATS = new Set(["iri", "iri-reference", "uri", "uri-reference"]);

// Properties that embed an object, detected from the JSON Schema shape - a property whose
// value (or array items, or an anyOf/oneOf branch) is an object with its own properties or a
// $ref to a type. A scoped @context is a strong signal too, but it is not mandatory (an
// embed can be mapped by the ambient/top-level context), so shape is the primary signal.
export function embeddedProperties(schema) {
  const props = collectProps(schema);
  const structural = Object.keys(props).filter((k) => isEmbed(props[k]));
  const terms = contextTerms(schema["@context"]);
  // A scoped term only counts where the schema declares a property of that name. A schema must
  // reflect every $ref in its @context (OOLD-CMP-b926), including the ones reached from $defs, so
  // the context carries terms for properties this schema's instances never hold; treating those
  // as embeds puts a property into the derived frame that no instance can match, and framing then
  // returns nothing.
  const scoped = Object.keys(terms).filter((t) => "@context" in terms[t] && t in props);
  return [...new Set([...structural, ...scoped])];
}

// The instance rdf:type(s) a schema declares. Composition is most-derived-wins
// (override, consistent with @context): the nearest declaration in the composition
// chain is authoritative; superclass types are recoverable by ontology inference and
// are not materialized. A subclass that wants supertypes in the data lists them
// explicitly. After dereference the most-derived value is at the top level; the fallback
// walks allOf only for a subclass that omits its own declaration.
export function instanceRdfTypes(schema) {
  if (!schema || typeof schema !== "object") return null;
  const own = schema["x-oold-instance-rdf-type"];
  if (Array.isArray(own) && own.length) return own;
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      const t = instanceRdfTypes(sub);
      if (t) return t;
    }
  }
  return null;
}

// Properties whose value is a reference, so framing must leave it an IRI rather than
// pull the referenced node's triples into this document. Three signals, per
// OOLD-EXT-68fa: an x-oold-range on a string-typed value, an IRI-family format, or a
// context term mapped "@type": "@id".
//
// Without this, a referenced node that happens to carry triples in the same graph is
// embedded as an object, and the framed document no longer validates against the schema
// the frame was derived from - the schema declares a string there. Embedding wins where
// both signals appear: a property shaped like an object is an embed whatever its term says.
// Property names that alias a JSON-LD keyword, such as `id` for `@id`. These are not
// predicates: `id` names the node, it does not point at another one. A subframe under such a
// key writes { "@id": {...} } into the frame, which a processor rejects outright.
//
// Searched across the composed schema: a dereferenced subclass chain keeps each superclass's
// own @context on its allOf member, and the convention is usually declared by the base schema
// rather than repeated by every subclass.
export function keywordAliasKeys(schema) {
  const found = new Set();

  const scanContext = (context) => {
    if (Array.isArray(context)) {
      for (const entry of context) scanContext(entry);
      return;
    }
    if (!context || typeof context !== "object") return;
    for (const [term, def] of Object.entries(context)) {
      if (term.startsWith("@")) continue;
      const target = def && typeof def === "object" ? def["@id"] : def;
      if (typeof target === "string" && target.startsWith("@")) found.add(term);
    }
  };

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    scanContext(node["@context"]);
    for (const sub of node.allOf || []) walk(sub);
  };

  walk(schema);
  return found;
}

export function referenceProperties(schema) {
  const props = collectProps(schema);
  const terms = contextTerms(schema["@context"]);
  const aliases = keywordAliasKeys(schema);

  const isReference = (node) => {
    if (!node || typeof node !== "object") return false;
    if (node.items) return isReference(node.items);
    if ("x-oold-range" in node) return true;
    if (typeof node.format === "string" && IRI_FORMATS.has(node.format)) return true;
    for (const kw of ["anyOf", "oneOf", "allOf"]) {
      if (Array.isArray(node[kw]) && node[kw].some(isReference)) return true;
    }
    return false;
  };

  return Object.keys(props).filter(
    (k) =>
      !aliases.has(k) &&
      !isEmbed(props[k]) &&
      (isReference(props[k]) || terms[k]?.["@type"] === "@id"),
  );
}

// Derive the minimal frame. contextRef, when given, is used as the frame's @context in
// place of the schema's inline @context (pass the schema URL so a document loader
// resolves inherited/scoped contexts).
export function schemaToFrame(schema, contextRef) {
  const frame = { "@embed": "@once" };
  frame["@context"] = contextRef !== undefined ? contextRef : schema["@context"];
  const types = instanceRdfTypes(schema);
  if (types) frame["@type"] = types.length === 1 ? types[0] : types;
  for (const p of embeddedProperties(schema)) frame[p] = {};
  for (const p of referenceProperties(schema)) frame[p] = { "@embed": "@never" };
  return frame;
}
