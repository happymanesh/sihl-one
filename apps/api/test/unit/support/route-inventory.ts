import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every HTTP route in the application, read from the controller sources.
 *
 * Source parsing rather than booting Nest, deliberately. The question this
 * answers — "is there a route somewhere with no permission on it" — has to be
 * answerable without a database, or it will not be asked on every commit. It is
 * also the honest way round: the guard reads decorators, so decorators are what
 * should be inspected.
 *
 * A route's decorators may sit either side of its HTTP decorator — this
 * codebase writes `@Get()` first and `@RequirePermissions()` under it — so both
 * the block above and the block below are attributed to it.
 *
 * Being a parser, it can be wrong. It errs towards reporting a route as
 * unguarded, which fails loudly and is corrected in seconds; the opposite
 * mistake would be silent.
 */

export interface RouteEntry {
  /** `GET /leads/:id` — the verb and path as declared. */
  route: string;
  controller: string;
  file: string;
  handler: string;
  /** Permissions the route requires. Empty when it carries none. */
  permissions: string[];
  public: boolean;
  allowsServiceAccount: boolean;
  allowsPendingPassword: boolean;
  /** The `@Audited({...})` payload, or null when the route is not audited. */
  audit: string | null;
}

const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options'];
const IS_HTTP_DECORATOR = new RegExp(`^\\s*@(${HTTP_DECORATORS.join('|')})\\(`);
/** A decorator line, or the continuation of one that wrapped. */
const IS_DECORATOR_ISH = /^\s*[@)\]}]|^\s*$|^\s*(\/\/|\/\*|\*)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.controller.ts')) out.push(path);
  }
  return out;
}

/** The string literal inside `@Controller('x')`, or '' for `@Controller()`. */
function controllerPath(source: string): string {
  const match = /@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/.exec(source);
  if (!match) return '';
  return match[1] ?? match[2] ?? '';
}

function joinPath(base: string, sub: string): string {
  const parts = [base, sub].filter((part) => part.length > 0).join('/');
  return `/${parts.replace(/\/+/g, '/').replace(/^\/|\/$/g, '')}`;
}

function literals(argumentList: string): string[] {
  return [...argumentList.matchAll(/'([^']*)'|"([^"]*)"/g)].map(
    (match) => match[1] ?? match[2] ?? '',
  );
}

export function collectRoutes(srcDir: string): RouteEntry[] {
  const entries: RouteEntry[] = [];

  for (const file of walk(srcDir)) {
    const source = readFileSync(file, 'utf8');
    const base = controllerPath(source);
    const controller = /export class (\w+)/.exec(source)?.[1] ?? file;

    // Decorators on the class apply to every route inside it.
    const header = source.slice(0, Math.max(source.indexOf('export class'), 0));
    const classPublic = /@Public\(\)/.test(header);
    const classServiceAccount = /@AllowServiceAccount\(\)/.test(header);

    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!IS_HTTP_DECORATOR.test(lines[index])) continue;

      const sub = literals(lines[index])[0] ?? '';

      /*
        Forward: every decorator between this one and the handler signature.

        Block comments are walked through rather than treated as the end of the
        decorator list. A `/* … *​/` explaining *why* a route carries the
        permission it does is exactly the comment worth writing, and an earlier
        version of this parser stopped at its first prose line and reported the
        route as unguarded — a false alarm that teaches people to edit the
        allow-list rather than read it, which is the opposite of the point.
      */
      let cursor = index + 1;
      let inBlockComment = false;
      while (cursor < lines.length) {
        const line = lines[cursor]!;
        if (inBlockComment) {
          if (line.includes('*/')) inBlockComment = false;
          cursor += 1;
          continue;
        }
        if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
          inBlockComment = true;
          cursor += 1;
          continue;
        }
        if (!IS_DECORATOR_ISH.test(line)) break;
        cursor += 1;
      }
      const below = lines.slice(index + 1, cursor).join('\n');
      const handler = /^\s*(?:async\s+)?(\w+)\s*\(/.exec(lines[cursor] ?? '')?.[1] ?? '';

      // Backward: any decorators written above it, stopping at the previous
      // member — a closing brace or a blank line following real code.
      let top = index - 1;
      while (top >= 0 && /^\s*@/.test(lines[top])) top -= 1;
      const above = lines.slice(top + 1, index).join('\n');

      const block = `${above}\n${below}`;
      const permissionMatch = /@RequirePermissions\(([^)]*)\)/s.exec(block);
      const auditMatch = /@Audited\(\{([^}]*)\}\)/s.exec(block);

      entries.push({
        route: `${lines[index].trim().match(/@(\w+)\(/)?.[1].toUpperCase()} ${joinPath(base, sub)}`,
        controller,
        file: file.replace(/\\/g, '/').split('/src/')[1] ?? file,
        handler,
        permissions: permissionMatch ? literals(permissionMatch[1]).sort() : [],
        public: classPublic || /@Public\(\)/.test(block),
        allowsServiceAccount: classServiceAccount || /@AllowServiceAccount\(\)/.test(block),
        allowsPendingPassword: /@AllowPendingPasswordChange\(\)/.test(block),
        audit: auditMatch ? auditMatch[1].replace(/\s+/g, ' ').trim() : null,
      });
    }
  }

  return entries.sort(
    (a, b) => a.route.localeCompare(b.route) || a.controller.localeCompare(b.controller),
  );
}
