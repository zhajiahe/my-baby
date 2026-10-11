// Structural probe for unverified channel payloads.
//
// WeChat media references (CDN location plus AES key) exist only inside the
// getupdates response, so the event flow cannot be wired before the payload
// layout is known: without it we would either drop the photo or persist a whole
// unvalidated item. This module records only protocol field paths and value
// types, never values, so the layout can be learned without storing content.
//
// Safety properties, all covered by tests:
//   - no value ever appears in the output, only identifiers and type names
//   - a key that is not identifier-shaped becomes a placeholder, so a value can
//     never be smuggled out through a key position
//   - depth, path count and per-array item count are bounded
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const PROBE_MARKER = '<non-identifier-key>';

export interface ProbeLimits { maxDepth?: number; maxPaths?: number; maxItems?: number }

export function describeStructure(value: unknown, limits: ProbeLimits = {}): string[] {
  const maxDepth = limits.maxDepth ?? 4, maxPaths = limits.maxPaths ?? 60, maxItems = limits.maxItems ?? 2;
  const paths: string[] = [];
  const typeOf = (node: unknown) => node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node;
  const walk = (node: unknown, prefix: string, depth: number): void => {
    if (depth > maxDepth || paths.length >= maxPaths || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      paths.push(`${prefix}[${node.length > maxItems ? 'many' : node.length}]`);
      for (const entry of node.slice(0, maxItems)) walk(entry, `${prefix}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (paths.length >= maxPaths) return;
      const path = prefix ? `${prefix}.${IDENTIFIER.test(key) ? key : PROBE_MARKER}` : IDENTIFIER.test(key) ? key : PROBE_MARKER;
      const type = typeOf(child);
      // Strings are reduced to a populated/empty flag: a length or prefix could
      // still carry information about family data.
      paths.push(`${path}:${type === 'string' ? (child === '' ? 'string(empty)' : 'string') : type}`);
      if (type === 'object' || type === 'array') walk(child, path, depth + 1);
    }
  };
  walk(value, '', 0);
  return paths;
}

export interface StructureSample { kind: 'image' | 'voice'; paths: string[] }

// Bounded and de-duplicated: re-sending the same shape does not consume a slot,
// and the stored sample count never grows past `max`.
export function recordStructure(existing: StructureSample[] | undefined, kind: 'image' | 'voice',
  item: unknown, max = 3): StructureSample[] {
  const samples = Array.isArray(existing) ? existing.slice(0, max) : [];
  if (samples.length >= max) return samples;
  const paths = describeStructure(item);
  if (!paths.length) return samples;
  const signature = JSON.stringify(paths);
  if (samples.some(sample => JSON.stringify(sample.paths) === signature)) return samples;
  samples.push({ kind, paths });
  return samples;
}
