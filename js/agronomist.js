// AI Agronomist panel.
//
// ============================================================================
// INTERFACE CONTRACT — teammate's vision API drops in HERE.
//
//   async function diagnose(imageFile) -> {
//     pest,                    // string, common + latin name
//     confidence,              // 0..1
//     recommended_biological,  // string, product/organism name
//     product_query,           // string, search query for procurement
//     rate_per_acre            // number, gal/acre
//   }
//
// TODO(vision): replace the mock body below with the real vision call.
// Keep the signature and return shape exactly as-is — procure.js and the
// render code consume this object.
// ============================================================================
async function diagnose(imageFile) {
  await new Promise((resolve) => setTimeout(resolve, 1200)); // simulated latency
  return {
    pest: 'Fall armyworm (Spodoptera frugiperda)',
    confidence: 0.87,
    recommended_biological: 'Bacillus thuringiensis var. kurstaki',
    product_query: 'Bacillus thuringiensis kurstaki biological insecticide concentrate',
    rate_per_acre: 1.0
  };
}

let agObjectUrl = null;

function initAgronomist() {
  const body = document.getElementById('agronomist-body');
  if (agObjectUrl) { URL.revokeObjectURL(agObjectUrl); agObjectUrl = null; }

  body.innerHTML =
    '<label class="file-btn">Choose leaf photo' +
      '<input type="file" id="ag-file" accept="image/*" hidden>' +
    '</label>' +
    '<div class="ag-stage">' +
      '<img id="ag-thumb" class="ag-thumb" alt="Leaf photo preview" hidden>' +
      '<button id="ag-analyze" class="btn" disabled>Analyze</button>' +
    '</div>' +
    '<div id="ag-result"></div>';

  const fileInput = document.getElementById('ag-file');
  const thumb = document.getElementById('ag-thumb');
  const analyzeBtn = document.getElementById('ag-analyze');
  const result = document.getElementById('ag-result');

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (agObjectUrl) URL.revokeObjectURL(agObjectUrl);
    agObjectUrl = URL.createObjectURL(file);
    thumb.src = agObjectUrl;
    thumb.hidden = false;
    analyzeBtn.disabled = false;
    result.innerHTML = '';
  });

  analyzeBtn.addEventListener('click', async () => {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing…';
    result.innerHTML = '';
    try {
      const dx = await diagnose(fileInput.files[0]);
      renderDiagnosis(result, dx);
      document.dispatchEvent(new CustomEvent('fieldloop:diagnosis', { detail: dx }));
    } catch (err) {
      console.error('[FieldLoop] diagnose failed:', err);
      result.innerHTML = '<div class="ag-error">Analysis unavailable &mdash; try again.</div>';
    }
    analyzeBtn.textContent = 'Analyze';
    analyzeBtn.disabled = false;
  });
}

function renderDiagnosis(container, dx) {
  const pct = Math.round(dx.confidence * 100);
  container.innerHTML =
    '<div class="ag-card">' +
      '<div class="ag-pest">' + dx.pest + '</div>' +
      '<div class="ag-conf-row">' +
        '<span class="ag-conf-label">Confidence</span>' +
        '<span class="num">' + pct + '%</span>' +
      '</div>' +
      '<div class="ag-bar"><div class="ag-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="ag-rec-row"><span>Recommended biological</span><span>' + dx.recommended_biological + '</span></div>' +
      '<div class="ag-rec-row"><span>Rate</span><span class="num">' + dx.rate_per_acre.toFixed(1) + ' gal/acre</span></div>' +
    '</div>';
}
