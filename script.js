// ------- 地図の初期化（Web Mercator） -------
const map = L.map('map', {
  zoomControl: true,
  attributionControl: true
}).setView([36.2048, 138.2529], 5); // 日本の中心あたり

// 地理院タイル（標準・淡色・写真）
const gsiStd   = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',   { attribution: '地理院タイル', maxZoom: 18 });
const gsiPale  = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',  { attribution: '地理院タイル', maxZoom: 18 });
const gsiPhoto = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { attribution: '地理院タイル', maxZoom: 18 });

gsiStd.addTo(map);

// ベース切替
document.querySelectorAll('input[name="base"]').forEach(r => {
  r.addEventListener('change', () => {
    const v = r.value;
    [gsiStd, gsiPale, gsiPhoto].forEach(l => map.removeLayer(l));
    if (v === 'std') gsiStd.addTo(map);
    if (v === 'pale') gsiPale.addTo(map);
    if (v === 'photo') gsiPhoto.addTo(map);
  });
});

// ------- クリックで逆ジオコーディング → Wikipedia -------
const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";

function jpMunicipalityFromAddress(addr) {
  // 市区町村・特別区などの優先順位で名称を返す
  const candKeys = [
    'city_district', // 政令指定都市の区など
    'borough',       // 都市内の行政区
    'ward',          // 特別区や区
    'city',          // 市
    'town',          // 町
    'village'        // 村
  ];
  for (const k of candKeys) {
    if (addr[k]) return addr[k];
  }
  // それでも無ければ近いもの
  return addr.county || addr.suburb || addr.municipality || addr.town || addr.city || '';
}

function buildWikiTitle(addr) {
  // できるだけ “正式名称っぽい” 文字列に
  const muni = jpMunicipalityFromAddress(addr);
  // 一部ケースで「○○」だけ返るときがあるので、suffixを推定（弱めの推定）
  // ただし Nominatim 側が既に「渋谷区」「○○市」などサフィックス付きで返すことが多い
  let title = muni;

  // 例外的に title が空なら都道府県名でフォールバック
  if (!title && addr.state) title = addr.state;

  // 東京都の特別区で city が "Tokyo" / state が "東京都" の場合、ward や borough を優先しているのでOK
  return title;
}

function wikiUrlJa(title) {
  return `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

function showPopupAndOpen(latlng, title) {
  const html = `
    <div style="min-width:220px">
      <div style="font-weight:600;margin-bottom:6px;">${title ? `候補: ${title}` : '市区町村が特定できませんでした'}</div>
      <button id="openWiki" style="width:100%;padding:8px;border:none;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer;">
        Wikipediaを開く
      </button>
      <div style="font-size:11px;opacity:.75;margin-top:6px;">※ 正しくない場合は、ズームを上げて再度クリックしてください。</div>
    </div>
  `;
  const pop = L.popup({ maxWidth: 280 })
    .setLatLng(latlng)
    .setContent(html)
    .openOn(map);

  setTimeout(() => {
    const btn = document.getElementById('openWiki');
    if (!btn) return;
    btn.onclick = () => {
      const t = title && title.trim();
      const url = t ? wikiUrlJa(t) : 'https://ja.wikipedia.org';
      window.open(url, '_blank', 'noopener');
    };
  }, 0);
}

async function reverseAndOpen(e) {
  const { lat, lng } = e.latlng;
  // ローディング表示
  L.popup().setLatLng(e.latlng).setContent('検索中…').openOn(map);
  try {
    const url = new URL(NOMINATIM);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', lat);
    url.searchParams.set('lon', lng);
    url.searchParams.set('accept-language', 'ja'); // 日本語優先
    url.searchParams.set('zoom', '14'); // 市区町村レベルを狙う

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('Nominatim error');
    const data = await res.json();

    const addr = data.address || {};
    const title = buildWikiTitle(addr);
    showPopupAndOpen(e.latlng, title);
  } catch (err) {
    console.error(err);
    showPopupAndOpen(e.latlng, '');
  }
}

map.on('click', reverseAndOpen);

// ------- 検索欄：手入力でWikipediaを開く -------
document.getElementById('openBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) return;
  window.open(wikiUrlJa(name), '_blank', 'noopener');
});
document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('openBtn').click();
  }
});
