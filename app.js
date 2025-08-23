// ====== 지도 기본 설정 ======
const map = L.map('map', { zoomControl: false }).setView([35.1796, 129.0756], 12); // 부산
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// ====== 전역 상태 & UI 엘리먼트 ======
const leftPanel = document.getElementById('list-container');
const rightPanel = document.getElementById('right-panel');
const searchBox = document.getElementById('search-box');
const tabJeonse = document.getElementById('tab-jeonse');
const tabRedev  = document.getElementById('tab-redev');
const stageFilter = document.getElementById('stage-filter');

let currentTab = 'jeonse'; // 'jeonse' | 'redev'
let selectedMarker = null;
let impactCircle = null;

let jeonseData = [];        // 전세 원본
let redevData = [];         // 재개발 원본
let jeonseMarkers = L.markerClusterGroup({ maxClusterRadius: 25, spiderfyOnMaxZoom: true });
let redevMarkers  = L.markerClusterGroup({ maxClusterRadius: 25, spiderfyOnMaxZoom: true });

const markerById = { jeonse: new Map(), redev: new Map() };

map.addLayer(jeonseMarkers);
map.addLayer(redevMarkers);

// ====== 유틸 ======
const clamp = (x, min=0, max=1) => Math.max(min, Math.min(max, x));
function formatPrice(won) {
  if (!won || isNaN(won)) return '정보 없음';
  const eok = Math.floor(won / 1e8);
  const man = Math.floor((won % 1e8) / 1e4);
  let s = '';
  if (eok > 0) s += `${eok}억 `;
  if (man > 0) s += `${man.toLocaleString()}만원`;
  return s || '0원';
}
function formatPriceForInput(won) {
    if (!won || isNaN(won) || won <= 0) return '';
    const eok = Math.floor(won / 1e8);
    const man = Math.round((won % 1e8) / 1e4);
    let s = '';
    if (eok > 0) s += `${eok}억 `;
    if (man > 0) s += `${man.toLocaleString()}만원`;
    return s.trim() || '0원';
}
function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function monthsBetween(ym1, ym2) {
  if (!ym1 || !ym2) return 0;
  const [y1,m1] = ym1.split('-').map(Number);
  const [y2,m2] = ym2.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // m
  const toRad = v => (v * Math.PI)/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

// ====== API 유틸 ======
function toYYYYMM(v) {
  // v: 'YYYY-MM' -> number 202501
  if (!v) return 0;
  return +String(v).replace('-', '');
}
function extractSido(addr='') {
  const first = String(addr).trim().split(/\s+/)[0] || '';
  return first || '부산광역시';
}
function normalizeHouseType(t='') {
  if (String(t).includes('오피스텔')) return '오피스텔';
  if (String(t).includes('아파트')) return '아파트';
  return t || '아파트';
}
function riskLevelFromScore(s) {
  const x = Number(s) || 0;
  if (x >= 0.66) return '높음';
  if (x >= 0.33) return '보통';
  return '낮음';
}

// ====== 위험도 계산(기존 로직 확장 유지) ======
function calcRisk(b, senior_m, endYM) {
  const LTV = clamp(0.5, 0, 1); // 초기값(필요 시 교체)
  const JR = clamp(b.deposit_m / b.trade_price_m, 0, 1);
  const SR = clamp((senior_m || 0) / b.trade_price_m, 0, 1);
  const months = monthsBetween(ymNow(), endYM);
  const periodRisk = 1 - clamp(months / 36, 0, 1);
  const score = Math.round(40*LTV + 30*JR + 20*SR + 10*periodRisk);
  let level = '낮음';
  if (score >= 60) level = '높음';
  else if (score >= 30) level = '보통';
  return { score, level };
}
const colorByRisk = lvl => lvl === '높음' ? 'red' : (lvl === '보통' ? 'orange' : 'green');

// ====== 재개발 단계 색상 ======
function stageColor(stage='') {
  const s = stage;
  if (s.includes('해제')) return '#9aa0a6';
  if (s.includes('준공')) return '#34a853';
  if (s.includes('착공')) return '#ea4335';
  if (s.includes('관리처분')) return '#fb8c00';
  if (s.includes('사업시행')) return '#9333ea';
  if (s.includes('조합설립')) return '#1a73e8';
  if (s.includes('건축심의') || s.includes('통합심의')) return '#fbbc04';
  return '#00acc1'; // 기타/가로주택정비 등
}

// ====== 범례 컨트롤 ======
L.Control.Legend = L.Control.extend({
  onAdd: function() {
    const div = L.DomUtil.create('div','leaflet-control legend');
    div.innerHTML = `
      <div class="row"><span class="dot" style="background:#3b82f6"></span>전세 매물</div>
      <div class="row"><span class="dot" style="background:#34a853"></span>재개발(준공)</div>
      <div class="row"><span class="dot" style="background:#ea4335"></span>재개발(착공)</div>
      <div class="row"><span class="dot" style="background:#fb8c00"></span>재개발(관리처분)</div>
      <div class="row"><span class="dot" style="background:#9333ea"></span>재개발(사업시행)</div>
      <div class="row"><span class="dot" style="background:#1a73e8"></span>재개발(조합설립)</div>
      <div class="row"><span class="dot" style="background:#fbbc04"></span>재개발(심의)</div>
      <div class="row"><span class="dot" style="background:#9aa0a6"></span>재개발(해제)</div>
    `;
    return div;
  },
  onRemove: function(){}
});
(new L.Control.Legend({ position: 'bottomleft' })).addTo(map);

// ====== 데이터 로딩 ======
async function loadData() {
  // 전세 데이터
  const jeonseRaw = await fetch('jeonse_data.json').then(r => r.json());
  jeonseData = jeonseRaw
    .filter(d => d.위도 && d.경도)
    .map((d, i) => {
      const trade = d['주택매매가격(원)'];
      const deposit = d['보증금(원)'];
      const contract = (d.계약기간 || '').split('~');
      return {
        id: i,
        lat: d.위도, lng: d.경도,
        type: d.주택유형, name: d.단지명,
        full_address: d.전체주소,
        trade_price_won: trade,
        deposit_won: deposit,
        gongsi_price_won: d['공시지가(원)'],
        trade_price_m: trade / 1e8,
        deposit_m: deposit / 1e8,
        dong: d.동,
        cheung: d.층,
        hosu: d.호수,
        start_ym: contract[0] ? contract[0].trim().replace(/(\d{4})(\d{2})/, '$1-$2') : '',
        end_ym: contract[1] ? contract[1].trim().replace(/(\d{4})(\d{2})/, '$1-$2') : ''
      };
    });

  // 재개발 데이터
  const redevRaw = await fetch('redevelopment_data.json').then(r => r.json());
  redevData = redevRaw
    .filter(d => d.위도 && d.경도 && d.name)
    .map((d, i) => ({
      id: i,
      lat: d.위도, lng: d.경도,
      name: d.name,
      stage: d.stage || '',
      builder: d.builder || '',
      address: d.address || '',
      units: d.units || 0,
    }));

  renderAll();
}

// ====== 렌더링 ======
function renderAll() {
  jeonseMarkers.clearLayers();
  redevMarkers.clearLayers();
  markerById.jeonse.clear();
  markerById.redev.clear();

  const q = (searchBox.value || '').trim();
  const stageSel = stageFilter.value;

  // 전세 마커
  jeonseData.forEach(b => {
    if (q && !(b.name || '').includes(q) && !(b.full_address || '').includes(q)) return;

    const marker = L.circleMarker([b.lat, b.lng], {
      radius: 8, weight: 1, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.7
    });
    marker.options.originalColor = '#3b82f6';
    marker.on('click', () => selectJeonse(marker, b));
    jeonseMarkers.addLayer(marker);
    markerById.jeonse.set(b.id, marker);
  });

  // 재개발 마커
  redevData.forEach(r => {
    if (q && !(r.name || '').includes(q) && !(r.address || '').includes(q)) return;
    if (stageSel !== 'ALL' && (r.stage || '') !== stageSel) return;

    const marker = L.circleMarker([r.lat, r.lng], {
      radius: 8, weight: 1, color: '#0f766e', fillColor: stageColor(r.stage), fillOpacity: 0.8
    });
    marker.options.originalColor = stageColor(r.stage);
    marker.on('click', () => selectRedev(marker, r));
    redevMarkers.addLayer(marker);
    markerById.redev.set(r.id, marker);
  });
}

function renderList(items) {
  leftPanel.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';

    if (currentTab === 'jeonse') {
      el.innerHTML = `
        <h4>${item.name || '정보 없음'}</h4>
        <p>${item.full_address || ''}</p>
        <p class="sub">매매가 <b>${formatPrice(item.trade_price_won)}</b> · 전세 <b>${formatPrice(item.deposit_won)}</b></p>
      `;
      el.addEventListener('click', () => {
        const m = markerById.jeonse.get(item.id);
        if (m) {
          map.setView([item.lat, item.lng], 15);
          selectJeonse(m, item);
        }
      });
    } else {
      const chipColor = stageColor(item.stage);
      el.innerHTML = `
        <h4>${item.name}</h4>
        <p><span class="chip stage" style="background:${chipColor}">${item.stage || '-'}</span>
           <span class="chip">${item.builder || '-'}</span>
           ${item.units ? `<span class="chip">${item.units.toLocaleString()}세대</span>`:''}
        </p>
        <p class="sub">${item.address || ''}</p>
      `;
      el.addEventListener('click', () => {
        const m = markerById.redev.get(item.id);
        if (m) {
          map.setView([item.lat, item.lng], 15);
          selectRedev(m, item);
        }
      });
    }

    el.__id = item.id;
    leftPanel.appendChild(el);
  });
}

function selectJeonse(marker, b) {
  clearSelection();

  selectedMarker = marker;
  marker.setStyle({ color: '#111', fillColor: '#111', radius: 11, fillOpacity: 1 });

  if (impactCircle) impactCircle.remove();
  impactCircle = L.circle([b.lat, b.lng], { radius: 600, color: '#2563eb', weight: 1, fillOpacity: 0.05 });
  impactCircle.addTo(map);

  updateRightPanelJeonse(b);
  highlightListItem(b.id);
}

function selectRedev(marker, r) {
  clearSelection();

  selectedMarker = marker;
  marker.setStyle({ color: '#111', fillColor: marker.options.originalColor, radius: 11, fillOpacity: 1 });

  updateRightPanelRedev(r);
  highlightListItem(r.id);
}

function highlightListItem(id) {
  const prev = document.querySelector('.list-item.selected');
  if (prev) prev.classList.remove('selected');
  const nodes = Array.from(document.querySelectorAll('#list-container .list-item'));
  const idx = nodes.findIndex(n => n.__id === id);
  if (idx >= 0) {
    nodes[idx].classList.add('selected');
    nodes[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

const _origRenderList = renderList;
renderList = function(items) {
  _origRenderList(items);
};

function updateRightPanelJeonse(b) {
  const nearby = redevData
    .map(r => ({ r, dist: haversine(b.lat, b.lng, r.lat, r.lng) }))
    .filter(x => x.dist <= 600)
    .sort((a,b) => a.dist - b.dist)
    .slice(0, 5);

  rightPanel.innerHTML = `
    <h3>${b.name || '정보 없음'}</h3>
    <p class="address">${b.full_address || ''}</p>

    <div class="details">
      <div class="info-item">
        <label>주택 유형</label>
        <input type="text" value="${b.type || '-'}" readonly class="readonly-input">
      </div>
      <div id="dong-cheung-hosu" class="${b.type === '단독주택' ? 'hidden' : ''}">
        <div class="info-item"><label>동</label><input type="text" id="dong" value="${b.dong || ''}"></div>
        <div class="info-item"><label>층</label><input type="text" id="cheung" value="${b.cheung || ''}"></div>
        <div class="info-item"><label>호수</label><input type="text" id="hosu" value="${b.hosu || ''}"></div>
      </div>
      <div class="info-item">
        <label for="trade-price-input">매매가 (원)</label>
        <div class="price-input-wrapper">
          <input type="number" id="trade-price-input" value="${b.trade_price_won || ''}">
          <span class="price-display" id="trade-price-display"></span>
        </div>
      </div>
      <div class="info-item">
        <label for="deposit-input">전세 보증금 (원)</label>
        <div class="price-input-wrapper">
          <input type="number" id="deposit-input" value="${b.deposit_won || ''}">
          <span class="price-display" id="deposit-display"></span>
        </div>
      </div>
      <div class="info-item">
        <label for="gongsi-price-input">공시지가 (원)</label>
        <div class="price-input-wrapper">
          <input type="number" id="gongsi-price-input" value="${b.gongsi_price_won || ''}">
          <span class="price-display" id="gongsi-price-display"></span>
        </div>
      </div>
    </div>

    <div class="risk-calculator">
      <h4>위험도 직접 계산</h4>
      <label for="senior-input">선순위 채권 금액 (만원)</label>
      <input type="number" id="senior-input" placeholder="예: 5000">
      
      <label for="start-date-input">보증 시작일</label>
      <input type="month" id="start-date-input" value="${b.start_ym || ymNow()}">
      <label for="end-date-input">보증 만료일</label>
      <input type="month" id="end-date-input" value="${b.end_ym || ''}">
      
      <button id="calc-btn">위험도 계산</button>
      <div class="risk-result" id="risk-output" style="display:none;"></div>
    </div>

    <div class="details" style="margin-top:18px;">
      <p style="justify-content:flex-start; gap:8px;">
        <span class="chip">반경 600m 재개발</span>
        <span>${nearby.length}건</span>
      </p>
      ${nearby.length ? nearby.map(({r, dist}) => `
        <p>
          <span>${r.name}</span>
          <span>
            <span class="chip stage" style="background:${stageColor(r.stage)}">${r.stage || '-'}</span>
            <span class="distance">${Math.round(dist)}m</span>
          </span>
        </p>
      `).join(''): `<p>주변 600m 이내 재개발이 없습니다.</p>`}
    </div>
  `;

  ['trade-price', 'deposit', 'gongsi-price'].forEach(id => {
    const input = document.getElementById(`${id}-input`);
    const display = document.getElementById(`${id}-display`);
    const updateDisplay = () => display.textContent = formatPriceForInput(+input.value);
    input.addEventListener('input', updateDisplay);
    updateDisplay();
  });

  document.getElementById('calc-btn').addEventListener('click', async () => {
    // 폼 값 수집
    const tradePriceWon = +document.getElementById('trade-price-input').value || 0;
    const depositWon    = +document.getElementById('deposit-input').value || 0;

    const seniorMan = parseFloat(document.getElementById('senior-input').value) || 0; // 만원 단위
    const startYM   = document.getElementById('start-date-input').value;
    const endYM     = document.getElementById('end-date-input').value;
    if (!startYM || !endYM) return alert('보증 시작/만료월을 선택해주세요.');

    const seniorWon = Math.round(seniorMan * 10000); // 만원 -> 원
    const sido = extractSido(b.full_address || '');
    const houseType = normalizeHouseType(b.type || '');

    const payload = {
      "보증시작월":  toYYYYMM(startYM),
      "보증만료월":  toYYYYMM(endYM),
      "주택가격":    tradePriceWon,
      "임대보증금액": depositWon,
      "선순위":      seniorWon,
      "시도":        sido,
      "주택구분":    houseType
    };

    const outputEl = document.getElementById('risk-output');
    outputEl.style.display = 'block';
    outputEl.innerHTML = '분석 중입니다...';

    const doLocalFallback = (errMsg) => {
      const currentData = {
          ...b,
          trade_price_won: tradePriceWon,
          deposit_won: depositWon,
          trade_price_m: tradePriceWon / 1e8,
          deposit_m: depositWon / 1e8,
      };
      const senior_m = seniorWon / 1e8;
      const res = calcRisk(currentData, senior_m, endYM);
      outputEl.innerHTML = `
        <div id="risk-result" style="background:#fff8f8;border:1px solid #ffd3d3">
          <div style="font-weight:700;margin-bottom:6px">[임시 계산] 위험도 점수: ${res.score} / 100</div>
          <div>위험 수준: <span class="level-${res.level}">${res.level}</span></div>
          <div style="margin-top:10px;color:#c00">⚠ 서버 응답 오류로 임시 계산식을 사용했습니다.${errMsg ? `<br>${errMsg}` : ''}</div>
        </div>
      `;
      if (selectedMarker) {
        const newColor = colorByRisk(res.level);
        selectedMarker.setStyle({ color: newColor, fillColor: newColor, fillOpacity: 0.9 });
        selectedMarker.options.originalColor = newColor;
      }
    };

    try {
      if (!window.CONFIG || !window.CONFIG.PREDICT_URL) {
        throw new Error('API 주소가 설정되지 않았습니다. (config.js 확인)');
      }
      const res = await fetch(window.CONFIG.PREDICT_URL, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`API 오류: ${res.status}`);
      const data = await res.json();
      const score01 = typeof data.risk_score === 'number' ? data.risk_score : 0;
      const level   = riskLevelFromScore(score01);
      const score100 = Math.round(score01 * 100);

      outputEl.innerHTML = `
        <div id="risk-result" style="background:#f7fbff;border:1px solid #dceeff">
          <div style="font-weight:700;margin-bottom:6px">위험도 점수: <span id="risk-score">${score100}</span> / 100</div>
          <div style="margin-bottom:12px">위험 수준: <span class="level-${level}">${level}</span></div>
          <div style="text-align:left;white-space:pre-wrap">${data.ai_explanation || ''}</div>
        </div>
      `;

      if (selectedMarker) {
        const color = colorByRisk(level);
        selectedMarker.setStyle({ color, fillColor: color, fillOpacity: 0.9 });
        selectedMarker.options.originalColor = color;
      }
    } catch (err) {
      console.error(err);
      doLocalFallback(err.message);
    }
  });
}

function updateRightPanelRedev(r) {
  rightPanel.innerHTML = `
    <h3>${r.name}</h3>
    <p class="address">${r.address || ''}</p>
    <div class="details">
      <div class="info-item">
        <label>단계</label>
        <input class="readonly-input" value="${r.stage || '-'}" readonly />
      </div>
      <div class="info-item">
        <label>시공</label>
        <input class="readonly-input" value="${r.builder || '-'}" readonly />
      </div>
      <div class="info-item">
        <label>세대수</label>
        <input class="readonly-input" value="${r.units ? r.units.toLocaleString() + '세대' : '-'}" readonly />
      </div>
    </div>
  `;
}

function clearSelection() {
  if (selectedMarker) {
    selectedMarker.setStyle({ color: '#1d4ed8', fillColor: selectedMarker.options.originalColor || '#3b82f6', radius: 8, fillOpacity: 0.7 });
    selectedMarker = null;
  }
  if (impactCircle) {
    impactCircle.remove();
    impactCircle = null;
  }
  rightPanel.innerHTML = `<p class="hint">왼쪽 목록 또는 지도의 마커를 선택하세요.</p>`;
}

function refreshListByTab() {
  if (currentTab === 'jeonse') {
    renderList(jeonseData);
  } else {
    renderList(redevData);
  }
}

// ====== 검색/탭/필터 이벤트 ======
searchBox.addEventListener('input', renderAll);

tabJeonse.addEventListener('click', () => {
  currentTab = 'jeonse';
  tabJeonse.classList.add('active'); tabRedev.classList.remove('active');
  stageFilter.classList.add('hidden');
  clearSelection();
  renderAll();
});

tabRedev.addEventListener('click', () => {
  currentTab = 'redev';
  tabRedev.classList.add('active'); tabJeonse.classList.remove('active');
  stageFilter.classList.remove('hidden');
  clearSelection();
  renderAll();
});

stageFilter.addEventListener('change', renderAll);

// ====== 시작 ======
loadData().catch(err => {
  console.error(err);
  alert('데이터 로딩 중 오류가 발생했습니다.');
});