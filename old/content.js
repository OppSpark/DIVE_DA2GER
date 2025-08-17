// ------- 공통: 객체 DFS로 "부분키" 매칭되는 값 찾기 -------
function pickByKeyPart(obj, keyPartArr) {
  let found = null;
  (function dfs(o) {
    if (found || typeof o !== "object" || o === null) return;
    for (const [k, v] of Object.entries(o)) {
      if (found) break;
      const kl = k.toLowerCase();
      if (keyPartArr.some(p => kl.includes(p))) {
        if (["string", "number"].includes(typeof v)) { found = v; break; }
      }
      if (typeof v === "object") dfs(v);
    }
  })(obj);
  return found;
}

// ------- 금액 문자열 정리 -------
function cleanStr(s) {
  return (s == null) ? null : String(s).replace(/\s+/g, " ").trim();
}

// ------- __NEXT_DATA__에서 최대한 정석 추출 -------
function tryFromNextDataRich() {
  const script = document.getElementById("__NEXT_DATA__");
  if (!script?.textContent) return null;
  try {
    const j = JSON.parse(script.textContent);

    const title = pickByKeyPart(j, ["title", "name"]);
    const addr  = pickByKeyPart(j, ["address", "roadaddr", "complexname", "addr"]);
    const area  = pickByKeyPart(j, ["areaexclusive", "supplyarea", "area"]);
    const floor = pickByKeyPart(j, ["floorstr", "floor"]);

    // 가격들(문자열 우선)
    const sale  = pickByKeyPart(j, ["salepricestr", "dealprice", "saleprice", "매매"]);
    const jeonse = pickByKeyPart(j, ["jeonsepricestr", "jeonseprice", "전세"]);
    const monthlyDeposit = pickByKeyPart(j, ["depositstr", "deposit", "보증금"]);
    const monthlyRent    = pickByKeyPart(j, ["rentstr", "rentprice", "월세"]);

    // 주택구분(사이트에 보이는 항목)
    const housingType =
      pickByKeyPart(j, ["realestatetype", "realestatetypeName", "buildingtype", "articletypename", "housetype"]);

    return {
      title: cleanStr(title),
      addr: cleanStr(addr),
      area: cleanStr(area),
      floor: cleanStr(floor),
      price: null, // 화면 표시용 총괄은 fallback에서 채울 수 있음
      salePrice: cleanStr(sale),
      jeonsePrice: cleanStr(jeonse),
      monthlyDeposit: cleanStr(monthlyDeposit),
      monthlyRent: cleanStr(monthlyRent),
      housingType: cleanStr(housingType)
    };
  } catch (_) { /* ignore */ }
  return null;
}

// ------- 라벨/패턴 기반 보조(이전 로직과 유사) -------
function findValueByLabel(labels) {
  const xpath = (txt) =>
    `//*[self::dt or self::th or self::span or self::div or self::p][normalize-space()="${txt}"]`;
  for (const l of labels) {
    const node = document.evaluate(xpath(l), document, null,
      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!node) continue;
    const cand = [
      node.nextElementSibling,
      node.parentElement?.querySelector(".value, .data, dd, td, strong, b, span"),
    ].filter(Boolean);
    for (const el of cand) {
      const t = el.innerText?.trim();
      if (t) return t;
    }
  }
  return null;
}
function findByRegex(root, regex) {
  const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null, false);
  while (walker.nextNode()) {
    const t = walker.currentNode.nodeValue.trim();
    if (t && regex.test(t)) return t;
  }
  return null;
}
function scrapeFallback() {
  let title =
    document.querySelector('meta[property="og:title"]')?.content ||
    document.querySelector('h1, h2[class*="title"], .detail_title, .detailHeader_title')?.textContent ||
    document.title;
  let price =
    findValueByLabel(["가격", "거래가", "실거래가"]) ||
    findByRegex(document.body, /(보증금|월세|전세|매매|가격).*(억|만원|원)/);
  let addr =
    findValueByLabel(["주소", "도로명주소", "지번", "단지명"]) ||
    findByRegex(document.body, /(.*(시|군|구).*(동|로|길).*\d)/);
  let area =
    findValueByLabel(["전용면적", "공급면적", "면적"]) ||
    findByRegex(document.body, /(\d+(\.\d+)?\s*(㎡|m²|평))/i);
  let floor =
    findValueByLabel(["층", "해당층"]) ||
    findByRegex(document.body, /(\d+|저|중|고)층/);

  return {
    title: cleanStr(title),
    price: cleanStr(price),
    addr: cleanStr(addr),
    area: cleanStr(area),
    floor: cleanStr(floor),
    salePrice: null,
    jeonsePrice: null,
    monthlyDeposit: null,
    monthlyRent: null,
    housingType: null
  };
}

// ------- 메인 스크레이프 -------
function scrape() {
  const rich = tryFromNextDataRich();
  const base = rich || scrapeFallback();
  return { ...base, url: location.href };
}

// ------- 가격 영역 변화 감지 → 팝업으로 브로드캐스트 -------
function observePriceChanges() {
  // new.land.naver.com 상세의 가격 블록 추정 셀렉터(변경될 수 있음 → 루트 body 감시)
  const target = document.body;
  const mo = new MutationObserver(() => {
    const payload = scrape();
    chrome.runtime.sendMessage({ type: "NAVER_RE_UPDATE", payload });
  });
  mo.observe(target, { subtree: true, childList: true, characterData: true });
}

// ------- 메시지 처리 -------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "SCRAPE_NAVER_RE") {
    try {
      const payload = scrape();
      sendResponse({ ok: true, payload });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
});

// 시작
observePriceChanges();