// Swarm simulator integration seam. The swarm sim itself is owned by a
// teammate — this file only exposes the field data and the mount point.

function initSwarmMount(data) {
  window.FieldLoop = {
    field: data,
    // Swarm sim calls this after it mutates zone state (e.g. marks zones
    // treated). Re-renders the data-driven panels; never throws.
    onZonesUpdated: function (zones) {
      if (Array.isArray(zones)) data.zones = zones;
      try { initFieldMap(data); } catch (err) { console.error('[FieldLoop] map refresh failed:', err); }
      try { initBreakdown(data); } catch (err) { console.error('[FieldLoop] breakdown refresh failed:', err); }
    }
  };

  const mount = document.getElementById('swarm-mount');
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
