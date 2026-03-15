import * as path from 'path';
import * as fs from 'fs';

export interface TheoYamlApp {
  path: string;
  framework: string;
  type?: string;
  port: number | null;
  secrets?: string[];
}

export interface TheoYaml {
  project: string;
  apps: Record<string, TheoYamlApp>;
}

export interface TheoYamlResult {
  path: string;
  content: TheoYaml;
  parseError?: string;
}

/**
 * Simple theo.yaml parser (avoids adding a YAML dependency for now).
 */
export function parseTheoYaml(raw: string): TheoYaml {
  const lines = raw.split('\n');
  let project = '';
  const apps: Record<string, TheoYamlApp> = {};
  let currentApp = '';
  let inApps = false;
  let inSecrets = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('project:') || trimmed.startsWith('name:')) {
      const key = trimmed.startsWith('project:') ? 'project:' : 'name:';
      project = trimmed.slice(key.length).trim().replace(/^["']|["']$/g, '');
    } else if (trimmed === 'apps:') {
      inApps = true;
    } else if (inApps && /^  \S/.test(line) && !line.startsWith('    ')) {
      currentApp = trimmed.replace(':', '').trim().replace(/^["']|["']$/g, '');
      apps[currentApp] = { path: '.', framework: 'unknown', port: null };
      inSecrets = false;
    } else if (inApps && currentApp && /^    \S/.test(line)) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim().replace(/^["']|["']$/g, '');
      const k = key.trim();
      if (k === 'secrets') {
        inSecrets = true;
        apps[currentApp].secrets = [];
      } else {
        inSecrets = false;
        if (k === 'path') apps[currentApp].path = value;
        else if (k === 'framework') apps[currentApp].framework = value;
        else if (k === 'type') apps[currentApp].type = value;
        else if (k === 'port') apps[currentApp].port = parseInt(value, 10) || null;
      }
    } else if (inSecrets && currentApp && /^      - /.test(line)) {
      const secretName = trimmed.trim().replace(/^- /, '').trim();
      if (!apps[currentApp].secrets) apps[currentApp].secrets = [];
      apps[currentApp].secrets!.push(secretName);
    } else if (inSecrets && !/^      /.test(line)) {
      inSecrets = false;
    }
  }

  // Validate: if the file had content but we parsed nothing useful, it's likely malformed
  if (raw.trim().length > 0 && !project && Object.keys(apps).length === 0) {
    throw new Error('could not parse theo.yaml — check YAML syntax');
  }

  return { project, apps };
}

/**
 * Walk up from cwd to gitRoot looking for theo.yaml, parse it, and return the result.
 */
export function findTheoYaml(cwd: string, gitRoot: string): TheoYamlResult | null {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, 'theo.yaml');
    if (fs.existsSync(candidate)) {
      const raw = fs.readFileSync(candidate, 'utf-8');
      try {
        const content = parseTheoYaml(raw);
        return { path: candidate, content };
      } catch (e) {
        return { path: candidate, content: { project: '', apps: {} }, parseError: (e as Error).message };
      }
    }
    if (dir === gitRoot || dir === path.dirname(dir)) {
      return null;
    }
    dir = path.dirname(dir);
  }
}
