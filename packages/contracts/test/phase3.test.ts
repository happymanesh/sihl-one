import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  confidenceFor,
  findMatches,
  nameSimilarity,
  normaliseMobile,
  normaliseName,
  normalisePan,
  scoreMatch,
  suggestDecision,
  type MatchCandidate,
} from '../src/matching';
import {
  detectDelimiter,
  parseDelimited,
  parseImportedAmount,
  parseProductInterest,
  splitFullName,
  suggestMapping,
  importDeclarationSchema,
} from '../src/import';
import {
  ruleMatches,
  selectOwner,
  selectRule,
  createAssignmentRuleSchema,
  offboardUserSchema,
  type MatchableRule,
} from '../src/assignment';

// ---------------------------------------------------------------------------
// Duplicate matching
// ---------------------------------------------------------------------------

const existing: MatchCandidate = {
  id: 'lead-1',
  reference: 'LD-2026-000001',
  firstName: 'Asha',
  lastName: 'Patel',
  mobile: '9876543210',
  email: 'asha.patel@example.com',
  pan: 'ABCDE1234F',
  city: 'Ahmedabad',
  ownerName: 'Rahul Mehta',
};

describe('identity normalisation', () => {
  it('reduces every mobile format to the last ten digits', () => {
    assert.equal(normaliseMobile('+91 98765 43210'), '9876543210');
    assert.equal(normaliseMobile('098765-43210'), '9876543210');
    assert.equal(normaliseMobile('919876543210'), '9876543210');
    assert.equal(normaliseMobile('12345'), null);
    assert.equal(normaliseMobile(null), null);
  });

  it('accepts a PAN only in the correct shape', () => {
    assert.equal(normalisePan(' abcde1234f '), 'ABCDE1234F');
    assert.equal(normalisePan('NOTAPAN'), null);
  });

  it('sorts name tokens so field order does not matter', () => {
    assert.equal(normaliseName('Asha', 'Patel'), normaliseName('Patel', 'Asha'));
  });

  it('strips honorifics', () => {
    assert.equal(normaliseName('Mr Rahul', 'Mehta'), normaliseName('Rahul', 'Mehta'));
  });
});

describe('duplicate scoring', () => {
  it('treats a matching PAN as decisive', () => {
    const result = scoreMatch(
      { firstName: 'Completely', lastName: 'Different', pan: 'abcde1234f' },
      existing,
    );
    assert.equal(result.confidence, 'DEFINITE');
    assert.equal(result.signals[0]?.code, 'PAN');
  });

  it('treats a matching mobile as decisive', () => {
    const result = scoreMatch({ firstName: 'A', mobile: '+91 98765 43210' }, existing);
    assert.equal(result.confidence, 'DEFINITE');
  });

  it('never reaches DEFINITE by stacking weak signals', () => {
    // The property that matters: an automatic skip must rest on an identity
    // key, never on an accumulation of hints.
    const result = scoreMatch(
      {
        firstName: 'Asha',
        lastName: 'Patel',
        email: 'asha.patel@example.com',
        city: 'Ahmedabad',
        mobile: '9999543210', // same last four, different number
      },
      existing,
    );
    assert.notEqual(result.confidence, 'DEFINITE');
    assert.ok(result.score < 90, `expected < 90, got ${result.score}`);
  });

  it('flags same name, same city, similar mobile for review', () => {
    const result = scoreMatch(
      { firstName: 'Asha', lastName: 'Patel', city: 'Ahmedabad', mobile: '9812343210' },
      existing,
    );
    assert.equal(result.confidence, 'PROBABLE');
  });

  it('does not flag a common name alone', () => {
    // "Rahul Patel" in Ahmedabad is not rare. Treating this as a duplicate
    // would lose real prospects.
    const result = scoreMatch({ firstName: 'Asha', lastName: 'Patel' }, existing);
    assert.notEqual(result.confidence, 'DEFINITE');
    assert.notEqual(result.confidence, 'PROBABLE');
  });

  it('does not match two unrelated people', () => {
    const result = scoreMatch(
      { firstName: 'Vikram', lastName: 'Joshi', mobile: '9111111111', city: 'Surat' },
      existing,
    );
    assert.equal(result.confidence, 'NONE');
  });

  it('tolerates a mis-keyed surname', () => {
    assert.ok(nameSimilarity('asha patel', 'asha pateel') >= 0.85);
  });

  it('returns matches best first and drops the irrelevant', () => {
    const candidates: MatchCandidate[] = [
      existing,
      { id: 'lead-2', firstName: 'Unrelated', lastName: 'Person', mobile: '9000000000' },
    ];
    const matches = findMatches({ firstName: 'Asha', mobile: '9876543210' }, candidates);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.candidate.id, 'lead-1');
  });

  it('maps scores to bands consistently', () => {
    assert.equal(confidenceFor(100), 'DEFINITE');
    assert.equal(confidenceFor(70), 'PROBABLE');
    assert.equal(confidenceFor(40), 'POSSIBLE');
    assert.equal(confidenceFor(10), 'NONE');
  });
});

describe('import row decisions', () => {
  it('skips a definite match rather than merging it', () => {
    // Approved policy: the incumbent owner keeps the lead. Auto-merging would
    // silently transfer a colleague's lead to whoever imported last.
    const match = scoreMatch({ firstName: 'A', mobile: '9876543210' }, existing);
    assert.equal(suggestDecision(match), 'SKIP');
  });

  it('sends a probable match to review', () => {
    const match = scoreMatch(
      { firstName: 'Asha', lastName: 'Patel', city: 'Ahmedabad', mobile: '9812343210' },
      existing,
    );
    assert.equal(suggestDecision(match), 'REVIEW');
  });

  it('creates when there is no match at all', () => {
    assert.equal(suggestDecision(undefined), 'CREATE');
  });
});

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

describe('delimited parsing', () => {
  it('parses a simple CSV', () => {
    const rows = parseDelimited('name,mobile\nAsha,9876543210\n');
    assert.deepEqual(rows, [
      ['name', 'mobile'],
      ['Asha', '9876543210'],
    ]);
  });

  it('honours quoted fields containing the delimiter', () => {
    const rows = parseDelimited('name,city\n"Shah, Asha",Ahmedabad\n');
    assert.deepEqual(rows[1], ['Shah, Asha', 'Ahmedabad']);
  });

  it('honours escaped quotes', () => {
    const rows = parseDelimited('note\n"He said ""yes"" today"\n');
    assert.equal(rows[1]?.[0], 'He said "yes" today');
  });

  it('honours newlines inside a quoted field', () => {
    const rows = parseDelimited('name,address\nAsha,"12 Main St\nAhmedabad"\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.[1], '12 Main St\nAhmedabad');
  });

  it('handles CRLF and a trailing row without a newline', () => {
    const rows = parseDelimited('a,b\r\n1,2\r\n3,4');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[2], ['3', '4']);
  });

  it('strips the Excel byte-order mark', () => {
    const rows = parseDelimited('﻿name,mobile\nAsha,9876543210');
    assert.equal(rows[0]?.[0], 'name', 'the BOM must not become part of the first header');
  });

  it('drops blank lines', () => {
    const rows = parseDelimited('a,b\n\n1,2\n\n');
    assert.equal(rows.length, 2);
  });

  it('detects tab and semicolon files', () => {
    assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
    assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
    assert.equal(detectDelimiter('single-column'), ',');
  });
});

describe('column auto-mapping', () => {
  it('maps common header spellings', () => {
    const mapping = suggestMapping(['First Name', 'Last Name', 'Mobile No', 'Email ID', 'City']);
    assert.deepEqual(mapping, ['firstName', 'lastName', 'mobile', 'email', 'city']);
  });

  it('handles underscores and mixed case', () => {
    const mapping = suggestMapping(['FIRST_NAME', 'mobile_number']);
    assert.deepEqual(mapping, ['firstName', 'mobile']);
  });

  it('never assigns one field to two columns', () => {
    const mapping = suggestMapping(['Name', 'Full Name', 'Client Name']);
    const assigned = mapping.filter(Boolean);
    assert.equal(new Set(assigned).size, assigned.length);
  });

  it('returns null rather than guessing at an unknown header', () => {
    const mapping = suggestMapping(['Zodiac Sign', 'Mobile']);
    assert.equal(mapping[0], null);
    assert.equal(mapping[1], 'mobile');
  });
});

describe('value coercion', () => {
  it('reads product interest written however people write it', () => {
    assert.deepEqual(parseProductInterest('Equity, F&O').sort(), ['DERIVATIVES', 'EQUITY']);
    assert.deepEqual(parseProductInterest('mutual funds/ipo').sort(), ['IPO', 'MUTUAL_FUNDS']);
    assert.deepEqual(parseProductInterest(''), []);
  });

  it('drops products it does not recognise instead of guessing', () => {
    assert.deepEqual(parseProductInterest('Equity, Crypto'), ['EQUITY']);
  });

  it('reads Indian money notation', () => {
    assert.equal(parseImportedAmount('₹12,50,000'), 1250000);
    assert.equal(parseImportedAmount('12.5 lakh'), 1250000);
    assert.equal(parseImportedAmount('2cr'), 20000000);
    assert.equal(parseImportedAmount('1500000'), 1500000);
    assert.equal(parseImportedAmount('not a number'), null);
    assert.equal(parseImportedAmount(''), null);
  });

  it('splits a single name column', () => {
    assert.deepEqual(splitFullName('Asha Patel'), { firstName: 'Asha', lastName: 'Patel' });
    assert.deepEqual(splitFullName('Asha Kumari Patel'), {
      firstName: 'Asha',
      lastName: 'Kumari Patel',
    });
    assert.deepEqual(splitFullName('Asha'), { firstName: 'Asha', lastName: null });
  });

  it('handles the surname-first convention used by CRM exports', () => {
    // Without this the comma survives into the first name and every greeting
    // downstream reads "Dear Shah,".
    assert.deepEqual(splitFullName('Shah, Nirav'), { firstName: 'Nirav', lastName: 'Shah' });
    assert.deepEqual(splitFullName('Patel, Asha Kumari'), {
      firstName: 'Asha Kumari',
      lastName: 'Patel',
    });
  });

  it('never leaves a stray comma in a name', () => {
    assert.equal(splitFullName('Shah, Nirav').firstName.includes(','), false);
    assert.equal(splitFullName('Nirav Shah,').lastName?.includes(','), false);
  });
});

describe('import provenance', () => {
  const valid = {
    origin: 'PERSONAL_NETWORK' as const,
    suppliedBy: 'Rahul Mehta',
    description: 'Contacts built up over eight years in the Ahmedabad market.',
    lawfulBasisConfirmed: true as const,
  };

  it('accepts a complete declaration', () => {
    assert.ok(importDeclarationSchema.safeParse(valid).success);
  });

  it('refuses an import without the lawful-basis confirmation', () => {
    // DPDP: SIHL becomes the Data Fiduciary on ingest. The confirmation is the
    // documented basis, so it cannot be optional.
    const result = importDeclarationSchema.safeParse({ ...valid, lawfulBasisConfirmed: false });
    assert.equal(result.success, false);
  });

  it('refuses a one-word description of the source', () => {
    assert.equal(
      importDeclarationSchema.safeParse({ ...valid, description: 'leads' }).success,
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

const rule = (overrides: Partial<MatchableRule> = {}): MatchableRule => ({
  id: 'rule-1',
  name: 'Default',
  priority: 100,
  isActive: true,
  criteria: {},
  strategy: 'ROUND_ROBIN',
  targetUserIds: ['user-a', 'user-b', 'user-c'],
  ...overrides,
});

describe('assignment rule matching', () => {
  const lead = {
    source: 'IMPORT',
    productInterest: ['EQUITY', 'DERIVATIVES'],
    city: 'Ahmedabad',
    state: 'Gujarat',
    score: 55,
  };

  it('matches everything when no criteria are set', () => {
    assert.equal(ruleMatches(rule(), lead), true);
  });

  it('never matches an inactive rule', () => {
    assert.equal(ruleMatches(rule({ isActive: false }), lead), false);
  });

  it('matches on source', () => {
    assert.equal(ruleMatches(rule({ criteria: { sources: ['IMPORT'] } }), lead), true);
    assert.equal(ruleMatches(rule({ criteria: { sources: ['WEBSITE'] } }), lead), false);
  });

  it('matches if any product overlaps', () => {
    assert.equal(ruleMatches(rule({ criteria: { products: ['DERIVATIVES'] } }), lead), true);
    assert.equal(ruleMatches(rule({ criteria: { products: ['NRI'] } }), lead), false);
  });

  it('ignores case and spacing on city', () => {
    assert.equal(ruleMatches(rule({ criteria: { cities: ['  ahmedabad '] } }), lead), true);
  });

  it('matches on a minimum score', () => {
    assert.equal(ruleMatches(rule({ criteria: { minScore: 50 } }), lead), true);
    assert.equal(ruleMatches(rule({ criteria: { minScore: 80 } }), lead), false);
  });

  it('ANDs multiple criteria', () => {
    const strict = rule({ criteria: { sources: ['IMPORT'], cities: ['Surat'] } });
    assert.equal(ruleMatches(strict, lead), false);
  });

  it('picks the lowest-priority matching rule', () => {
    const rules = [
      rule({ id: 'catch-all', name: 'Catch all', priority: 900 }),
      rule({ id: 'specific', name: 'Gujarat', priority: 10, criteria: { states: ['Gujarat'] } }),
    ];
    assert.equal(selectRule(rules, lead)?.id, 'specific');
  });

  it('returns null when nothing matches', () => {
    const rules = [rule({ criteria: { cities: ['Chennai'] } })];
    assert.equal(selectRule(rules, lead), null);
  });
});

describe('owner selection', () => {
  it('rotates evenly on round robin', () => {
    const chosen = [0, 1, 2, 3, 4, 5].map((cursor) => selectOwner(rule(), [], cursor));
    assert.deepEqual(chosen, ['user-a', 'user-b', 'user-c', 'user-a', 'user-b', 'user-c']);
  });

  it('gives the lead to whoever has the fewest open leads', () => {
    const chosen = selectOwner(
      rule({ strategy: 'LOAD_BALANCED' }),
      [
        { userId: 'user-a', openLeads: 40 },
        { userId: 'user-b', openLeads: 12 },
        { userId: 'user-c', openLeads: 31 },
      ],
      0,
    );
    assert.equal(chosen, 'user-b');
  });

  it('treats someone with no workload row as empty', () => {
    const chosen = selectOwner(
      rule({ strategy: 'LOAD_BALANCED' }),
      [
        { userId: 'user-a', openLeads: 5 },
        { userId: 'user-b', openLeads: 5 },
      ],
      0,
    );
    assert.equal(chosen, 'user-c', 'a user with no open leads is the emptiest');
  });

  it('always returns the named person for a fixed-owner rule', () => {
    const fixed = rule({ strategy: 'FIXED_OWNER', targetUserIds: ['user-z'] });
    assert.equal(selectOwner(fixed, [], 7), 'user-z');
  });

  it('returns null for leave-unassigned', () => {
    assert.equal(selectOwner(rule({ strategy: 'LEAVE_UNASSIGNED' }), [], 0), null);
  });

  it('returns null rather than throwing when a rule has no targets', () => {
    assert.equal(selectOwner(rule({ targetUserIds: [] }), [], 0), null);
  });
});

describe('assignment rule validation', () => {
  const base = { name: 'Gujarat equity', strategy: 'ROUND_ROBIN' as const };

  it('requires targets for a rule that assigns', () => {
    assert.equal(
      createAssignmentRuleSchema.safeParse({ ...base, targetUserIds: [] }).success,
      false,
    );
  });

  it('allows no targets when leaving unassigned', () => {
    assert.ok(
      createAssignmentRuleSchema.safeParse({
        name: 'Manual queue',
        strategy: 'LEAVE_UNASSIGNED',
        targetUserIds: [],
      }).success,
    );
  });

  it('requires exactly one target for a fixed-owner rule', () => {
    assert.equal(
      createAssignmentRuleSchema.safeParse({
        name: 'VIP',
        strategy: 'FIXED_OWNER',
        targetUserIds: ['user-a', 'user-b'],
      }).success,
      false,
    );
  });
});

describe('offboarding validation', () => {
  it('requires a reason', () => {
    assert.equal(
      offboardUserSchema.safeParse({ strategy: 'UNASSIGN', reason: '' }).success,
      false,
    );
  });

  it('requires a recipient when handing to one person', () => {
    assert.equal(
      offboardUserSchema.safeParse({
        strategy: 'SINGLE_OWNER',
        targetUserIds: [],
        reason: 'Resigned',
      }).success,
      false,
    );
  });

  it('refuses more than one recipient for a single-owner handover', () => {
    assert.equal(
      offboardUserSchema.safeParse({
        strategy: 'SINGLE_OWNER',
        targetUserIds: ['user-aaaaaaaa', 'user-bbbbbbbb'],
        reason: 'Resigned',
      }).success,
      false,
    );
  });

  it('accepts a rules-engine handover with no explicit recipients', () => {
    assert.ok(
      offboardUserSchema.safeParse({
        strategy: 'RULES_ENGINE',
        targetUserIds: [],
        reason: 'Resigned, redistributing by territory',
      }).success,
    );
  });
});
