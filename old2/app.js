// ====== 지도 기본 ======
const map = new kakao.maps.Map(document.getElementById('map'), {
  center: new kakao.maps.LatLng(37.5665, 126.9780), // 서울
  level: 6
});
const geocoder = new kakao.maps.services.Geocoder();

// ====== 유틸 ======
const rnd = (a, b) => Math.random() * (b - a) + a;
const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
const fmtEok = v => `${(+v).toFixed(1)}억`;
const colorBy = level => (level === '높음' ? 'red' : (level === '보통' ? 'orange' : '#2e8b57'));

function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function ymAdd(ym, add) {
  const [y, m] = ym.split('-').map(Number);
  const base = new Date(y, m - 1, 1);
  base.setMonth(base.getMonth() + add);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}
function monthsBetween(ym1, ym2) {
  if (!ym1 || !ym2) return 0;
  const [y1, m1] = ym1.split('-').map(Number);
  const [y2, m2] = ym2.split('-').map(Number);
  if (![y1,m1,y2,m2].every(Number.isInteger)) return 0;
  const a = y1 * 12 + (m1 - 1);
  const b = y2 * 12 + (m2 - 1);
  return Math.max(0, b - a + 1);
}

// ====== 위험도 계산 ======
function calcRisk(b, senior_m, startYM, endYM) {
  const LTV = clamp(b.initial_ltv, 0, 1);
  const JR  = clamp(b.deposit_m / b.trade_price_m, 0, 1);
  const SR  = clamp((senior_m || 0) / b.trade_price_m, 0, 1);
  const months = monthsBetween(startYM, endYM);
  const periodRisk = 1 - clamp(months / 36, 0, 1);
  const score = Math.round(40 * LTV + 30 * JR + 20 * SR + 10 * periodRisk);

  let level = '낮음';
  if (score >= 60) level = '높음';
  else if (score >= 30) level = '보통';

  return { score, level, months, LTV: Math.round(LTV * 100), JR: Math.round(JR * 100), SR: Math.round(SR * 100) };
}

// ====== 더미 데이터 생성(또는 실제 데이터 주입) ======
const SIDO  = ["서울","경기","인천","부산","대구","광주","대전","울산","세종","강원","충북","충남","전북","전남","경북","경남","제주"];
const TYPES = ["아파트","다세대","단독주택","오피스텔"];

function genBuilding(id) {
  const trade  = +(rnd(3, 18).toFixed(1));                    // 3~18억
  const jeonse = +(rnd(trade * 0.5, trade * 0.9).toFixed(1)); // 50~90%
  const ltv    = +(rnd(0.4, 0.8).toFixed(2));                 // 40~80%
  return {
    id,
    // (A) 좌표 사용
    lat: rnd(37.45, 37.65),
    lng: rnd(126.80, 127.10),
    // (B) 주소 사용(지오코딩) - 예시
    // addr: "서울특별시 중구 세종대로 110",
    sido: SIDO[Math.floor(rnd(0, SIDO.length))],
    type: TYPES[Math.floor(rnd(0, TYPES.length))],
    trade_price_m: trade,
    deposit_m: jeonse,
    initial_ltv: ltv
  };
}
const buildings = Array.from({ length: 200 }, (_, i) => genBuilding(`BLDG_${i + 1}`));

// ====== 오버레이 템플릿 ======
const openOverlays = new Map(); // id -> overlay

function popupHTML(b, res) {
  const line1 = `<b>${b.type}</b> · ${b.sido}<br/>주택가액 ${fmtEok(b.trade_price_m)} · 전세가 ${fmtEok(b.deposit_m)} · 초기 LTV ${Math.round(b.initial_ltv * 100)}%`;
  const inputs = `
    <div style="margin-top:6px;display:grid;gap:6px">
      <label>선순위 금액(억)
        <input id="senior-${b.id}" type="number" step="0.1" min="0" style="width:100px;margin-left:6px">
      </label>
      <div class="row">
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
  return `<div class="overlay">${line1}<hr/>${inputs}${out}</div>`;
}

function wireOverlayEvents(b, circle, overlay) {
  const seniorEl = document.getElementById(`senior-${b.id}`);
  const startEl  = document.getElementById(`start-${b.id}`);
  const endEl    = document.getElementById(`end-${b.id}`);
  const btn      = document.getElementById(`go-${b.id}`);
  const outEl    = document.getElementById(`out-${b.id}`);

  if (!startEl.value) {
    startEl.value = ymNow();
    endEl.value = ymAdd(startEl.value, 24);
  }

  const trigger = () => {
    const senior  = parseFloat(seniorEl.value || '0');
    const startYM = startEl.value;
    const endYM   = endEl.value;
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
    const res = calcRisk(b, senior, startYM, endYM);
    circle.setOptions({ fillColor: colorBy(res.level), strokeColor: colorBy(res.level) });
    outEl.style.color = '';
    outEl.innerHTML =
      `<b>점수 ${res.score} / 100</b> · <span style="color:${colorBy(res.level)}">${res.level}</span><br/>
       LTV ${res.LTV}% · 전세비율 ${res.JR}% · 선순위비율 ${res.SR}% · 보증기간 ${res.months}개월`;
  };

  btn.addEventListener('click', trigger);
  [seniorEl, startEl, endEl].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') trigger(); }));
}

function openOverlayAt(b, circle, latLng) {
  if (openOverlays.has(b.id)) {
    openOverlays.get(b.id).setMap(null);
    openOverlays.delete(b.id);
  }
  const content = popupHTML(b, null);
  const overlay = new kakao.maps.CustomOverlay({ position: latLng, content, yAnchor: 1.12 });
  overlay.setMap(map);
  openOverlays.set(b.id, overlay);
  setTimeout(() => wireOverlayEvents(b, circle, overlay), 0);
}

function addCircleMarker(b, latLng) {
  const circle = new kakao.maps.Circle({
    center: latLng,
    radius: 20,
    strokeWeight: 2,
    strokeColor: '#777',
    strokeOpacity: 1,
    strokeStyle: 'solid',
    fillColor: '#777',
    fillOpacity: 0.85
  });
  circle.setMap(map);
  kakao.maps.event.addListener(circle, 'click', () => openOverlayAt(b, circle, latLng));
}

// ====== 주소 지오코딩 큐 (옵션) ======
const queue = []; // { b, resolve }
let ticking = false;

function geocodeAddressOnce(addr) {
  return new Promise(resolve => {
    geocoder.addressSearch(addr, (results, status) => {
      if (status === kakao.maps.services.Status.OK && results && results[0]) {
        const r = results[0];
        resolve(new kakao.maps.LatLng(+r.y, +r.x));
      } else {
        resolve(null);
      }
    });
  });
}
async function processQueue() {
  if (ticking) return;
  ticking = true;
  while (queue.length) {
    const { b, resolve } = queue.shift();
    const latLng = await geocodeAddressOnce(b.addr);
    resolve(latLng);
    await new Promise(r => setTimeout(r, 200)); // rate-limit 완화
  }
  ticking = false;
}
function geocodeQueued(b) {
  return new Promise(resolve => { queue.push({ b, resolve }); processQueue(); });
}

// ====== 렌더링 시작 ======
(async function renderAll() {
  for (const b of buildings) {
    if (b.addr) {
      const latLng = await geocodeQueued(b);
      if (latLng) addCircleMarker(b, latLng);
      // 실패 시 스킵. 원하면 fallback: addCircleMarker(b, new kakao.maps.LatLng(b.lat,b.lng))
    } else {
      addCircleMarker(b, new kakao.maps.LatLng(b.lat, b.lng));
    }
  }
})();

// 지도 클릭 시 열려있는 오버레이 닫기
kakao.maps.event.addListener(map, 'click', () => {
  for (const [, ov] of openOverlays) ov.setMap(null);
  openOverlays.clear();
});