// Short, stable, human-and-token-friendly IDs (PRD §7): v1, c3, a7, t2...
// A monotonic counter per prefix keeps them deterministic within a session.
const counters: Record<string, number> = {};

export function nextId(prefix: string): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}${counters[prefix]}`;
}

/** Seed counters from an existing project so re-loads don't collide. */
export function seedCounters(ids: string[]): void {
  for (const id of ids) {
    const m = id.match(/^([a-z]+)(\d+)$/);
    if (!m) continue;
    const [, prefix, num] = m;
    counters[prefix] = Math.max(counters[prefix] ?? 0, Number(num));
  }
}
