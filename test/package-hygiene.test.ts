import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'vitest';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');

test('package metadata, documentation, and release contents use GPL-3.0-only', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf8'),
  ) as {
    files: string[];
    license: string;
  };
  const license = readFileSync(resolve(PROJECT_ROOT, 'LICENSE'), 'utf8');
  const readme = readFileSync(resolve(PROJECT_ROOT, 'README.md'), 'utf8');
  const gitignore = readFileSync(resolve(PROJECT_ROOT, '.gitignore'), 'utf8');

  assert.equal(packageJson.license, 'GPL-3.0-only');
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  assert.match(readme, /GNU General Public License v3\.0/);
  assert.deepEqual(packageJson.files, [
    'dist',
    'plugin/build',
    'app.plugin.js',
    'README.md',
    'MIGRATION.md',
    'LICENSE',
  ]);
  assert.match(gitignore, /^\*\.tgz$/m);
});
