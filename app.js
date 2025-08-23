// ====== 지도 기본 설정 ======
const map = L.map('map', { zoomControl: false }).setView([35.1796, 129.0756], 12); // 부산
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// ====== API 기본 엔드포인트(폴백) ======
const PREDICT_URL_DEFAULT = 'https://divepredictmodel-gfe8aeadgehfh9gh.koreacentral-01.azurewebsites.net/predict_and_explain';

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
function simplifySido(s='') {
  // '인천광역시' -> '인천', '경기도' -> '경기'
  return String(s).replace(/(특별시|광역시|특별자치시|특별자치도|자치시|자치도|도)$/,'');
}
function normalizeHouseType(t='') {
  if (String(t).includes('오피스텔')) return '오피스텔';
  if (String(t).includes('아파트')) return '아파트';
  return t || '아파트';
}
function riskLevelFromScore(s01) {
  // s01: 0~1 범위 가정
  const x = Number(s01) || 0;
  if (x >= 0.148) return '매우 높음';
  if (x >= 0.074) return '보통';
  return '보통';
}

// ====== 위험도 계산(기존 로직 확장 유지) ======
function calcRisk(b, senior_m, endYM) {
  const LTV = clamp(0.5, 0, 1); // 초기값(필요 시 교체)
  const JR = clamp(b.deposit_m / b.trade_price_m, 0, 1);
  const SR = clamp((senior_m || 0) / b.trade_price_m, 0, 1);
  const months = monthsBetween(ymNow(), endYM);
  const periodRisk = 1 - clamp(months / 36, 0, 1);
  const score = Math.round(40*LTV + 30*JR + 20*SR + 10*periodRisk); // 0~100
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
      // [추가]
      image_url: d.image_url || ''
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

  // [추가] 각 탭 리스트에 뿌릴 임시 배열
  const jeonseList = [];
  const redevList = [];

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

    // [추가]
    jeonseList.push(b);
  });

  // [추가] 단계 매칭 유틸 (부분일치 + 다중 키워드 대응)
  const matchesStage = (stageText='', sel='ALL') => {
    if (sel === 'ALL') return true;
    const keys = sel.split('/');         // "건축심의/통합심의" 대응
    return keys.some(k => stageText.includes(k));
  };

  // 재개발 마커
  redevData.forEach(r => {
    if (q && !(r.name || '').includes(q) && !(r.address || '').includes(q)) return;
    if (!matchesStage(String(r.stage || ''), stageSel)) return;

    const marker = L.circleMarker([r.lat, r.lng], {
      radius: 8, weight: 1, color: '#0f766e', fillColor: stageColor(r.stage), fillOpacity: 0.8
    });
    marker.options.originalColor = stageColor(r.stage);
    marker.on('click', () => selectRedev(marker, r));
    redevMarkers.addLayer(marker);
    markerById.redev.set(r.id, marker);

    // [추가]
    redevList.push(r);
  });

  // [추가] 현재 탭에 맞춰 리스트 갱신
  renderList(currentTab === 'jeonse' ? jeonseList : redevList);
}

function renderList(items) {
  leftPanel.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'list-item';

    if (currentTab === 'jeonse') {
      el.innerHTML = `
        <h4>${item.name || '일반 주택'}</h4>
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
    const sidoFull = extractSido(b.full_address || '');
    const sidoSimple = simplifySido(sidoFull);
    const houseType = normalizeHouseType(b.type || '');

    const payload = {
      "보증시작월":  toYYYYMM(startYM),
      "보증완료월":  toYYYYMM(endYM),
      "주택가액":    tradePriceWon,
      "임대보증금액": depositWon,
      "선순위":      seniorWon,
      "시도":        sidoSimple, // 예: '인천'
      "주택구분":    houseType   // 예: '오피스텔'
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
        <div id="risk-result" style="background:#fff8f8;border:1px solid #ffd3d3;padding:10px;border-radius:8px;">
          <div style="font-weight:700;margin-bottom:6px">[임시 계산] 위험 확롤: ${res.score} % </div>
          <div>위험 수준: <span class="level-${res.level}">${res.level}</span></div>
          <div style="margin-top:10px;color:#c00">⚠ 서버 응답 오류로 임시 계산식을 사용했습니다.${errMsg ? `<br>${String(errMsg).replace(/</g,'&lt;')}` : ''}</div>
        </div>
      `;
      if (selectedMarker) {
        const newColor = colorByRisk(res.level);
        selectedMarker.setStyle({ color: newColor, fillColor: newColor, fillOpacity: 0.9 });
        selectedMarker.options.originalColor = newColor;
      }
    };

    try {
      // CONFIG 없으면 폴백 사용
      const endpoint = (window.CONFIG?.PREDICT_URL) ?? PREDICT_URL_DEFAULT;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, // Accept 생략 가능
        body: JSON.stringify(payload),
        cache: 'no-store'
      });

      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`API 오류: ${res.status} ${res.statusText}\n${rawText}`);
      }

      let data;
      try { data = JSON.parse(rawText); }
      catch {
        throw new Error(`JSON 파싱 실패: ${rawText.slice(0, 300)}`);
      }

      // 서버가 주는 스코어 키 유연 처리
      let score = (typeof data.risk_score === 'number') ? data.risk_score
                : (typeof data.score === 'number') ? data.score
                : (typeof data['위험도'] === 'number') ? data['위험도']
                : (typeof data.riskScore === 'number') ? data.riskScore
                : 0;

      // 0~1 또는 0~100 모두 대응
      const score100 = (score <= 1) ? Math.round(score * 100) : Math.round(score);
      const score01  = (score <= 1) ? score : (score / 100);
      const level    = riskLevelFromScore(score01);

      const explanation = (data.ai_explanation || data.explanation || data['설명'] || '');

      outputEl.innerHTML = `
        <div id="risk-result" style="background:#f7fbff;border:1px solid #dceeff;padding:10px;border-radius:8px;">
          <div style="font-weight:700;margin-bottom:6px">위험 확률: <span id="risk-score">${score100}</span> % </div>
          <div style="margin-bottom:12px">위험 수준: <span class="level-${level}">${level}</span></div>
          <div style="text-align:left;white-space:pre-wrap">${String(explanation)}</div>
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
  // [추가] 안전한 이미지 태그 만들기
  const hasImg = r.image_url && !/\/$|null$/i.test(r.image_url);
  const imgTag = hasImg
    ? `<img class="card-img" src="${r.image_url}" alt="${r.name}" loading="lazy"
         referrerpolicy="no-referrer"
         onerror="this.onerror=null;this.src='https://via.placeholder.com/640x360?text=%EA%B7%B8%EB%A6%BC+%EC%97%86%EC%9D%8C';">`
    : `<div class="card-img"></div>`;

  rightPanel.innerHTML = `
    <div class="card">
      ${imgTag}
      <div class="card-body">
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
      </div>
    </div>
  `;
}

function clearSelection() {
  if (selectedMarker) {
    selectedMarker.setStyle({
      color: '#1d4ed8',
      fillColor: selectedMarker.options.originalColor || '#3b82f6',
      radius: 8,
      fillOpacity: 0.7
    });
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

/* ====== Chatbot (플로팅 위젯) ====== */
(function initChatbot() {
  const CHAT_URL = (window.CONFIG && window.CONFIG.CHAT_URL) || '/ask'; // config.js의 CHAT_URL 사용  [oai_citation:4‡config.js](file-service://file-NHYPDXzsbYacbtp99etxLi)

  // --- UI 생성 ---
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'chat-toggle';
  toggleBtn.type = 'button';
  toggleBtn.textContent = '챗봇 문의';

  const wrap = document.createElement('div');
  wrap.id = 'chat-widget';
  wrap.innerHTML = `
    <div class="chat-header">
      <span>안심전세 챗봇</span>
      <button id="chat-close" title="닫기">×</button>
    </div>
    <div class="chat-messages" id="chat-messages" role="log" aria-live="polite"></div>
    <form class="chat-input" id="chat-form">
      <input id="chat-text" type="text" placeholder="무엇이든 물어보세요…" autocomplete="off" />
      <button id="chat-send" type="submit">전송</button>
    </form>
  `;
  document.body.appendChild(toggleBtn);
  document.body.appendChild(wrap);

  const messagesEl = wrap.querySelector('#chat-messages');
  const formEl = wrap.querySelector('#chat-form');
  const inputEl = wrap.querySelector('#chat-text');
  const closeEl = wrap.querySelector('#chat-close');

  const open = () => { wrap.classList.add('open'); inputEl.focus(); };
  const close = () => { wrap.classList.remove('open'); };
  toggleBtn.addEventListener('click', open);
  closeEl.addEventListener('click', close);

  // --- 메시지 헬퍼 ---
  function appendMessage(text, sender, { loading = false } = {}) {
    const msg = document.createElement('div');
    msg.className = `msg ${sender}` + (loading ? ' loading' : '');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    msg.appendChild(bubble);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg; // DOM 노드 반환 (치환용)
  }
  function replaceMessage(msgNode, newText, { makeBot = true } = {}) {
    if (!msgNode) return;
    msgNode.classList.remove('loading');
    msgNode.classList.add('bot');
    const bubble = msgNode.querySelector('.bubble');
    if (bubble) bubble.textContent = newText;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // --- 서버 호출 (플러터 포맷 그대로) ---
  async function askBot(userText) {
    // 로딩 메시지
    const loadingNode = appendMessage('답변을 불러오는 중...', 'bot', { loading: true });

    try {
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userText }) // Flutter와 동일 포맷
      });

      // 본문 먼저 텍스트로 받았다가 JSON 파싱 (디버깅 용이)
      const raw = await res.text();
      if (!res.ok) {
        replaceMessage(loadingNode, `에러: ${res.status}`);
        console.error('Chat API error', res.status, raw);
        return;
      }
      let data;
      try { data = JSON.parse(raw); }
      catch { 
        replaceMessage(loadingNode, '응답 없음');
        console.error('Chat API JSON parse error', raw);
        return;
      }
      const botReply = data && (data.answer ?? '응답 없음');
      replaceMessage(loadingNode, String(botReply));
    } catch (e) {
      console.error(e);
      replaceMessage(loadingNode, `요청 실패: ${e}`);
    }
  }

  // --- 전송 동작 ---
  formEl.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = (inputEl.value || '').trim();
    if (!text) return;
    appendMessage(text, 'user');
    inputEl.value = '';
    askBot(text);
  });

  // 단축키: Ctrl/Cmd+Shift+K 로 열기
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
      if (wrap.classList.contains('open')) close(); else open();
    }
    appendMessage('안녕하세요. 안심전세 챗봇이에요! 무엇을 도와드릴까요? 임대차계약에서 사용되는 용어부터 법률 정보까지 무엇이든 물어보세요!', 'bot');
  });
})();