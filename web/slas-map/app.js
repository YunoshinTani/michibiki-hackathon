'use strict';

(() => {
  const localHosts = ['localhost', '127.0.0.1', '::1'];
  const REMOTE_VIEW = new URLSearchParams(window.location.search).get('view') === 'remote'
    || !localHosts.includes(window.location.hostname);
  const REMOTE_CGI_URL = new URL('gnss_api.cgi', window.location.href).toString();
  const POLL_INTERVAL_MS = 1000;
  const PORT_REFRESH_INTERVAL_MS = 5000;
  const INITIAL_VIEW = { center: [35, 138], zoom: 3 };
  const FOLLOW_ZOOM = 15;
  const TRACK_COLOR = '#0f6b63';
  const EMPTY = '--';
  const FIX_TYPE_LABELS = { 1: 'NO FIX', 2: '2D', 3: '3D' };
  const SERVER_DOWN = REMOTE_VIEW
    ? '学校サーバーの位置情報APIに接続できません。'
    : 'ローカルサーバーに接続できません。start.bat を起動してください。';
  const PYSERIAL_MISSING = 'pyserial が未導入です。setup.bat を実行してください。';

  const timeFormat = new Intl.DateTimeFormat('ja-JP', { timeStyle: 'medium' });

  // id を持つ要素を最初に一度だけ集めておく（毎秒の getElementById を避ける）
  const el = Object.fromEntries([...document.querySelectorAll('[id]')].map((node) => [node.id, node]));

  let map = null;
  let marker = null;
  let track = null;
  let icons = null;
  let lastPosition = null;
  let markerKey = '';
  let markerFixed = null;
  let trackKey = '';
  let centered = false;
  let mapAvailable = false;
  let connected = false;
  let serialUnavailable = false;
  let portsKey = null;

  const isNil = (value) => value === null || value === undefined;

  // 値が変わったときだけ DOM を書き換える
  function setText(id, value) {
    const node = el[id];
    if (node.textContent !== value) node.textContent = value;
  }

  function showMessage(message, isError = false) {
    setText('message', message);
    el.message.classList.toggle('error', isError);
  }

  function formatNumber(value, digits) {
    if (isNil(value) || value === '') return EMPTY;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(digits) : EMPTY;
  }

  function formatOrEmpty(value) {
    return isNil(value) ? EMPTY : String(value);
  }

  // ---------- 地図 ----------

  function initMap() {
    if (!window.L) {
      setText('map-message', '地図ライブラリを読み込めません。インターネット接続を確認してください。');
      return;
    }

    const makeIcon = (className) => L.divIcon({ className, iconSize: [18, 18] });
    icons = {
      fix: makeIcon('position-marker'),
      noFix: makeIcon('position-marker no-fix'),
    };

    map = L.map('map').setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    track = L.polyline([], { color: TRACK_COLOR, weight: 3, opacity: 0.85 }).addTo(map);
    mapAvailable = true;

    // レイアウトが変わって地図の大きさが変わったときに描画を合わせる
    new ResizeObserver(() => map.invalidateSize()).observe(el.map);
  }

  function isValidCoordinate(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  // 位置を表示できたら true を返す
  function renderPosition(data, trail) {
    const lat = Number(data.latitude);
    const lon = Number(data.longitude);
    if (!isValidCoordinate(lat, lon)) return false;

    lastPosition = [lat, lon];
    setText('latitude-value', `${lat.toFixed(7)}°`);
    setText('longitude-value', `${lon.toFixed(7)}°`);
    el['center-map'].disabled = false;
    if (!mapAvailable) return true;

    const fixed = Boolean(data.fix);
    const key = `${lat},${lon},${fixed}`;
    if (key !== markerKey) {
      markerKey = key;
      const popup = `${fixed ? '測位中' : 'Fixなし / 報告位置'}<br>${lat.toFixed(7)}, ${lon.toFixed(7)}`;
      if (!marker) {
        marker = L.marker(lastPosition, { icon: fixed ? icons.fix : icons.noFix }).bindPopup(popup).addTo(map);
      } else {
        marker.setLatLng(lastPosition).setPopupContent(popup);
        if (fixed !== markerFixed) marker.setIcon(fixed ? icons.fix : icons.noFix);
      }
      markerFixed = fixed;
    }

    // 軌跡は点が増えたときだけ描き直す
    const points = Array.isArray(trail) ? trail : [];
    const nextTrackKey = `${points.length}|${points[points.length - 1]}`;
    if (nextTrackKey !== trackKey) {
      trackKey = nextTrackKey;
      track.setLatLngs(points);
    }

    if (!centered) {
      map.setView(lastPosition, FOLLOW_ZOOM);
      centered = true;
    }
    return true;
  }

  // ---------- 画面の更新 ----------

  function renderConnection(snapshot) {
    const state = snapshot.error ? 'error' : connected ? 'connected' : 'idle';
    if (el['connection-status'].dataset.state !== state) el['connection-status'].dataset.state = state;
    setText('connection-label', connected ? `接続中 · ${snapshot.port}` : snapshot.error ? '接続エラー' : '未接続');
    el['connect-button'].disabled = connected;
    el['disconnect-button'].disabled = !connected;
  }

  function renderMetrics(data) {
    const fixed = Boolean(data.fix);
    const hasPosition = !isNil(data.latitude);
    const fixCard = el['fix-card'];
    const fixState = fixed ? 'fixed' : hasPosition ? 'nofix' : 'none';
    if (fixCard.dataset.fix !== fixState) fixCard.dataset.fix = fixState;

    setText('fix-value', fixed ? 'FIX' : hasPosition ? 'NO FIX' : EMPTY);
    setText('fix-detail', fixed ? '位置を測位しています' : '有効な測位を待っています');
    setText('satellites-value', formatOrEmpty(data.satellites));
    setText('altitude-value', formatNumber(data.altitude, 1));
    setText('speed-value', formatNumber(data.speed_kmh, 1));
    setText('course-value', isNil(data.course) ? '方位 --' : `方位 ${formatNumber(data.course, 1)}°`);
    setText('utc-value', data.utc_time || '--:--:--');
  }

  function renderQuality(data) {
    // null を Number() に通すと 0 になるため、未受信は先に除外する
    const hdop = isNil(data.hdop) ? NaN : Number(data.hdop);
    const hasHdop = Number.isFinite(hdop);
    const meter = el['hdop-meter'];
    const width = hasHdop ? `${Math.max(3, Math.min(100, 100 / Math.max(hdop, 0.2)))}%` : '0%';
    if (meter.style.width !== width) meter.style.width = width;
    const level = hasHdop && hdop > 2 ? 'warn' : 'good';
    if (meter.dataset.level !== level) meter.dataset.level = level;

    setText('hdop-value', formatNumber(data.hdop, 2));
    setText('quality-badge', isNil(data.gnsa_fix_type) ? EMPTY : FIX_TYPE_LABELS[data.gnsa_fix_type] || 'UNKNOWN');
    setText('quality-value', formatOrEmpty(data.fix_quality));
    setText('mode-value', data.fix_mode || EMPTY);
    setText('type-value', formatOrEmpty(data.gnsa_fix_type));
    setText('date-value', data.utc_date || EMPTY);
  }

  function renderStats(snapshot) {
    const stats = snapshot.stats || {};
    const data = snapshot.data || {};
    setText('received-value', String(stats.received || 0));
    setText('valid-value', String(stats.valid || 0));
    setText('checksum-value', String(stats.bad_checksum || 0));
    setText('malformed-value', String(stats.malformed || 0));
    setText('unknown-value', String(stats.unknown || 0));
    setText('noise-value', String(snapshot.noise_bytes || 0));
    setText('battery-value', isNil(data.battery) ? EMPTY : `${formatNumber(data.battery, 2)} V*`);
    setText('mag-value', Array.isArray(data.mag) && data.mag.length ? data.mag.join(', ') : EMPTY);
    setText('updated-value', snapshot.last_update ? timeFormat.format(new Date(snapshot.last_update * 1000)) : EMPTY);
  }

  function renderMessage(snapshot) {
    if (snapshot.error) {
      showMessage(snapshot.error, true);
    } else if (connected) {
      showMessage(snapshot.last_update ? 'NMEAデータを受信しています。' : 'ポートに接続しました。NMEAデータを待っています。');
    } else if (REMOTE_VIEW) {
      showMessage('Windows PCからの位置データを待っています。');
    } else if (serialUnavailable) {
      showMessage(PYSERIAL_MISSING, true);
    }
  }

  function render(snapshot) {
    const data = snapshot.data || {};
    const wasConnected = connected;
    connected = Boolean(snapshot.connected);
    if (connected && !wasConnected) {
      // 新しい接続では軌跡が消えるので、最初の位置で地図を合わせ直す
      centered = false;
      trackKey = '';
    }

    renderConnection(snapshot);
    renderMetrics(data);
    renderQuality(data);
    renderStats(snapshot);

    const hasPosition = !isNil(data.latitude) && !isNil(data.longitude);
    if (hasPosition) {
      if (renderPosition(data, snapshot.trail) && mapAvailable) el['map-message'].hidden = true;
    } else if (!connected && mapAvailable) {
      el['map-message'].hidden = false;
    }
    renderMessage(snapshot);
  }

  // ---------- サーバーとの通信 ----------

  function apiUrl(action) {
    return REMOTE_VIEW
      ? `${REMOTE_CGI_URL}?action=${encodeURIComponent(action)}`
      : `/api/${action}`;
  }

  async function refreshPorts(manual) {
    try {
      const response = await fetch('/api/ports', { cache: 'no-store' });
      const result = await response.json();
      const ports = result.ports || [];
      serialUnavailable = !result.available;

      // 一覧が変わったときだけ作り直す（開いているプルダウンが閉じてしまうのを防ぐ）
      const key = ports.map((item) => `${item.device}\t${item.description}`).join('\n');
      const changed = key !== portsKey;
      if (changed) {
        portsKey = key;
        const select = el['port-select'];
        const previous = select.value;
        const options = ports.map((item) => new Option(`${item.device} — ${item.description}`, item.device));
        select.replaceChildren(new Option('ポートを選択', ''), ...options);
        if (options.some((option) => option.value === previous)) select.value = previous;
      }

      if (serialUnavailable) {
        showMessage(PYSERIAL_MISSING, true);
      } else if (manual || changed) {
        showMessage(
          ports.length
            ? `検出: ${ports.map((item) => item.device).join(', ')}。ポートを選択してください。`
            : 'シリアルポートが見つかりません。受信機を接続してください。',
        );
      }
    } catch (error) {
      showMessage(SERVER_DOWN, true);
    }
  }

  async function pollState() {
    try {
      const response = await fetch(apiUrl('state'), { cache: 'no-store' });
      if (!response.ok) throw new Error('位置情報APIからエラーが返されました。');
      render(await response.json());
    } catch (error) {
      showMessage(SERVER_DOWN, true);
    }
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '接続できませんでした。');
    return result;
  }

  async function connectDevice() {
    const port = el['port-select'].value;
    const baud = Number(el['baud-input'].value);
    if (!port) {
      showMessage('シリアルポートを選択してください。', true);
      return;
    }
    el['connect-button'].disabled = true;
    showMessage('接続しています…');
    try {
      await postJson('/api/connect', { port, baud });
      await pollState();
    } catch (error) {
      showMessage(error.message, true);
      el['connect-button'].disabled = connected;
    }
  }

  async function disconnectDevice() {
    try {
      await postJson('/api/disconnect', {});
      await pollState();
      showMessage('切断しました。');
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  // 前のリクエストが終わってから次を待つ（応答が遅くても重ならない）
  async function pollLoop() {
    for (;;) {
      if (!document.hidden) await pollState();
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  function init() {
    initMap();
    if (REMOTE_VIEW) {
      el['serial-controls'].hidden = true;
      setText('site-title', 'GNSS 遠隔モニター');
      setText('map-instructions', 'Windows PCから位置データが届くと、現在地と軌跡を表示します');
      setText('footer-mode', '位置情報は接続中のWindows PCから学校サーバーへ送信されます。');
      document.title = 'GNSS 遠隔モニター';
    } else {
      el['connect-button'].addEventListener('click', connectDevice);
      el['disconnect-button'].addEventListener('click', disconnectDevice);
      el['refresh-ports'].addEventListener('click', () => refreshPorts(true));
      refreshPorts(true);
      setInterval(() => {
        if (!connected && !document.hidden) refreshPorts(false);
      }, PORT_REFRESH_INTERVAL_MS);
    }
    el['center-map'].addEventListener('click', () => {
      if (map && lastPosition) map.setView(lastPosition, Math.max(map.getZoom(), FOLLOW_ZOOM));
    });

    pollLoop();
  }

  init();
})();
