// ====== 지도 기본 ======
const map = L.map('map').setView([37.5665, 126.9780], 12); // 서울 중심
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(map);

// ====== 유틸 ======
const rnd = (a, b) => Math.random() * (b - a) + a;
const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
const fmtEok = v => `${(+v).toFixed(1)}억`;
const colorBy = level => level === '높음' ? 'red' : (level === '보통' ? 'orange' : 'green');

function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function ymAdd(ym, add) { // add개월 더하기
  const [y, m] = ym.split('-').map(Number);
  const base = new Date(y, m - 1, 1);
  base.setMonth(base.getMonth() + add);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}

// YYYY-MM → 월수 차이(유효성 포함, 포함월 방식)
function monthsBetween(ym1, ym2) {
  if (!ym1 || !ym2) return 0;
  const [y1, m1] = ym1.split('-').map(Number);
  const [y2, m2] = ym2.split('-').map(Number);
  if (!Number.isInteger(y1) || !Number.isInteger(m1) || !Number.isInteger(y2) || !Number.isInteger(m2)) return 0;
  const a = y1 * 12 + (m1 - 1);
  const b = y2 * 12 + (m2 - 1);
  return Math.max(0, b - a + 1); // 포함월: 시작과 종료 둘 다 포함
}

// ====== 더미 데이터 생성 ======
const SIDO = ["서울","경기","인천","부산","대구","광주","대전","울산","세종","강원","충북","충남","전북","전남","경북","경남","제주"];
const TYPES = ["아파트","다세대","단독주택","오피스텔"];

function genBuilding(id) {
  const lat = rnd(37.45, 37.65);
  const lng = rnd(126.80, 127.10);
  const trade = +(rnd(3, 18).toFixed(1));                  // 매매가 3~18억
  const jeonse = +(rnd(trade * 0.5, trade * 0.9).toFixed(1)); // 전세 50~90%
  const ltv = +(rnd(0.4, 0.8).toFixed(2));                 // 초기 LTV 40~80%
  return {
    id, lat, lng,
    sido: SIDO[Math.floor(rnd(0, SIDO.length))],
    type: TYPES[Math.floor(rnd(0, TYPES.length))],
    trade_price_m: trade,   // 주택가액(억)
    deposit_m: jeonse,      // 임대보증금(억)
    initial_ltv: ltv        // 초기 LTV(0~1)
  };
}
const buildings = Array.from({ length: 500 }, (_, i) => genBuilding(`BLDG_${i + 1}`));

// ====== 위험도 계산식 ======
// 점수 = 40*LTV + 30*전세비율 + 20*선순위비율 + 10*보증기간리스크
// - 보증기간리스크 = 1 - clamp(보증개월/36, 0, 1)
function calcRisk(b, senior_m, startYM, endYM) {
  const LTV = clamp(b.initial_ltv, 0, 1);
  const JR = clamp(b.deposit_m / b.trade_price_m, 0, 1);
  const SR = clamp((senior_m || 0) / b.trade_price_m, 0, 1);
  const months = monthsBetween(startYM, endYM);
  const periodRisk = 1 - clamp(months / 36, 0, 1);

  const score = Math.round(40 * LTV + 30 * JR + 20 * SR + 10 * periodRisk);

  let level = '낮음';
  if (score >= 60) level = '높음';
  else if (score >= 30) level = '보통';

  return {
    score, level, months,
    LTV: Math.round(LTV * 100),
    JR: Math.round(JR * 100),
    SR: Math.round(SR * 100)
  };
}

// ====== 마커 렌더링 ======
buildings.forEach(b => {
  const marker = L.circleMarker([b.lat, b.lng], { radius: 6, color: '#777', fillOpacity: 0.85 }).addTo(map);

  function popupHTML(res) {
    const line1 = `<b>${b.type}</b> · ${b.sido}<br/>주택가액 ${fmtEok(b.trade_price_m)} · 전세가 ${fmtEok(b.deposit_m)} · 초기 LTV ${Math.round(b.initial_ltv * 100)}%`;
    const inputs = `
      <div style="margin-top:6px;display:grid;gap:6px">
        <label>선순위 금액(억)
          <input id="senior-${b.id}" type="number" step="0.1" min="0" style="width:100px;margin-left:6px">
        </label>
        <div style="display:flex;gap:10px;align-items:center">
          <label>보증 시작
            <input id="start-${b.id}" type="month" style="margin-left:6px">
          </label>
          <label>보증 완료
            <input id="end-${b.id}" type="month" style="margin-left:6px">
          </label>
        </div>
        <button id="go-${b.id}">위험도 계산</button>
      </div>
    `;
    const out = res ? `
      <div class="risk" id="out-${b.id}" style="margin-top:8px">
        <b>점수 ${res.score} / 100</b> · <span style="color:${colorBy(res.level)}">${res.level}</span><br/>
        LTV ${res.LTV}% · 전세비율 ${res.JR}% · 선순위비율 ${res.SR}% · 보증기간 ${res.months}개월
      </div>`
      : `<div class="risk" id="out-${b.id}" style="margin-top:8px;color:#888">※ 값을 입력하고 ‘위험도 계산’을 눌러주세요</div>`;
    return `<div style="min-width:280px">${line1}<hr/>${inputs}${out}</div>`;
  }

  marker.bindPopup(popupHTML(null));

  marker.on('popupopen', () => {
    const seniorEl = document.getElementById(`senior-${b.id}`);
    const startEl = document.getElementById(`start-${b.id}`);
    const endEl = document.getElementById(`end-${b.id}`);
    const btn = document.getElementById(`go-${b.id}`);
    const outEl = document.getElementById(`out-${b.id}`);

    // 기본값 자동 입력(처음 열었을 때만)
    if (!startEl.value) {
      startEl.value = ymNow();
      endEl.value = ymAdd(startEl.value, 24); // +24개월
    }

    // Enter 키로 계산
    [seniorEl, startEl, endEl].forEach(el => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btn.click();
      });
    });

    btn.onclick = () => {
      const senior = parseFloat(seniorEl.value || '0');
      const startYM = startEl.value;
      const endYM = endEl.value;

      // 유효성 체크
      if (!startYM || !endYM) {
        outEl.style.color = 'crimson';
        outEl.innerText = '보증 시작/완료 월을 입력하세요.';
        return;
      }
      const m = monthsBetween(startYM, endYM);
      if (m <= 0) {
        outEl.style.color = 'crimson';
        outEl.innerText = '보증 완료월이 시작월보다 빠릅니다.';
        return;
      }

      // 계산
      const res = calcRisk(b, senior, startYM, endYM);
      marker.setStyle({ color: colorBy(res.level) });

      // 결과만 업데이트
      outEl.style.color = '';
      outEl.innerHTML =
        `<b>점수 ${res.score} / 100</b> · <span style="color:${colorBy(res.level)}">${res.level}</span><br/>
         LTV ${res.LTV}% · 전세비율 ${res.JR}% · 선순위비율 ${res.SR}% · 보증기간 ${res.months}개월`;
    };
  });
});