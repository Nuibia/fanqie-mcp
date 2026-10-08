import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  installedSourceInventory,
  installedSourceRegistrationHash,
  SourceIntegrityError,
} from '../src/runtime/source-integrity.js';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'source-integrity-'));
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'test'));
  writeFileSync(path.join(root, 'src/index.ts'), "export { value } from './child.js';\n");
  writeFileSync(path.join(root, 'src/child.ts'), 'export const value = 1;\n');
  writeFileSync(
    path.join(root, 'test/index.test.ts'),
    'export type Scene = typeof import("./scene.test.js");\n',
  );
  writeFileSync(path.join(root, 'test/scene.test.ts'), 'export {};\n');
  return {
    root,
    hash: () => installedSourceRegistrationHash('src/index.ts', installedSourceInventory(root)),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('source integrity changes for delegated code while facade bytes stay untouched', () => {
  const f = fixture();
  try {
    const before = f.hash();
    writeFileSync(path.join(f.root, 'src/child.ts'), 'export const value = 2;\n');
    assert.notEqual(f.hash(), before);
    assert.equal(f.hash(), f.hash());
  } finally {
    f.close();
  }
});

test('source integrity includes test scenes, additions and removed modules', () => {
  const f = fixture();
  try {
    const before = f.hash();
    writeFileSync(path.join(f.root, 'test/scene.test.ts'), 'export const scene = 1;\n');
    const changed = f.hash();
    assert.notEqual(changed, before);
    writeFileSync(path.join(f.root, 'src/new.ts'), 'export {};\n');
    assert.notEqual(f.hash(), changed);
    rmSync(path.join(f.root, 'src/new.ts'));
    assert.equal(f.hash(), changed);
    const inventory = installedSourceInventory(f.root);
    assert.throws(
      () => installedSourceRegistrationHash('src/missing.ts', inventory),
      SourceIntegrityError,
    );
  } finally {
    f.close();
  }
});

test('source integrity observes each directory and physical file for final read validation', () => {
  const f = fixture();
  try {
    const marks: {
      directory?: string;
      file?: string;
      bytesHash?: string;
      ino?: number;
      nlink?: number;
      size?: number;
    }[] = [];
    installedSourceInventory(f.root, (value) => marks.push(value as (typeof marks)[number]));
    assert.equal(marks.filter((value) => value.directory).length, 2);
    assert.equal(marks.filter((value) => value.bytesHash).length, 4);
    assert(
      marks
        .filter((value) => value.file && value.ino)
        .every((value) => value.nlink === 1 && value.size! > 0),
    );
    writeFileSync(path.join(f.root, 'test/data.json'), '{"fixture":true}');
    assert.equal(installedSourceInventory(f.root).paths.length, 4);
  } finally {
    f.close();
  }
});

for (const kind of ['symlink', 'hardlink', 'directory-link'] as const) {
  test(`source integrity refuses ${kind} without following outside content`, () => {
    const f = fixture();
    try {
      const target = path.join(f.root, 'src/child.ts');
      if (kind === 'symlink') symlinkSync(target, path.join(f.root, 'src/alias.ts'));
      if (kind === 'hardlink') linkSync(target, path.join(f.root, 'src/alias.ts'));
      if (kind === 'directory-link')
        symlinkSync(path.join(f.root, 'test'), path.join(f.root, 'src/linked'));
      assert.throws(() => installedSourceInventory(f.root), SourceIntegrityError);
    } finally {
      f.close();
    }
  });
}
