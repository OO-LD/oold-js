// Frame derivation, checked against the worked example in the specification's
// #framing section and against the failure that example did not cover.
import assert from 'node:assert/strict';
import test from 'node:test';
import jsonld from 'jsonld';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  embeddedProperties,
  keywordAliasKeys,
  referenceProperties,
  schemaToFrame,
} from '../src/schema_to_frame.mjs';

// The specification's Organization example, dereferenced: address inlines the Address
// schema, employees is an array of IRI strings carrying x-oold-range.
const organization = {
  '@context': {
    schema: 'http://schema.org/',
    type: '@type',
    id: '@id',
    address: { '@id': 'schema:address', '@context': 'Address.schema.json' },
    employees: { '@reverse': 'schema:worksFor', '@type': '@id' },
  },
  $id: 'Organization.schema.json',
  'x-oold-instance-rdf-type': ['schema:Organization'],
  type: 'object',
  properties: {
    address: {
      '@context': { schema: 'http://schema.org/', postalCode: 'schema:postalCode' },
      $id: 'Address.schema.json',
      'x-oold-instance-rdf-type': ['schema:PostalAddress'],
      type: 'object',
      properties: { postalCode: { type: 'string' } },
    },
    employees: {
      type: 'array',
      items: { type: 'string', 'x-oold-range': 'Person.schema.json' },
    },
  },
};

test('the worked example derives the frame the specification prints', () => {
  const frame = schemaToFrame(organization, 'Organization.schema.json');

  assert.equal(frame['@context'], 'Organization.schema.json');
  assert.equal(frame['@type'], 'schema:Organization');
  assert.deepEqual(frame.address, {}, 'an inlined object property embeds');
  assert.deepEqual(
    frame.employees,
    { '@embed': '@never' },
    'a reference-valued property keeps its targets as IRIs (OOLD-EXT-68fa)',
  );
});

test('embedding wins where a property carries both signals', () => {
  // address is shaped like an object and its term carries a scoped @context; it must
  // not be demoted to a reference by the term-based signal.
  assert.ok(embeddedProperties(organization).includes('address'));
  assert.ok(!referenceProperties(organization).includes('address'));
});

test('a bare @reverse term is reference-valued', () => {
  // A reverse term's values are node references by definition (JSON-LD 1.1 4.1.10), so
  // "@type": "@id" beside it is redundant. The specification's own worked example writes
  // both, which is why keying only on @type passed every fixture while missing the
  // idiomatic spelling and embedding the targets.
  const schema = {
    '@context': { employees: { '@reverse': 'schema:worksFor' } },
    properties: { employees: { type: 'array', items: { type: 'string' } } },
  };
  assert.deepEqual(referenceProperties(schema), ['employees']);
  assert.deepEqual(schemaToFrame(schema).employees, { '@embed': '@never' });
});

test('a keyword alias never gets a subframe', () => {
  // `id` names the node, it is not a predicate. It carries an IRI format, so the reference
  // signals match, but a subframe there writes { "@id": {...} }, which a processor rejects.
  // The alias is declared by the base schema, so it has to be found through allOf.
  const schema = {
    '@context': { schema: 'http://schema.org/' },
    allOf: [{
      '@context': { id: '@id', type: '@type' },
      properties: { id: { type: 'string', format: 'iri' } },
    }],
    properties: { ref: { type: 'string', format: 'iri-reference' } },
  };
  assert.deepEqual([...keywordAliasKeys(schema)].sort(), ['id', 'type']);
  assert.deepEqual(referenceProperties(schema), ['ref']);
  assert.ok(!('id' in schemaToFrame(schema, 'X.schema.json')));
});

test.describe('a reference whose target carries triples in the same graph', () => {
  // OO-LD/oold-schema#160. works_for is declared a string, so framing must leave it one.
  const person = {
    '@context': {
      schema: 'http://schema.org/',
      type: '@type',
      id: '@id',
      works_for: { '@id': 'schema:worksFor', '@type': '@id' },
      name: 'schema:name',
    },
    'x-oold-instance-rdf-type': ['schema:Person'],
    type: 'object',
    properties: {
      name: { type: 'string' },
      works_for: { type: 'string', format: 'iri-reference' },
    },
  };

  const nq = [
    '<https://example.org/jane> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://schema.org/Person> .',
    '<https://example.org/jane> <http://schema.org/worksFor> <https://example.org/acme> .',
    '<https://example.org/joe> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://schema.org/Person> .',
    '<https://example.org/joe> <http://schema.org/worksFor> <https://example.org/acme> .',
    '<https://example.org/acme> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://schema.org/Organization> .',
    '<https://example.org/acme> <http://schema.org/name> "ACME" .',
    '',
  ].join('\n');

  const framedPeople = async () => {
    const rdf = await jsonld.fromRDF(nq, { format: 'application/n-quads' });
    const out = await jsonld.frame(rdf, schemaToFrame(person), { omitDefault: true });
    return out['@graph'] ?? [out];
  };

  test('stays an IRI rather than being embedded', async () => {
    for (const p of await framedPeople()) {
      assert.equal(
        typeof p.works_for,
        'string',
        `${p.id}: a reference-valued property must not absorb the target's triples`,
      );
    }
  });

  test('framed output validates against the schema the frame came from', async () => {
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const { '@context': _c, 'x-oold-instance-rdf-type': _t, ...validatable } = person;
    const validate = ajv.compile(validatable);

    for (const p of await framedPeople()) {
      const { '@context': _, ...doc } = p;
      assert.ok(validate(doc), `${p.id}: ${ajv.errorsText(validate.errors)}`);
    }
  });
});
