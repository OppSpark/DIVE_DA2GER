/* ---------------- 공통 UI ---------------- */
function setText(id, v) {
  document.getElementById(id).textContent = v && String(v).trim() ? v : "-";
}
function setInput(id, v) {
  const el = document.getElementById(id);
  el.value = v ?? "";
}
function getInputNumber(id) {
  const raw = document.getElementById(id).value;
  return parseKoreanMoney(raw);
}

/* ---------- 한국식 금액 파서 (억/만원/원, 쉼표, 공백 대응) ---------- */
// 예) "5억 3,000", "3.2억", "8억5000", "7,500만원", "550,000,000원"
function parseKoreanMoney(text) {
  if (!text) return NaN;
  let t = String(text).replace(/\s|원|,/g, "");

  // "만원" 형태
  if (t.includes("만원")) {
    t = t.replace("만원", "");
    const man = Number(t);
    return isNaN(man) ? NaN : man * 10_000;
  }

  // "억" 형태
  if (t.includes("억")) {
    const [eokPart, restPart = "0"] = t.split("억");
    const eok = Number(eokPart.replace(/[^\d.]/g, "")) || 0;
    const rest = Number(restPart.replace(/[^\d]/g, "")) || 0; // 보통 천 단위(예: 3,000)
    // rest가 4자리 이하이면 ‘만원’ 단위로 해석되는 경우가 많음 → 만원*1만
    // ex) 3,000 => 3,000만원 = 30,000,000원
    const restAsWon = rest < 10000 ? rest * 10_000 : rest;
    return eok * 100_000_000 + restAsWon;
  }

  // 그냥 숫자(원)로 가정
  const n = Number(t.replace(/[^\d.]/g, ""));
  return isNaN(n) ? NaN : n;
}

function formatMoney(n) {
  if (typeof n !== "number" || isNaN(n)) return "";
  return n.toLocaleString("ko-KR");
}

/* ---------- LTV = (대출액 / 매매가) * 100, 대출액=매매가의 70% ---------- */
function computeInitialLTVFromPrice(priceStr) {
  const price = parseKoreanMoney(priceStr);
  if (!isNaN(price) && price > 0) {
    const loan = price * 0.7;
    return { ltv: 70, loan, price };
  }
  return { ltv: null, loan: null, price: null };
}

/* ---------- 스크레이프 요청 ---------- */
async function requestScrape() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const data = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_NAVER_RE" })
    .catch(() => null);

  const result = data?.ok ? data.payload : {
    title: null, price: null, addr: null, area: null, floor: null, url: tab.url
  };

  // 화면 표시
  setText("title", result.title);
  setText("price", result.price);
  setText("addr", result.addr);
  setText("area", result.area);
  setText("floor", result.floor);

  // 주택가격/시도/주택구분 자동 입력 & 초기 LTV 계산
  autofillFromScrape(result);
  buildJson(); // JSON 영역 갱신
}

/* ---------- 자동 입력(요구사항에 맞춘 부분) ---------- */
function autofillFromScrape(res) {
  // 1) 주택가격 채우기(스크랩된 "가격"에서 '매매'로 보이는 값 우선)
  const priceStr = res.price || "";
  const { ltv, loan, price } = computeInitialLTVFromPrice(priceStr);
  if (price) setInput("housePrice", formatMoney(price));
  setInput("ltv", ltv ?? "");

  // 2) 시도 추정 (주소에서 첫 토큰: "서울특별시", "경기도" 등 → "서울", "경기" 정리 X, 그대로 둠)
  if (res.addr) {
    const firstToken = String(res.addr).split(/\s+/)[0] || "";
    setInput("sido", firstToken);
  }

  // 3) 주택구분 추정(간단 키워드)
  const whole = (res.title || "") + " " + (res.addr || "");
  const type =
    /아파트/i.test(whole) ? "아파트" :
    /오피스텔/i.test(whole) ? "오피스텔" :
    /다가구|단독/i.test(whole) ? "단독/다가구" :
    /빌라|연립/i.test(whole) ? "연립/빌라" : "";
  if (type) setInput("housingType", type);
}

/* ---------- JSON 생성 ---------- */
function buildJson() {
  const out = {
    scraped: {
      title: document.getElementById("title").textContent.trim(),
      price: document.getElementById("price").textContent.trim(),
      address: document.getElementById("addr").textContent.trim(),
      area: document.getElementById("area").textContent.trim(),
      floor: document.getElementById("floor").textContent.trim(),
    },
    input: {
      initialLTV: document.getElementById("ltv").value,
      guaranteeStartMonth: document.getElementById("guarStart").value || null,
      guaranteeEndMonth: document.getElementById("guarEnd").value || null,
      housePriceWon: getInputNumber("housePrice") || null,
      depositWon: getInputNumber("deposit") || null,
      seniorDebtWon: getInputNumber("seniorDebt") || null,
      sido: document.getElementById("sido").value || null,
      housingType: document.getElementById("housingType").value || null
    }
  };
  document.getElementById("json").value = JSON.stringify(out, null, 2);
}

/* ---------- 이벤트 바인딩 ---------- */
document.getElementById("refresh").addEventListener("click", requestScrape);
document.getElementById("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById("json").value);
    alert("복사되었습니다.");
  } catch {
    alert("복사 실패: 권한을 확인하세요.");
  }
});

// 값 변경 시 JSON 갱신 & LTV 재계산(주택가격 수정하는 경우)
["guarStart","guarEnd","deposit","seniorDebt","sido","housingType"].forEach(id => {
  document.getElementById(id).addEventListener("input", buildJson);
});
document.getElementById("housePrice").addEventListener("input", () => {
  const price = getInputNumber("housePrice");
  if (!isNaN(price) && price > 0) {
    // ‘매매가의 70%’ 가정 → LTV=70 고정. (필요하면 동적으로 loan/price 계산도 가능)
    setInput("ltv", "70");
  } else {
    setInput("ltv", "");
  }
  buildJson();
});

// “위험도 계산” 클릭: 현재는 입력값을 JSON에 반영만(실제 위험도 로직은 별도 설계 필요)
document.getElementById("calc").addEventListener("click", () => {
  // 여기서 추가 계산(예: 보증금+선순위 > 안전한도 등)을 구현 가능
  buildJson();
  alert("입력값이 JSON에 반영되었습니다. (위험도 산식은 별도 구현)");
});

document.addEventListener("DOMContentLoaded", requestScrape);

/* ---- (기존 도우미 함수들은 그대로) parseKoreanMoney/formatMoney 등 유지 ---- */

// 스크레이프 결과를 화면 및 입력에 반영
function applyScrapeToUI(res) {
  // 화면 표기
  setText("title", res.title);
  setText("price", res.price || (res.salePrice || res.jeonsePrice || "-"));
  setText("addr", res.addr);
  setText("area", res.area);
  setText("floor", res.floor);

  // 1) 주택가격 ← 매매가(salePrice)
  if (res.salePrice) {
    const won = parseKoreanMoney(res.salePrice);
    if (!isNaN(won) && won > 0) {
      setInput("housePrice", formatMoney(won));
      setInput("ltv", "70"); // 매매가 기준 LTV 70% 가정 고정
    }
  }

  // 2) 임대보증금 ← 전세가(jeonsePrice)
  if (res.jeonsePrice) {
    const won = parseKoreanMoney(res.jeonsePrice);
    if (!isNaN(won) && won > 0) {
      setInput("deposit", formatMoney(won));
    }
  }

  // 3) 시도(주소 첫 토큰)
  if (res.addr) {
    const firstToken = String(res.addr).split(/\s+/)[0] || "";
    setInput("sido", firstToken);
  }

  // 4) 주택구분(사이트에서 추출된 값 우선)
  if (res.housingType) {
    setInput("housingType", res.housingType);
  }

  buildJson();
}

async function requestScrape() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const data = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_NAVER_RE" })
    .catch(() => null);
  const res = data?.ok ? data.payload : null;
  if (res) applyScrapeToUI(res);
}

// 콘텐츠 스크립트의 실시간 업데이트 수신
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg?.type === "NAVER_RE_UPDATE" && msg.payload) {
    applyScrapeToUI(msg.payload);
  }
});

// 나머지 이벤트 바인딩/JSON 생성 로직은 이전 버전 그대로…