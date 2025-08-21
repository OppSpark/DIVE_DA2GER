// ====== 지도 기본 ======
const map = L.map('map', {
  zoomControl: false
}).setView([35.1796, 129.0756], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(map);

// ====== 전역 변수 및 UI 요소 ======
const infoSheet = document.getElementById('info-sheet');
const sheetContent = document.getElementById('sheet-content');
const handle = document.querySelector('.handle');
let selectedMarker = null;

const markers = L.markerClusterGroup({
  maxClusterRadius: 25,
  spiderfyOnMaxZoom: true, 
});

// ====== 유틸 함수 ======
const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
const colorBy = level => level === '높음' ? 'red' : (level === '보통' ? 'orange' : 'green');
function formatPrice(priceInWon) {
  // ★★★ 'priceInwon' -> 'priceInWon' 오타 수정 ★★★
  if (!priceInWon || isNaN(priceInWon)) return '정보 없음';
  const eok = Math.floor(priceInWon / 100000000);
  const man = Math.floor((priceInWon % 100000000) / 10000);
  let result = '';
  if (eok > 0) result += `${eok}억 `;
  if (man > 0) result += `${man.toLocaleString()}만원`;
  return result || '0원';
}
function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ====== 위험도 계산식 ======
function calcRisk(b, senior_m, endYM) {
  const LTV = clamp(0.5, 0, 1);
  const JR = clamp(b.deposit_m / b.trade_price_m, 0, 1);
  const SR = clamp((senior_m || 0) / b.trade_price_m, 0, 1);
  const months = monthsBetween(ymNow(), endYM);
  const periodRisk = 1 - clamp(months / 36, 0, 1);
  const score = Math.round(40 * LTV + 30 * JR + 20 * SR + 10 * periodRisk);
  let level = '낮음';
  if (score >= 60) level = '높음';
  else if (score >= 30) level = '보통';
  return { score, level };
}

function monthsBetween(ym1, ym2) {
  if (!ym1 || !ym2) return 0;
  const [y1, m1] = ym1.split('-').map(Number);
  const [y2, m2] = ym2.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

// (이하 바텀 시트 제어, 렌더링 함수 등은 변경 없음)
let startY, currentY;
let isDragging = false;
function showSheet() { infoSheet.classList.add('visible'); infoSheet.classList.remove('expanded'); }
function expandSheet() { infoSheet.classList.add('expanded'); }
function hideSheet() {
  infoSheet.classList.remove('visible', 'expanded');
  if (selectedMarker) {
    const originalColor = selectedMarker.options.originalColor || '#007bff';
    selectedMarker.setStyle({ color: originalColor, radius: 7 });
    selectedMarker = null;
  }
}
handle.addEventListener('touchstart', (e) => { isDragging = true; startY = e.touches[0].clientY; infoSheet.style.transition = 'none'; });
window.addEventListener('touchmove', (e) => {
  if (!isDragging) return;
  currentY = e.touches[0].clientY;
  const diff = currentY - startY;
  if (infoSheet.classList.contains('expanded')) {
    if (diff > 0) infoSheet.style.transform = `translateY(calc(10% + ${diff}px))`;
  } else {
    if (diff > 0) infoSheet.style.transform = `translateY(calc(100% - 200px + ${diff}px))`;
  }
});
window.addEventListener('touchend', () => {
  if (!isDragging) return;
  isDragging = false;
  infoSheet.style.transition = '';
  infoSheet.style.transform = '';
  const diff = currentY - startY;
  if (diff > 80) {
    if (infoSheet.classList.contains('expanded')) showSheet();
    else hideSheet();
  } else if (diff < -80) {
    expandSheet();
  }
});

function updateSheetContent(b) {
  sheetContent.innerHTML = `
    <h3>${b.name || '정보 없음'}</h3>
    <p class="address">${b.full_address}</p>
    <div class="details">
      <p>주택 유형: <span>${b.type}</span></p>
      <p>매매가: <span>${formatPrice(b.trade_price_won)}</span></p>
      <p>전세 보증금: <span>${formatPrice(b.deposit_won)}</span></p>
      <p>공시지가: <span>${formatPrice(b.gongsi_price_won)}</span></p>
    </div>
    <div class="risk-calculator">
      <label for="senior-input">선순위 채권 금액 (만원)</label>
      <input type="number" id="senior-input" placeholder="예: 5000">
      <label for="end-date-input">보증 만료일</label>
      <input type="month" id="end-date-input">
      <button id="calc-btn">위험도 계산</button>
      <div class="risk-result" id="risk-output" style="display:none;"></div>
    </div>
  `;
  document.getElementById('calc-btn').addEventListener('click', () => {
    const seniorMan = parseFloat(document.getElementById('senior-input').value) || 0;
    const endYM = document.getElementById('end-date-input').value;
    if (!endYM) return alert('보증 만료일을 선택해주세요.');
    const senior_m = seniorMan / 10000;
    const res = calcRisk(b, senior_m, endYM);
    const outputEl = document.getElementById('risk-output');
    outputEl.style.display = 'block';
    outputEl.innerHTML = `<b>위험도 점수: ${res.score} / 100</b><p>위험 수준: <span class="level-${res.level}">${res.level}</span></p>`;
    if (selectedMarker) {
      const newColor = colorBy(res.level);
      selectedMarker.setStyle({ color: newColor });
      selectedMarker.options.originalColor = newColor;
    }
  });
}

async function loadAndRenderData() {
  try {
    const response = await fetch('jeonse_data.json');
    const data = await response.json();
    const buildings = data
      .map(d => {
        const tradePrice = d['주택매매가격(원)'];
        if (!d.위도 || !d.경도 || !tradePrice) return null;
        
        // ★★★ '보증금(만원)' -> '보증금(원)' 직접 읽도록 수정 ★★★
        const deposit_won = d['보증금(원)'];

        return {
          lat: d.위도, lng: d.경도, type: d.주택유형, name: d.단지명,
          full_address: d.전체주소, trade_price_won: tradePrice,
          deposit_won: deposit_won, 
          gongsi_price_won: d['공시지가(원)'],
          trade_price_m: tradePrice / 100000000,
          deposit_m: deposit_won / 100000000,
        };
      })
      .filter(b => b);
    
    renderMarkers(buildings);
  } catch (error) {
    console.error('데이터 로딩 오류:', error);
    sheetContent.innerHTML = `<p>데이터를 불러오는 데 실패했습니다.</p>`;
    showSheet();
  }
}

function renderMarkers(buildings) {
  markers.clearLayers();

  buildings.forEach(b => {
    const marker = L.circleMarker([b.lat, b.lng], {
      radius: 7, color: '#007bff', fillOpacity: 0.7, weight: 2
    });
    marker.options.originalColor = '#007bff';
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (selectedMarker) {
        const originalColor = selectedMarker.options.originalColor || '#007bff';
        selectedMarker.setStyle({ color: originalColor, radius: 7 });
      }
      selectedMarker = marker;
      marker.setStyle({ color: 'red', radius: 10 });
      updateSheetContent(b);
      showSheet();
    });
    markers.addLayer(marker);
  });
  map.addLayer(markers);
}

map.on('click', hideSheet);

loadAndRenderData();