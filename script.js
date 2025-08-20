// script.js
// 前提: data/N03-20250101.geojson が same-origin で fetch できる場所に置かれていること

const MAP_CENTER = [36.2048, 138.2529];
const map = L.map("map", { preferCanvas: true }).setView(MAP_CENTER, 5);

// 地理院タイル（Web Mercator）
L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
  attribution: "地理院タイル",
  maxZoom: 18
}).addTo(map);

// ユーティリティ: Wikipedia日本語ページURL
function wikiUrlJa(title) {
  return `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

// GeoJSON を読み込む
fetch('./data/N03-20250101.geojson')
  .then(res => {
    if (!res.ok) throw new Error('GeoJSON fetch failed: ' + res.status);
    return res.json();
  })
  .then(geojson => initVectorGrid(geojson))
  .catch(err => {
    console.error(err);
    alert('GeoJSON の読み込みに失敗しました。ローカルサーバー越しに配置しているか確認してください。\n例: python -m http.server で ./ を提供');
  });

// 市区町村名 -> featureIndex (簡易インデックス)
const nameIndex = new Map();
let fullBounds = null;

function initVectorGrid(geojson) {
  // 簡易インデックス作成（検索とズーム用）
  geojson.features.forEach(f => {
    // N03 のプロパティ名は環境によって異なることがあるため、複数候補で探す
    const props = f.properties || {};
    const name =
      props.N03_004 || // 市区町村名 (標準)
      props.N03_001 /* fallback */ || props.name || props.MUNICIPAL_NM || null;

    if (name) {
      if (!nameIndex.has(name)) nameIndex.set(name, []);
      nameIndex.get(name).push(f);
    }

    // 全体のBounds
    const b = L.geoJSON(f).getBounds();
    if (!fullBounds) fullBounds = b;
    else fullBounds.extend(b);
  });

  // -- Leaflet.VectorGrid を使って geojson-vt で高速描画 --
  // VectorGrid.Slicer は内部で geojson-vt を使うため巨大な GeoJSON を扱いやすい
  const vectorGrid = L.vectorGrid.slicer(geojson, {
    rendererFactory: L.canvas.tile,
    vectorTileLayerStyles: {
      // レイヤ名は自動で "slice" になる
      slice: function(properties, zoom){
        return {
          fill: true,
          fillColor: getFillColor(properties),
          fillOpacity: 0.25,
          stroke: true,
          color: "#2266cc",
          weight: 1
        };
      }
    },
    interactive: true, // クリック可能にする
    maxZoom: 18,
    pane: 'overlayPane'
  });

  vectorGrid.addTo(map);

  // クリックイベント（VectorGrid は feature の properties を渡す）
  vectorGrid.on('click', (e) => {
    // e.layer は VectorTileFeature のラッパー。properties に元の属性が入る。
    const props = e.layer && e.layer.properties ? e.layer.properties : (e.properties || {});
    const title = props.N03_004 || props.name || props.N03_001 || props.MUNICIPAL_NM || null;
    const latlng = e.latlng;

    // popup を出して Wikipedia を開けるボタンを表示
    const popupHtml = `
      <div style="min-width:220px">
        <div style="font-weight:600;margin-bottom:6px;">${title ? title : '（名称不明）'}</div>
        <div style="display:flex;gap:8px">
          <button id="openWiki" style="flex:1;padding:8px;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer">Wikipediaを開く</button>
          <button id="zoomTo" style="flex:1;padding:8px;border-radius:6px;border:1px solid #888;background:#fff;color:#222;cursor:pointer">この区域へズーム</button>
        </div>
      </div>
    `;
    const popup = L.popup({ maxWidth: 300 })
      .setLatLng(latlng)
      .setContent(popupHtml)
      .openOn(map);

    // イベントバインドは少し遅延して要素が DOM に入るのを待つ
    setTimeout(() => {
      const openBtn = document.getElementById('openWiki');
      if (openBtn) {
        openBtn.onclick = () => {
          const url = title ? wikiUrlJa(title) : 'https://ja.wikipedia.org';
          window.open(url, '_blank', 'noopener');
        };
      }
      const zoomBtn = document.getElementById('zoomTo');
      if (zoomBtn) {
        zoomBtn.onclick = () => {
          // e.layer の geometry がない場合に備えて簡易処理
          if (e.layer && e.layer.getBounds) {
            map.fitBounds(e.layer.getBounds());
          } else {
            map.setView(latlng, 12);
          }
          map.closePopup();
        };
      }
    }, 10);
  });

  // hover: ポイントオーバーでハイライト（pointermove で属性が来る）
  vectorGrid.on('mouseover', (e) => {
    // 軽く tooltip 表示
    const props = e.layer && e.layer.properties ? e.layer.properties : (e.properties || {});
    const name = props.N03_004 || props.name || props.N03_001 || '不明';
    const tip = L.tooltip({direction:'top',offset:[0,-8],sticky:false})
      .setLatLng(e.latlng)
      .setContent(`<div style="font-size:13px;padding:2px 6px">${name}</div>`);
    map.openTooltip(tip);
    // tooltip を閉じるため一時的に store
    vectorGrid._lastTooltip = tip;
  });
  vectorGrid.on('mouseout', (e) => {
    if (vectorGrid._lastTooltip) {
      map.closeTooltip(vectorGrid._lastTooltip);
      vectorGrid._lastTooltip = null;
    }
  });

  // 初期全体表示
  if (fullBounds) map.fitBounds(fullBounds);

  // 検索UIイベント
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('search').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') doSearch();
  });
  document.getElementById('zoomAll').addEventListener('click', () => {
    if (fullBounds) map.fitBounds(fullBounds);
    else map.setView(MAP_CENTER, 5);
  });
}

// 簡易的な塗り色をプロパティから決める（都道府県で色分けなど拡張可能）
function getFillColor(props) {
  // props.N03_001 が都道府県名の場合にハッシュして色を作る
  const key = props && (props.N03_001 || props.pref || props.PREF_NAME || 'x');
  let h = 0;
  for (let i=0;i<key.length;i++) h = (h<<5) - h + key.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  // HSL を返す（Leaflet へは CSS 色文字列でOK）
  return `hsl(${hue} 70% 55%)`;
}

// 検索処理（名前から該当フィーチャを特定し、ズーム）
function doSearch() {
  const q = document.getElementById('search').value.trim();
  if (!q) return alert('検索語を入力してください（例: 札幌市）');

  // 厳密一致 → 部分一致の順に探す
  const exact = nameIndex.get(q);
  if (exact && exact.length) {
    // 複数ヒットする可能性あり（同名複数）
    const feature = exact[0];
    // その feature の bounds を計算してズーム
    const b = L.geoJSON(feature).getBounds();
    map.fitBounds(b);
    // popup を出す（タイトルとWikiリンク）
    const props = feature.properties || {};
    const title = props.N03_004 || props.name || props.N03_001 || q;
    L.popup({maxWidth:300}).setLatLng(b.getCenter()).setContent(`<b>${title}</b><br><a href="${wikiUrlJa(title)}" target="_blank">Wikipediaを開く</a>`).openOn(map);
    return;
  }

  // 部分一致（contains）
  const lowerQ = q.toLowerCase();
  for (const [name, arr] of nameIndex.entries()) {
    if (name.toLowerCase().includes(lowerQ)) {
      const f = arr[0];
      const b = L.geoJSON(f).getBounds();
      map.fitBounds(b);
      const title = f.properties.N03_004 || f.properties.name || f.properties.N03_001 || name;
      L.popup({maxWidth:300}).setLatLng(b.getCenter()).setContent(`<b>${title}</b><br><a href="${wikiUrlJa(title)}" target="_blank">Wikipediaを開く</a>`).openOn(map);
      return;
    }
  }

  alert('該当する市区町村が見つかりませんでした。表記（市/区/町/村）を変えて試してください。');
}
