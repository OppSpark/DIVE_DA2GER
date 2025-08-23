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
  // 전세 데이터(위도/경도/단지명/매매가/보증금/공시지가 등 — 스키마는 기존 JSON을 그대로 사용)
  const jeonseRaw = await fetch('jeonse_data.json').then(r => r.json());
  jeonseData = jeonseRaw
    .filter(d => d.위도 && d.경도 && d['주택매매가격(원)'])
    .map((d, i) => {
      const trade = d['주택매매가격(원)'];
      const deposit = d['보증금(원)'];
      return {
        id: i,
        lat: d.위도, lng: d.경도,
        type: d.주택유형, name: d.단지명,
        full_address: d.전체주소,
        trade_price_won: trade,
        deposit_won: deposit,
        gongsi_price_won: d['공시지가(원)'],
        trade_price_m: trade / 1e8,
        deposit_m: deposit / 1e8
      };
    });

  // 재개발 데이터(name, address, stage, builder, units, image_url, 위경도)
  const redevRaw = await fetch('redevelopment_data.json').then(r => r.json());
  redevData = redevRaw
    .filter(d => d.위도 && d.경도 && d.name)
    .map((d, i) => ({
      id: i,
      lat: d.위도, lng: d.경도,
      name: d.name,
      stage: d.stage || '',
      builder: d.builder || '-',
      units: Number.isFinite(+d.units) ? +d.units : d.units,
      address: d.address || '',
      image_url: d.image_url || ''
    }));

  renderAll();
}

// ====== 마커/목록 렌더링 ======
function clearSelection() {
  if (selectedMarker) {
    const originalColor = selectedMarker.options.originalColor || '#3b82f6';
    selectedMarker.setStyle({ color: originalColor, fillColor: originalColor, radius: selectedMarker.options.kind==='redev'?9:7, fillOpacity: 0.7 });
  }
  selectedMarker = null;

  if (impactCircle) {
    map.removeLayer(impactCircle);
    impactCircle = null;
  }
}

function renderJeonseMarkers(list) {
  jeonseMarkers.clearLayers();
  markerById.jeonse.clear();

  list.forEach(b => {
    const color = '#3b82f6';
    const m = L.circleMarker([b.lat, b.lng], {
      radius: 7, color, fillColor: color, fillOpacity: 0.7
    });
    m.options.originalColor = color;
    m.options.kind = 'jeonse';
    m.bindTooltip(b.name || '전세');
    m.on('click', () => selectJeonse(m, b));
    jeonseMarkers.addLayer(m);
    markerById.jeonse.set(b.id, m);
  });
}

function renderRedevMarkers(list) {
  redevMarkers.clearLayers();
  markerById.redev.clear();

  list.forEach(r => {
    const color = stageColor(r.stage);
    const m = L.circleMarker([r.lat, r.lng], {
      radius: 9, color, fillColor: color, fillOpacity: 0.85
    });
    m.options.originalColor = color;
    m.options.kind = 'redev';
    m.bindTooltip(`${r.name} (${r.stage || '-'})`);
    m.on('click', () => selectRedev(m, r));
    redevMarkers.addLayer(m);
    markerById.redev.set(r.id, m);
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

    leftPanel.appendChild(el);
  });
}

function renderAll() {
  const q = (searchBox.value || '').trim();
  let list = [];

  if (currentTab === 'jeonse') {
    // 필터링
    list = jeonseData.filter(b => {
      if (!q) return true;
      const s = `${b.name||''} ${b.full_address||''} ${b.type||''}`.toLowerCase();
      return s.includes(q.toLowerCase());
    });
    renderJeonseMarkers(list);
  } else {
    const stageVal = stageFilter.value || '';
    list = redevData.filter(r => {
      const stageOk = !stageVal || r.stage.includes(stageVal);
      if (!q) return stageOk;
      const s = `${r.name||''} ${r.address||''} ${r.stage||''} ${r.builder||''}`.toLowerCase();
      return stageOk && s.includes(q.toLowerCase());
    });
    renderRedevMarkers(list);
  }

  renderList(list);
}

// ====== 선택 동작 ======
function selectJeonse(marker, b) {
  clearSelection();

  selectedMarker = marker;
  marker.setStyle({ color: 'red', fillColor: 'red', radius: 10, fillOpacity: 1 });

  // 영향 반경 600m
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

// 렌더 시 리스트 DOM에 id 주입
const _origRenderList = renderList;
renderList = function(items) {
  leftPanel.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.__id = item.id;

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
    leftPanel.appendChild(el);
  });
};

// ====== 우측 패널 ======
function updateRightPanelJeonse(b) {
  // 근처 재개발(600m)
  const nearby = redevData
    .map(r => ({ r, dist: haversine(b.lat, b.lng, r.lat, r.lng) }))
    .filter(x => x.dist <= 600)
    .sort((a,b) => a.dist - b.dist)
    .slice(0, 5);

  rightPanel.innerHTML = `
    <h3>${b.name || '정보 없음'}</h3>
    <p class="address">${b.full_address || ''}</p>

    <div class="details">
      <p>주택 유형: <span>${b.type || '-'}</span></p>
      <p>매매가: <span>${formatPrice(b.trade_price_won)}</span></p>
      <p>전세 보증금: <span>${formatPrice(b.deposit_won)}</span></p>
      <p>공시지가: <span>${formatPrice(b.gongsi_price_won)}</span></p>
    </div>

    <div class="risk-calculator">
      <h4>위험도 직접 계산</h4>
      <label for="senior-input">선순위 채권 금액 (만원)</label>
      <input type="number" id="senior-input" placeholder="예: 5000">
      <label for="end-date-input">보증 만료일</label>
      <input type="month" id="end-date-input">
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

  document.getElementById('calc-btn').addEventListener('click', () => {
    const seniorMan = parseFloat(document.getElementById('senior-input').value) || 0;
    const endYM = document.getElementById('end-date-input').value;
    if (!endYM) return alert('보증 만료일을 선택해주세요.');
    const senior_m = seniorMan * 10000 / 100000000; // 만원 → 억
    const res = calcRisk(b, senior_m, endYM);

    const outputEl = document.getElementById('risk-output');
    outputEl.style.display = 'block';
    outputEl.innerHTML = `<b>위험도 점수: ${res.score} / 100</b><p>위험 수준: <span class="level-${res.level}">${res.level}</span></p>`;

    if (selectedMarker) {
      const newColor = colorByRisk(res.level);
      selectedMarker.setStyle({ color: newColor, fillColor: newColor, fillOpacity: 0.9 });
      selectedMarker.options.originalColor = newColor;
    }
  });
}

function updateRightPanelRedev(r) {
  rightPanel.innerHTML = `
    <h3>${r.name}</h3>
    <p class="address">${r.address || ''}</p>

    <div class="card">
      <img class="card-img" src="${r.image_url || ''}" alt="" onerror="this.style.display='none'">
      <div class="card-body">
        <p>
          <span class="chip stage" style="background:${stageColor(r.stage)}">${r.stage || '-'}</span>
          <span class="chip">${r.builder || '-'}</span>
          ${r.units ? `<span class="chip">${(r.units+'').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}세대</span>` : ''}
        </p>
        <p class="meta">위치: ${r.address || '-'}</p>
      </div>
    </div>
  `;
}

// ====== 이벤트 ======
searchBox.addEventListener('input', renderAll);

tabJeonse.addEventListener('click', () => {
  if (currentTab === 'jeonse') return;
  currentTab = 'jeonse';
  tabJeonse.classList.add('active'); tabRedev.classList.remove('active');
  stageFilter.classList.add('hidden');
  clearSelection();
  renderAll();
});

tabRedev.addEventListener('click', () => {
  if (currentTab === 'redev') return;
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