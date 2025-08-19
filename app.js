// ====== 지도 기본 ======
const map = L.map('map').setView([35.1796, 129.0756], 12); // 부산 중심
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(map);

// ====== 전역 변수 및 UI 요소 ======
const sidebar = document.getElementById('sidebar');
const infoPanel = document.getElementById('info-panel');
const placeholder = document.querySelector('.placeholder');
let selectedMarker = null;

// ====== 유틸 함수 ======
const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
const colorBy = level => level === '높음' ? 'red' : (level === '보통' ? 'orange' : 'green');
// 숫자를 억/만 단위로 변환
function formatPrice(priceInWon) {
  if (!priceInWon || isNaN(priceInWon)) return '정보 없음';
  const eok = Math.floor(priceInWon / 100000000);
  const man = Math.floor((priceInWon % 100000000) / 10000);
  let result = '';
  if (eok > 0) result += `${eok}억 `;
  if (man > 0) result += `${man.toLocaleString()}만원`;
  return result || '0원';
}

// ====== 위험도 계산식 ======
function calcRisk(b, senior_m, startYM, endYM) {
  const LTV = clamp(b.initial_ltv, 0, 1);
  const JR = clamp(b.deposit_m / b.trade_price_m, 0, 1);
  const SR = clamp((senior_m || 0) / b.trade_price_m, 0, 1);
  const months = monthsBetween(ymNow(), endYM); // 보증 시작은 현재로 고정
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
    const a = y1 * 12 + m1;
    const b = y2 * 12 + m2;
    return Math.max(0, b - a + 1);
}

function ymNow() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ====== 사이드바 업데이트 함수 ======
function updateSidebar(b) {
  placeholder.style.display = 'none';
  infoPanel.innerHTML = `
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

  // 위험도 계산 버튼 이벤트
  document.getElementById('calc-btn').addEventListener('click', () => {
    const seniorMan = parseFloat(document.getElementById('senior-input').value) || 0;
    const endYM = document.getElementById('end-date-input').value;
    
    if (!endYM) {
        alert('보증 만료일을 선택해주세요.');
        return;
    }
    
    const senior_m = seniorMan / 10000; // 만원 -> 억
    const res = calcRisk(b, senior_m, ymNow(), endYM);
    
    const outputEl = document.getElementById('risk-output');
    outputEl.style.display = 'block';
    outputEl.innerHTML = `
      <b>위험도 점수: ${res.score} / 100</b>
      <p>위험 수준: <span class="level-${res.level === '높음' ? 'high' : (res.level === '보통' ? 'mid' : 'low')}">${res.level}</span></p>
    `;

    // 마커 색상 변경
    if (selectedMarker) {
      selectedMarker.setStyle({ color: colorBy(res.level) });
    }
  });
}

// ====== 데이터 로딩 및 마커 생성 ======
async function loadAndRenderData() {
  try {
    const response = await fetch('jeonse_data.json');
    const data = await response.json();

    const buildings = data.map(d => {
      // ★★★★★ 여기 키 이름 수정 ★★★★★
      const tradePrice = d['주택매매가격(원)'];
      if (!d.위도 || !d.경도 || !tradePrice) return null;
      
      const deposit_won = parseFloat(String(d['보증금(만원)']).replace(/,/g, '')) * 10000;

      return {
        lat: d.위도,
        lng: d.경도,
        type: d.주택유형,
        name: d.단지명,
        full_address: d.전체주소,
        trade_price_won: tradePrice,
        deposit_won: deposit_won,
        gongsi_price_won: d['공시지가(원)'], // ★★★★★ 여기 키 이름 수정 ★★★★★
        // 계산에 필요한 '억' 단위 데이터
        trade_price_m: tradePrice / 100000000,
        deposit_m: deposit_won / 100000000,
        initial_ltv: 0.5 // 50%로 가정
      };
    }).filter(b => b);

    renderMarkers(buildings);

  } catch (error) {
    console.error('데이터 로딩 또는 처리 중 오류 발생:', error);
    placeholder.textContent = '데이터를 불러오는 데 실패했습니다.';
  }
}

// 마커를 지도에 그리는 함수
function renderMarkers(buildings) {
  buildings.forEach(b => {
    const marker = L.circleMarker([b.lat, b.lng], { 
        radius: 7, 
        color: '#007bff', 
        fillOpacity: 0.7 
    }).addTo(map);

    marker.on('click', () => {
      // 이전에 선택된 마커 스타일 초기화
      if (selectedMarker) {
        selectedMarker.setStyle({ color: '#007bff', radius: 7 });
      }
      
      // 현재 마커를 선택된 것으로 설정하고 스타일 변경
      selectedMarker = marker;
      marker.setStyle({ color: 'red', radius: 10 });
      
      // 사이드바 내용 업데이트
      updateSidebar(b);
    });
  });
}

// 앱 실행
loadAndRenderData();