import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DESCRIPTOR_FILE_NAMES, findLoopScaleYaml } from '../../../src/adapters/loopscale-yaml';

const descriptor = (project: string): string => `project: ${project}\napps:\n  web:\n    path: .\n`;

describe('descriptor lookup', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'descriptor-lookup-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('names loopscale.yaml first, then loopzero.yaml', () => {
    expect(DESCRIPTOR_FILE_NAMES).toEqual(['loopscale.yaml', 'loopzero.yaml']);
  });

  // The push deploy read loopzero.yaml and the CLI read only loopscale.yaml, so one project
  // needed two copies of the same file (getloopscale/loop-runtime#89).
  it.each(['loopscale.yaml', 'loopzero.yaml'])('reads %s', (name) => {
    fs.writeFileSync(path.join(root, name), descriptor('hello'));

    const result = findLoopScaleYaml(root, root);

    expect(result?.content.project).toBe('hello');
    expect(result?.fileName).toBe(name);
    expect(result?.path).toBe(path.join(root, name));
  });

  it('prefers loopscale.yaml over loopzero.yaml', () => {
    fs.writeFileSync(path.join(root, 'loopzero.yaml'), descriptor('from-loopzero'));
    expect(findLoopScaleYaml(root, root)?.content.project).toBe('from-loopzero');

    fs.writeFileSync(path.join(root, 'loopscale.yaml'), descriptor('from-loopscale'));
    expect(findLoopScaleYaml(root, root)?.content.project).toBe('from-loopscale');
  });
  it('takes any name in the nearest directory before the current name further up', () => {
    const nested = path.join(root, 'apps', 'web');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, 'loopscale.yaml'), descriptor('outer'));
    fs.writeFileSync(path.join(nested, 'loopscale.yaml'), descriptor('inner'));

    expect(findLoopScaleYaml(nested, root)?.content.project).toBe('inner');
  });

  it('reports a parse error together with the name of the file it read', () => {
    fs.writeFileSync(path.join(root, 'loopzero.yaml'), 'project: [unclosed');

    const result = findLoopScaleYaml(root, root);

    expect(result?.fileName).toBe('loopzero.yaml');
    expect(result?.parseError).toBeTruthy();
  });

  it('finds nothing in a directory that has none of the names', () => {
    expect(findLoopScaleYaml(root, root)).toBeNull();
  });
});
