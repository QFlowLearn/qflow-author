import { expect, test as testCase } from 'vitest';
import * as _fs from 'node:fs/promises';
import * as _path from 'node:path';
import * as _os from 'node:os';
import inventory from '../tools/ci_browser_inventory.json' with { type: 'json' };
import {
  allBrowserSuites,
  partitionBrowserSuites,
  selectBrowserShard,
} from '../tools/ci_browser_partition.ts';

testCase(
  'four browser shards preserve the complete inventory exactly once and remain balanced',
  () => {
    const shards = partitionBrowserSuites();
    expect(shards).toHaveLength(4);
    expect(shards.flat().map((suite) => suite.file).sort()).toEqual(
      inventory.map((suite) => suite.file).sort(),
    );
    expect(allBrowserSuites()).toHaveLength(inventory.length);
    const seconds = shards.map((shard) =>
      shard.reduce((total, suite) => total + suite.baselineSeconds, 0)
    );
    expect(Math.max(...seconds) - Math.min(...seconds)).toBeLessThan(15);
    for (let i = 0; i < 4; i++) expect(selectBrowserShard(String(i))).toEqual(shards[i]);
  },
);

testCase(
  'browser partition rejects duplicate/invalid suites, empty shards and invalid indices',
  () => {
    expect(() => partitionBrowserSuites([...inventory, inventory[0]])).toThrow();
    expect(() => partitionBrowserSuites(inventory.slice(0, 3))).toThrow();
    expect(() =>
      partitionBrowserSuites([{ file: '../private.ts', baselineSeconds: 1 }, ...inventory])
    ).toThrow();
    expect(() =>
      partitionBrowserSuites([{ file: 'tests/bad.ts', baselineSeconds: 0 }, ...inventory])
    ).toThrow();
    for (const raw of ['', '-1', '4', '1.0', '01', ' 1', 'NaN']) {
      expect(() => selectBrowserShard(raw)).toThrow();
    }
  },
);

testCase(
  'inventory discovery rejects newly omitted suites and missing suite files',
  async () => {
    const { checkBrowserInventory } = await import('../tools/ci_browser_partition.ts');
    const directory = await _fs.mkdtemp(_path.join(_os.tmpdir(), 'qflow-inventory-test-'));
    try {
      await _fs.mkdir(_path.join(directory, 'tests'));
      const source = "import {it} from 'vitest'; it('fixture',()=>{});";
      for (const { file } of inventory) {
        await _fs.mkdir(_path.dirname(_path.join(directory, file)), { recursive: true });
        await _fs.writeFile(_path.join(directory, file), source);
      }
      await checkBrowserInventory(directory);
      await _fs.writeFile(_path.join(directory, 'tests/new_browser_test.ts'), source);
      await expect(checkBrowserInventory(directory)).rejects.toThrow('omitted from CI inventory');
      await _fs.rm(_path.join(directory, 'tests/new_browser_test.ts'));
      await _fs.rm(_path.join(directory, inventory[0].file));
      await expect(checkBrowserInventory(directory)).rejects.toThrow('no matching suite file');
    } finally {
      await _fs.rm(directory, { recursive: true });
    }
  },
);
