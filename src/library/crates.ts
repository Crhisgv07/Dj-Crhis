/** Crates (listas) de la biblioteca. Persisten en localStorage. */

export type Crate = { id: string; name: string; paths: string[] };

const KEY = "crhis.crates.v1";

export function loadCrates(): Crate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Crate[];
    return parsed
      .filter((c) => c && typeof c.id === "string")
      .map((c) => ({ id: c.id, name: c.name || "Crate", paths: Array.isArray(c.paths) ? c.paths : [] }));
  } catch {
    return [];
  }
}

export function saveCrates(crates: Crate[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(crates));
  } catch {
    /* cuota */
  }
}

export function newCrate(name: string): Crate {
  return { id: `crate_${Date.now().toString(36)}`, name, paths: [] };
}

export function addToCrate(crates: Crate[], crateId: string, path: string): Crate[] {
  return crates.map((c) =>
    c.id === crateId && !c.paths.includes(path) ? { ...c, paths: [...c.paths, path] } : c,
  );
}

export function removeFromCrate(crates: Crate[], crateId: string, path: string): Crate[] {
  return crates.map((c) =>
    c.id === crateId ? { ...c, paths: c.paths.filter((p) => p !== path) } : c,
  );
}
