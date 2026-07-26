// Decorative 3D field preview for drones.html. Renders a low-poly field
// plane, fleet-origin markers, and pulsing zone markers colored by treatment.
// Purely atmospheric — NO flight paths and NO routing; the swarm simulator
// (js/swarm.js / js/swarm-mount.js, teammate-owned) owns all of that.
// Loaded as a classic script; three.js is pulled in via dynamic import of the
// locally vendored ES module (vendor/three.module.js). Fully offline.

// Same fallback chain as js/drones.js: sessionStorage plan -> FIELD -> STUB.
function getFieldData() {
  let data = (typeof FIELD !== 'undefined') ? FIELD : STUB;
  try {
    const savedPlan = sessionStorage.getItem('fieldloop_plan');
    if (savedPlan) data = JSON.parse(savedPlan);
  } catch (_e) { /* keep FIELD/STUB */ }
  return data;
}

async function initField3D(data) {
  const wrap = document.getElementById('drone-3d-wrap');
  try {
    if (!wrap) return;

    const THREE = await import('./vendor/three.module.js');

    // ---- Sizing -----------------------------------------------------------
    const width = () => Math.max(wrap.clientWidth, 40);
    const height = () => Math.max(wrap.clientHeight, 240);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width(), height());
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1419);
    scene.fog = new THREE.FogExp2(0x0f1419, 0.055);

    const camera = new THREE.PerspectiveCamera(42, width() / height(), 0.1, 200);

    // ---- Field plane (low-poly, gently displaced) -------------------------
    // World footprint follows the image aspect (image_size = [w, h]).
    const imgW = (data.meta && data.meta.image_size && data.meta.image_size[0]) || 1200;
    const imgH = (data.meta && data.meta.image_size && data.meta.image_size[1]) || 800;
    const FIELD_W = 13;
    const FIELD_D = FIELD_W * (imgH / imgW);

    // Map data-space (x, y in 0..1, origin top-left) to world XZ.
    const toWorld = (fx, fy) => ({
      x: (fx - 0.5) * FIELD_W,
      z: (fy - 0.5) * FIELD_D
    });

    const segX = 46, segY = Math.round(46 * (FIELD_D / FIELD_W));
    const groundGeo = new THREE.PlaneGeometry(FIELD_W * 1.35, FIELD_D * 1.55, segX, segY);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const gx = pos.getX(i), gy = pos.getY(i);
      // Deterministic pseudo-noise: gentle rolling terrain, flatter mid-field.
      const h =
        Math.sin(gx * 0.9) * Math.cos(gy * 1.1) * 0.10 +
        Math.sin(gx * 2.3 + 1.7) * Math.sin(gy * 2.1 + 0.4) * 0.06 +
        Math.sin(gx * 5.1 + gy * 4.3) * 0.025;
      const edge = Math.min(1, (Math.abs(gx) / (FIELD_W * 0.5)) + (Math.abs(gy) / (FIELD_D * 0.5)));
      pos.setZ(i, h * (0.5 + edge * 0.9));
    }
    groundGeo.computeVertexNormals();

    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({
        color: 0x18231f,       // dark desaturated green-gray, close to panel tones
        roughness: 0.95,
        metalness: 0.0,
        flatShading: true
      })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Faint wireframe overlay for the survey-grid feel.
    const grid = new THREE.LineSegments(
      new THREE.WireframeGeometry(groundGeo),
      new THREE.LineBasicMaterial({ color: 0x2a3441, transparent: true, opacity: 0.16 })
    );
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.012;
    scene.add(grid);

    // ---- Lighting (moody, neutral; accent green only as a faint rim) ------
    scene.add(new THREE.HemisphereLight(0x35404d, 0x0f1419, 0.85));
    const key = new THREE.DirectionalLight(0x8b98a5, 0.55);
    key.position.set(6, 9, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4ade80, 0.10); // sparse accent, per palette rules
    rim.position.set(-8, 3, -7);
    scene.add(rim);

    // ---- Zone markers -----------------------------------------------------
    const pulsers = [];   // { mesh, base, speed, phase, mat, baseOpacity }
    const ringGroup = new THREE.Group();
    scene.add(ringGroup);

    (data.zones || []).forEach((zone, idx) => {
      const t = (data.treatments && data.treatments[zone.treatment_id]) || { color: '#8B98A5' };
      const color = new THREE.Color(t.color);
      const p = toWorld(zone.x, zone.y);
      const sev = Math.max(0.15, Math.min(1, zone.severity || 0.5));

      if (zone.treatment_id === 'none') {
        // "Do not spray" — dashed ring, no fill, matching the dashboard's
        // dashed-outline visual language.
        const r = 0.35 + sev * 0.55;
        const pts = [];
        for (let a = 0; a <= 64; a++) {
          const th = (a / 64) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
        }
        const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const ringMat = new THREE.LineDashedMaterial({
          color, dashSize: 0.14, gapSize: 0.1, transparent: true, opacity: 0.85
        });
        const ring = new THREE.Line(ringGeo, ringMat);
        ring.computeLineDistances();
        ring.position.set(p.x, 0.16, p.z);
        ringGroup.add(ring);
        pulsers.push({ mesh: ring, base: 1, speed: 0.9, phase: idx * 1.3, mat: ringMat, baseOpacity: 0.8, ringOnly: true });
      } else {
        // Treated zone — soft emissive beacon sized by severity.
        const r = 0.16 + sev * 0.26;
        const h = 0.5 + sev * 1.1;
        const beaconMat = new THREE.MeshStandardMaterial({
          color: color.clone().multiplyScalar(0.35),
          emissive: color,
          emissiveIntensity: 0.85,
          transparent: true,
          opacity: 0.9,
          roughness: 0.6
        });
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, h, 6), beaconMat);
        beacon.position.set(p.x, h / 2 + 0.08, p.z);
        scene.add(beacon);

        // Ground halo disc.
        const haloMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false
        });
        const halo = new THREE.Mesh(new THREE.CircleGeometry(r * 3.1, 28), haloMat);
        halo.rotation.x = -Math.PI / 2;
        halo.position.set(p.x, 0.05, p.z);
        scene.add(halo);

        pulsers.push({ mesh: beacon, base: 1, speed: 1.4 + sev, phase: idx * 0.8, mat: beaconMat, baseOpacity: 0.9 });
        pulsers.push({ mesh: halo, base: 1, speed: 1.4 + sev, phase: idx * 0.8, mat: haloMat, baseOpacity: 0.14, haloScale: true });
      }
    });

    // ---- Fleet home markers (drone origins) -------------------------------
    (data.fleet || []).forEach((d, i) => {
      if (!d || !Array.isArray(d.home)) return;
      const p = toWorld(d.home[0], d.home[1]);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2a3441,
        emissive: 0xe6edf3,
        emissiveIntensity: 0.55,
        roughness: 0.4
      });
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), mat);
      marker.position.set(p.x, 0.55, p.z);
      scene.add(marker);

      const pad = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.3, 24),
        new THREE.MeshBasicMaterial({ color: 0x8b98a5, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(p.x, 0.045, p.z);
      scene.add(pad);

      pulsers.push({ mesh: marker, base: 1, speed: 1.1, phase: i * 2.1, mat, baseOpacity: 1, bob: 0.55 });
    });

    // ---- Ambient drifting particles ---------------------------------------
    const P_COUNT = 240;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(P_COUNT * 3);
    const pSeed = new Float32Array(P_COUNT);
    for (let i = 0; i < P_COUNT; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * FIELD_W * 1.3;
      pPos[i * 3 + 1] = 0.2 + Math.random() * 3.4;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * FIELD_D * 1.5;
      pSeed[i] = Math.random() * Math.PI * 2;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0x8b98a5, size: 0.035, transparent: true, opacity: 0.45,
      sizeAttenuation: true, depthWrite: false
    }));
    scene.add(particles);

    // ---- Slow orbiting camera (no user interaction) -----------------------
    const camRadius = Math.max(FIELD_W, FIELD_D) * 0.95;
    const lookAt = new THREE.Vector3(0, 0.4, 0);

    const clock = new THREE.Clock();
    function animate() {
      const tNow = clock.getElapsedTime();

      // Camera: slow orbit with a gentle vertical breathe.
      const a = tNow * 0.07;
      camera.position.set(
        Math.cos(a) * camRadius,
        4.6 + Math.sin(tNow * 0.18) * 0.5,
        Math.sin(a) * camRadius
      );
      camera.lookAt(lookAt);

      // Pulses.
      for (const pl of pulsers) {
        const s = 1 + Math.sin(tNow * pl.speed + pl.phase) * (pl.haloScale ? 0.22 : 0.07);
        pl.mesh.scale.setScalar(s);
        if (pl.mat && pl.mat.transparent) {
          pl.mat.opacity = pl.baseOpacity * (0.75 + 0.25 * Math.sin(tNow * pl.speed + pl.phase));
        }
        if (pl.mat && pl.mat.emissiveIntensity !== undefined && !pl.ringOnly) {
          pl.mat.emissiveIntensity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(tNow * pl.speed + pl.phase));
        }
        if (pl.bob) {
          pl.mesh.position.y = pl.bob + Math.sin(tNow * 1.3 + pl.phase) * 0.06;
          pl.mesh.rotation.y = tNow * 0.6 + pl.phase;
        }
      }

      // Particle drift: slow rise with wraparound + lateral sway.
      const arr = pGeo.attributes.position.array;
      for (let i = 0; i < P_COUNT; i++) {
        arr[i * 3 + 1] += 0.0022;
        if (arr[i * 3 + 1] > 3.8) arr[i * 3 + 1] = 0.15;
        arr[i * 3] += Math.sin(tNow * 0.4 + pSeed[i]) * 0.0012;
      }
      pGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);

    // ---- Resize -----------------------------------------------------------
    window.addEventListener('resize', () => {
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
      renderer.setSize(width(), height());
    });
  } catch (err) {
    console.warn('[FieldLoop] 3D field preview unavailable:', err);
    if (wrap) {
      wrap.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
        'min-height:inherit;color:#8B98A5;font-size:13px;border:1px dashed #2A3441;' +
        'border-radius:8px;">3D preview unavailable on this device</div>';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try { initField3D(getFieldData()); } catch (e) { console.warn(e); }
});
