// Swarm simulator integration seam. The swarm sim itself is owned by a
// teammate — this file only exposes the field data and the mount point.

function initSwarmMount(data) {
  window.FieldLoop = {
    field: data,
    // Swarm sim calls this after it mutates zone state (e.g. marks zones
    // treated). Refreshes whatever data-driven views exist on this page.
    onZonesUpdated: function (zones) {
      if (Array.isArray(zones)) data.zones = zones;
      try {
        if (typeof initFieldMap === 'function') initFieldMap(data);
      } catch (err) { console.error('[FieldLoop] map refresh failed:', err); }
      try {
        if (typeof initBreakdown === 'function') initBreakdown(data);
      } catch (err) { console.error('[FieldLoop] breakdown refresh failed:', err); }
    }
  };

  const mount = document.getElementById('swarm-mount');
  if (!mount) return;
  mount.innerHTML = '';
  if (typeof window.initSwarm === 'function') {
    window.initSwarm(mount, data);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'swarm-placeholder';
    placeholder.textContent = 'Swarm simulator — pending integration';
    mount.appendChild(placeholder);
  }
}
