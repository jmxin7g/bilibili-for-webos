export const playbackMappingLifetime = 30 * 60 * 1000;

export function createPlaybackMappings({ renewOnAccess = false, now = Date.now } = {}) {
  const mappings = new Map();
  return {
    set(id, value) {
      mappings.set(id, { value, expires: now() + playbackMappingLifetime });
    },
    get(id) {
      const mapping = mappings.get(id);
      if (!mapping) return;
      const time = now();
      if (mapping.expires <= time) {
        mappings.delete(id);
        return;
      }
      if (renewOnAccess) mapping.expires = time + playbackMappingLifetime;
      return mapping.value;
    },
    sweep() {
      const time = now();
      for (const [id, mapping] of mappings) {
        if (mapping.expires <= time) mappings.delete(id);
      }
    },
    clear() { mappings.clear(); },
  };
}
