'use strict';

// Runs supabase/schema.sql (plus supabase/migrations/*.sql) against a real PostgreSQL (15+) and checks the
// sharing/security rules. Skipped unless CHORKLIST_TEST_PG is set to a
// connection string for a server where this user can create databases, e.g.
//   CHORKLIST_TEST_PG=postgres://postgres@localhost:5432/postgres npm test
const test = require('node:test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = process.env.CHORKLIST_TEST_PG;
const dir = path.join(__dirname, '..', 'supabase');

test('database schema: sharing, rotation, undo and security rules', { skip: !base && 'set CHORKLIST_TEST_PG to run' }, () => {
  const dbName = `chorklist_test_${process.pid}`;
  const psql = (url, args) => execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: 'pipe' }).toString();
  const testUrl = new URL(base);
  testUrl.pathname = `/${dbName}`;
  psql(base, ['-c', `create database ${dbName}`]);
  try {
    psql(testUrl.toString(), ['-f', path.join(dir, 'tests', 'stub-supabase.sql')]);
    psql(testUrl.toString(), ['-f', path.join(dir, 'schema.sql')]);
    const migrations = fs.readdirSync(path.join(dir, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    for (const file of migrations) psql(testUrl.toString(), ['-f', path.join(dir, 'migrations', file)]);
    const out = psql(testUrl.toString(), ['-f', path.join(dir, 'tests', 'schema-test.sql')]);
    if (!out.includes('ALL SCHEMA TESTS PASSED')) throw new Error(out);
  } finally {
    psql(base, ['-c', `drop database if exists ${dbName}`]);
  }
});
