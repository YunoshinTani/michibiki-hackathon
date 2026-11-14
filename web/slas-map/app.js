'use strict';

(() => {
  const localHosts = ['localhost', '127.0.0.1', '::1'];
  const REMOTE_VIEW = new URLSearchParams(window.location.search).get('view') === 'remote'
    || !localHosts.includes(window.location.hostname);
  const REMOTE_CGI_URL = new URL('gnss_api.cgi', window.location.href).toString();
  const POLL_INTERVAL_MS = 1000;
  const PORT_REFRESH_INTERVAL_MS = 5000;
  const SESSION_REFRESH_INTERVAL_MS = 5000;
  const INITIAL_VIEW = { center: [35, 138], zoom: 3 };
  const FOLLOW_ZOOM = 15;
  const TRACK_COLOR = '#2563eb';
  const COMPARISON_COLOR = '#c2410c';
  const EMPTY = '--';
  const FIX_TYPE_LABELS = { 1: 'NO FIX', 2: '2D', 3: '3D' };
  const SERVER_DOWN = REMOTE_VIEW
    ? 'yahikoサーバーの位置情報APIに接続できません。'
    : 'ローカルサーバーに接続できません。start.bat を起動してください。';
  const PYSERIAL_MISSING = 'pyserial が未導入です。setup.bat を実行してください。';

  const timeFormat = new Intl.DateTimeFormat('ja-JP', { timeStyle: 'medium' });
  const sessionTimeFormat = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
  const timelineTimeFormat = new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Tokyo',
  });

  // id を持つ要素を最初に一度だけ集めておく（毎秒の getElementById を避ける）
  const el = Object.fromEntries([...document.querySelectorAll('[id]')].map((node) => [node.id, node]));

  let map = null;
  let marker = null;
  let track = null;
  let comparisonTrack = null;
  let comparisonMarker = null;
  let accuracyCircle = null;
  let latestSnapshot = null;
  let icons = null;
  let lastPosition = null;
  let markerKey = '';
  let markerFixed = null;
  let trackKey = '';
  let renderedTrackPointCount = 0;
  let centered = false;
  let mapAvailable = false;
  let connected = false;
  let serialUnavailable = false;
  let portsKey = null;
  let selectedSessionId = null;
  let selectedTracks = {};
  let sessionListKey = null;
  let lastSessionsRefresh = 0;
  let selectionToken = 0;
  let shareFeedbackTimer = null;
  let newestSessionId = null;
  let linkedSessionId = REMOTE_VIEW ? new URLSearchParams(window.location.search).get('record') : null;
  let followLatestSession = true;
  let timelineOffset = null;
  let replayRequest = null;
  let replayTimer = null;
  let playbackFrame = null;
  let playbackTime = null;
  let playbackFocus = null;
  let activeTab = REMOTE_VIEW ? 'graph' : 'information';
  let chart = null;
  let telemetry = null;
  let routeSummary = null;
  let graphData = null;
  let analysisKey = '';
  let comparisonSummaryKey = '';
  let replayPositions = {};
  const timelineMarkers = {};

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
    comparisonTrack = L.polyline([], { color: COMPARISON_COLOR, weight: 3, dashArray: '7 5' });
    mapAvailable = true;

    // レイアウトが変わって地図の大きさが変わったときに描画を合わせる
    new ResizeObserver(() => map.invalidateSize()).observe(el.map);
  }

  function isValidCoordinate(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function coordinates(data) {
    return data && isValidCoordinate(data.latitude, data.longitude)
      ? [data.latitude, data.longitude] : null;
  }

  const metresBetween = GNSSHistory.distance;

  function renderComparisonDetails(snapshot, replaying = false) {
    if (activeTab !== 'gps') return;
    const mode = replaying ? latestSnapshot?.comparison_mode : snapshot?.comparison_mode;
    el['comparison-panel'].hidden = !mode;
    el['comparison-empty'].hidden = Boolean(mode);
    if (!mode) return;

    const label = mode === 'gps' ? 'GPS 単独（比較用受信機）' : 'PC の推定位置';
    const sample = snapshot?.comparison;
    const point = replaying ? replayPositions.comparison : coordinates(sample);
    const qz1 = replaying ? replayPositions.qz1 : snapshot?.data?.fix ? coordinates(snapshot.data) : null;
    const age = snapshot?.connected ? Date.now() / 1000 - sample?.timestamp : 0;
    const qz1Time = replaying ? qz1?.[2] : snapshot?.position_at;
    const otherTime = replaying ? point?.[2] : sample?.timestamp;
    const paired = point && qz1 && Math.abs(qz1Time - otherTime) <= 5 && age <= 10;
    const accuracy = sample?.accuracy;
    setText('comparison-source', label);
    setText('comparison-method', mode === 'gps'
      ? 'QZ1 と GPS 単独受信機を比較します。'
      : '比較側は PC の推定位置です。Wi-Fi などの情報が含まれる場合があります。');
    setText('comparison-position', point
      ? point.slice(0, 2).map((value) => value.toFixed(7) + '°').join(', ') + (age > 10 ? '（最終取得位置）' : '')
      : replaying ? '未記録' : '取得待ち');
    setText('comparison-accuracy', Number.isFinite(accuracy) ? `${accuracy.toFixed(1)} m` : '—');
    setText('comparison-distance', paired ? `${metresBetween(qz1, point).toFixed(1)} m` : '—');

    const lat = el['reference-lat'].valueAsNumber;
    const lon = el['reference-lon'].valueAsNumber;
    setText('reference-result', paired && isValidCoordinate(lat, lon)
      ? `QZ1 ${metresBetween(qz1, [lat, lon]).toFixed(1)} m ／ ${label} ${metresBetween(point, [lat, lon]).toFixed(1)} m`
      : '—');
  }

  function renderComparisonMap(snapshot) {
    if (!mapAvailable) return;
    const mode = snapshot?.comparison_mode;
    if (!mode || activeTab !== 'gps') {
      comparisonTrack.remove();
      comparisonMarker?.remove();
      accuracyCircle?.remove();
      return;
    }
    if (!map.hasLayer(comparisonTrack)) comparisonTrack.addTo(map);
    const label = mode === 'gps' ? 'GPS 単独（比較用受信機）' : 'PC の推定位置';
    const point = coordinates(snapshot.comparison);
    const accuracy = snapshot.comparison?.accuracy;
    const points = selectedTracks.comparison.points;
    if (comparisonTrack.getLatLngs().length !== points.length) comparisonTrack.setLatLngs(points);
    if (point) {
      if (!comparisonMarker) {
        comparisonMarker = L.circleMarker(point, { color: '#fff', fillColor: COMPARISON_COLOR,
          fillOpacity: 1, radius: 7 }).bindTooltip(label).addTo(map);
      } else {
        comparisonMarker.setLatLng(point);
      }
      if (timelineOffset === null && !map.hasLayer(comparisonMarker)) comparisonMarker.addTo(map);
      if (Number.isFinite(accuracy)) {
        if (!accuracyCircle) {
          accuracyCircle = L.circle(point, { color: COMPARISON_COLOR, weight: 1,
            fillOpacity: 0.08, interactive: false }).addTo(map);
        }
        accuracyCircle.setLatLng(point).setRadius(accuracy);
        if (timelineOffset === null && !map.hasLayer(accuracyCircle)) accuracyCircle.addTo(map);
      } else {
        accuracyCircle?.remove();
        accuracyCircle = null;
      }
      if (!centered) {
        map.setView(point, FOLLOW_ZOOM);
        centered = true;
      }
      el['map-message'].hidden = true;
    } else {
      comparisonMarker?.remove();
      accuracyCircle?.remove();
      comparisonMarker = accuracyCircle = null;
    }
  }

  // 位置を表示できたら true を返す
  function renderPosition(data, trail, replaying) {
    const lat = Number(data.latitude);
    const lon = Number(data.longitude);
    if (!isValidCoordinate(lat, lon)) return false;

    lastPosition = [lat, lon];
    if (!replaying) {
      setText('latitude-value', `${lat.toFixed(7)}°`);
      setText('longitude-value', `${lon.toFixed(7)}°`);
    }
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
      if (points.length - renderedTrackPointCount > 1000 || renderedTrackPointCount > points.length) {
        track.setLatLngs(points);
      } else {
        for (let index = renderedTrackPointCount; index < points.length; index += 1) {
          track.addLatLng(points[index]);
        }
      }
      renderedTrackPointCount = points.length;
      trackKey = nextTrackKey;
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
    const label = connected ? `QZ1 接続中 · ${snapshot.port}` : snapshot.error ? 'QZ1 接続エラー' : 'QZ1 未接続';
    setText('connection-label', label);
    el['connect-button'].disabled = connected;
    el['disconnect-button'].disabled = !connected;
  }

  function renderMetrics(data, replaying = false) {
    const fixed = Boolean(data.fix);
    const hasPosition = !isNil(data.latitude);
    const fixCard = el['fix-card'];
    const noFix = replaying ? data.fix === false : hasPosition && !fixed;
    const fixState = fixed ? 'fixed' : noFix ? 'nofix' : 'none';
    if (fixCard.dataset.fix !== fixState) fixCard.dataset.fix = fixState;

    setText('fix-value', fixed ? 'FIX' : noFix ? 'NO FIX' : EMPTY);
    const fixDetail = replaying
      ? fixed ? '測位あり' : noFix ? '有効な測位なし' : '未記録'
      : fixed ? '位置を測位しています' : '有効な測位を待っています';
    setText('fix-detail', fixDetail);
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

  function renderStats(snapshot, replaying = false) {
    const stats = snapshot.stats || {};
    const data = snapshot.data || {};
    const counter = (value) => formatOrEmpty(value ?? (replaying && !snapshot.stats ? null : 0));
    setText('received-value', counter(stats.received));
    setText('valid-value', counter(stats.valid));
    setText('checksum-value', counter(stats.bad_checksum));
    setText('malformed-value', counter(stats.malformed));
    setText('unknown-value', counter(stats.unknown));
    setText('noise-value', replaying ? formatOrEmpty(snapshot.noise_bytes) : String(snapshot.noise_bytes || 0));
    const battery = formatNumber(data.battery, 2);
    setText('battery-value', battery === EMPTY ? EMPTY : `${battery} V`);
    setText('mag-value', Array.isArray(data.mag) && data.mag.length ? data.mag.join(', ') : EMPTY);
    setText('updated-value', snapshot.last_update ? timeFormat.format(new Date(snapshot.last_update * 1000)) : EMPTY);
  }

  function renderMessage(snapshot) {
    if (snapshot.error) {
      showMessage(snapshot.error, true);
    } else if (connected) {
      showMessage(snapshot.last_update ? 'NMEAデータを受信しています。' : 'ポートに接続しました。NMEAデータを待っています。');
    } else if (REMOTE_VIEW && selectedSessionId) {
      showMessage('記録済みの位置情報を表示しています。');
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
    const replaying = timelineOffset !== null;
    if (connected && !wasConnected) {
      // 新しい接続では軌跡が消えるので、最初の位置で地図を合わせ直す
      centered = false;
      trackKey = '';
      renderedTrackPointCount = 0;
      if (track) track.setLatLngs([]);
    }

    renderConnection(snapshot);
    setText('equipment-port', formatOrEmpty(snapshot.port));
    setText('equipment-baud', snapshot.baud ? `${snapshot.baud.toLocaleString('ja-JP')} baud` : EMPTY);
    if (!replaying) {
      el['position-time-row'].hidden = true;
      renderMetrics(data);
      renderQuality(data);
      renderStats(snapshot);
    }

    const hasPosition = !isNil(data.latitude) && !isNil(data.longitude);
    if (hasPosition) {
      if (renderPosition(data, snapshot.trail, replaying) && mapAvailable) el['map-message'].hidden = true;
    } else if (!connected && mapAvailable) {
      el['map-message'].hidden = false;
    }
    if (REMOTE_VIEW) {
      if (!replaying) renderComparisonDetails(snapshot);
      renderComparisonMap(snapshot);
    }
    if (mapAvailable) {
      el['fit-map'].disabled = !track.getBounds().isValid()
        && !(activeTab === 'gps' && comparisonTrack.getBounds().isValid());
    }
    renderMessage(snapshot);
  }

  // ---------- サーバーとの通信 ----------

  function apiUrl(action, params = {}) {
    if (!REMOTE_VIEW) return `/api/${action}`;
    const url = new URL(REMOTE_CGI_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  async function fetchJson(action, params = {}) {
    const response = await fetch(apiUrl(action, params), { cache: 'no-store' });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || 'サーバーからエラーが返されました。');
    }
    return response.json();
  }

  function sessionOptionLabel(session) {
    const timestamp = Number(session.started_at);
    const date = Number.isFinite(timestamp)
      ? sessionTimeFormat.format(new Date(timestamp * 1000))
      : '日時不明';
    const status = session.connected ? '送信中' : '終了';
    const imported = session.legacy ? '既存記録 · ' : '';
    return `${imported}${date} · ${status}`;
  }

  function resetSelectedRecord() {
    selectedTracks = {
      qz1: { points: [], samples: [], count: 0, offset: 0 },
      comparison: { points: [], samples: [], count: 0, offset: 0 },
    };
    timelineOffset = null;
    pausePlayback();
    el['play-record'].disabled = true;
    el['gps-slider'].disabled = true;
    el['gps-slider'].max = '0';
    el['gps-slider'].value = '0';
    clearTimeout(replayTimer);
    replayRequest = null;
    latestSnapshot = null;
    el['timeline-latest'].disabled = true;
    el['graph-latest'].disabled = true;
    el['timeline-single'].hidden = true;
    telemetry = { rows: [], after: -1, loadedThrough: null, loading: false, failed: false };
    routeSummary = null;
    graphData = null;
    analysisKey = '';
    comparisonSummaryKey = '';
    replayPositions = {};
    el['graph-playback'].hidden = true;
    setText('graph-time', EMPTY);
    setText('graph-status', selectedSessionId ? '記録を読み込んでいます。' : '表示できる記録がありません。');
    for (const metric of ['speed', 'altitude', 'distance']) setText(`graph-${metric}`, EMPTY);
    el['history-timeline'].hidden = true;
    trackKey = '';
    renderedTrackPointCount = 0;
    markerKey = '';
    markerFixed = null;
    centered = false;
    lastPosition = null;
    renderMetrics({}, true);
    renderQuality({});
    renderStats({}, true);
    setText('latitude-value', EMPTY);
    setText('longitude-value', EMPTY);
    el['position-time-row'].hidden = true;
    if (track) track.setLatLngs([]);
    if (marker && map) map.removeLayer(marker);
    marker = null;
    comparisonTrack?.setLatLngs([]);
    comparisonMarker?.remove();
    accuracyCircle?.remove();
    comparisonMarker = accuracyCircle = null;
    updateTimelineMarkers({}, false, false);
    renderComparisonDetails(null);
    el['center-map'].disabled = true;
    el['fit-map'].disabled = true;
  }

  function selectRemoteSession(sessionId) {
    if (sessionId === selectedSessionId) return;
    selectedSessionId = sessionId || null;
    selectionToken += 1;
    resetSelectedRecord();
    el['share-record'].disabled = !selectedSessionId;
    resetShareFeedback();
    el['record-link'].hidden = true;
    el['record-link'].value = '';
    setText('share-status', '');
    el['history-status'].textContent = selectedSessionId ? '経路を読み込んでいます…' : '記録を待っています。';
  }

  function resetShareFeedback() {
    clearTimeout(shareFeedbackTimer);
    const button = el['share-record'];
    el['share-icon'].removeAttribute('hidden');
    el['share-check'].setAttribute('hidden', '');
    button.setAttribute('aria-label', '記録のリンクをコピー');
    button.title = '記録のリンクをコピー';
  }

  async function copyRecordLink() {
    if (!selectedSessionId) return;
    const token = selectionToken;
    const url = new URL(window.location.href);
    url.searchParams.set('record', selectedSessionId);
    const field = el['record-link'];
    try {
      await navigator.clipboard.writeText(url.href);
      if (token !== selectionToken) return;
      field.hidden = true;
      setText('share-status', '');
      resetShareFeedback();
      el['share-icon'].setAttribute('hidden', '');
      el['share-check'].removeAttribute('hidden');
      const button = el['share-record'];
      button.setAttribute('aria-label', '記録のリンクをコピー済み');
      button.title = '記録のリンクをコピー済み';
      shareFeedbackTimer = setTimeout(resetShareFeedback, 2000);
    } catch {
      if (token !== selectionToken) return;
      resetShareFeedback();
      field.value = url.href;
      field.hidden = false;
      field.focus();
      field.select();
      setText('share-status', '表示されたリンクをコピーしてください。');
    }
  }

  async function refreshSessions() {
    const result = await fetchJson('sessions');
    const sessions = Array.isArray(result.sessions) ? result.sessions : [];
    lastSessionsRefresh = Date.now();
    const key = sessions.map((item) => `${item.id}|${item.started_at}|${item.connected}`).join('\n');
    if (key === sessionListKey) return;
    sessionListKey = key;

    const select = el['history-select'];
    const previous = selectedSessionId;
    const options = sessions.map((session) => new Option(sessionOptionLabel(session), session.id));
    const missingLinkedRecord = linkedSessionId && !sessions.some((session) => session.id === linkedSessionId);
    if (missingLinkedRecord) {
      const placeholder = new Option('リンク先の記録が見つかりません', '');
      placeholder.disabled = true;
      options.unshift(placeholder);
    } else if (!options.length) {
      options.push(new Option('記録がありません', ''));
    }
    select.replaceChildren(...options);

    newestSessionId = sessions.length ? sessions[0].id : null;
    const keepPrevious = sessions.some((session) => session.id === previous);
    let nextId = followLatestSession || !keepPrevious ? newestSessionId : previous;
    if (linkedSessionId) nextId = missingLinkedRecord ? null : linkedSessionId;
    select.value = nextId || '';
    if (nextId !== selectedSessionId) selectRemoteSession(nextId);
    if (missingLinkedRecord) {
      setText('history-status', '共有リンクの記録を表示できません。');
    } else if (!sessions.length) {
      el['history-status'].textContent = '送信元から新しい記録が届くと、ここに表示されます。';
      showMessage('Windows PCからの位置データを待っています。');
    }
  }

  async function loadSelectedTrack(token, source) {
    const record = selectedTracks[source];
    let hasMore = true;
    while (hasMore && token === selectionToken && selectedSessionId
        && (source === 'qz1' || activeTab === 'gps')) {
      const result = await fetchJson('track', { id: selectedSessionId, source, offset: record.offset, timed: 1 });
      if (token !== selectionToken || (source === 'comparison' && activeTab !== 'gps')) return;
      const points = Array.isArray(result.points) ? result.points : [];
      let outOfOrder = false;
      record.count += points.length;
      for (const point of points) {
        const [lat, lon, timestamp] = point;
        const previousPoint = record.points[record.points.length - 1];
        if (!previousPoint || previousPoint[0] !== lat || previousPoint[1] !== lon) {
          record.points.push([lat, lon]);
        }
        if (Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= 8640000000000) {
          const previous = record.samples[record.samples.length - 1];
          if (previous && previous[2] > timestamp) outOfOrder = true;
          record.samples.push(point);
        }
      }
      if (outOfOrder) record.samples.sort((a, b) => a[2] - b[2]);
      const nextOffset = Number(result.next_offset);
      hasMore = Boolean(result.has_more);
      if (!Number.isFinite(nextOffset) || nextOffset <= record.offset) hasMore = false;
      else record.offset = nextOffset;
    }
  }

  function sampleBefore(samples, timestamp) {
    return samples[GNSSHistory.before(samples, timestamp, 2) - 1];
  }

  function updateTimelineMarkers(positions, active, pan) {
    if (!mapAvailable) return;
    for (const layer of [marker, comparisonMarker, accuracyCircle]) {
      if (!layer) continue;
      if (active || (layer !== marker && activeTab !== 'gps')) {
        if (map.hasLayer(layer)) layer.remove();
      }
      else if (!map.hasLayer(layer)) layer.addTo(map);
    }
    for (const [source, color] of [['qz1', TRACK_COLOR], ['comparison', COMPARISON_COLOR]]) {
      const point = active && positions[source];
      if (!point) {
        timelineMarkers[source]?.remove();
        delete timelineMarkers[source];
      } else {
        if (!timelineMarkers[source]) {
          timelineMarkers[source] = L.circleMarker([point[0], point[1]], {
            color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, radius: 8,
          }).bindTooltip(source === 'qz1' ? 'QZ1の記録位置' : '比較側の記録位置').addTo(map);
        }
        const current = timelineMarkers[source].getLatLng();
        if (current.lat !== point[0] || current.lng !== point[1]) {
          timelineMarkers[source].setLatLng([point[0], point[1]]);
        }
      }
    }
    const focus = positions.qz1 || positions.comparison;
    if (active && focus) {
      el['map-message'].hidden = true;
      if (pan && (playbackFocus?.[0] !== focus[0] || playbackFocus?.[1] !== focus[1])) {
        map.panTo([focus[0], focus[1]], { animate: false });
        playbackFocus = focus;
      }
    }
  }

  function renderReplayDetails(request, fallbackPosition) {
    const sample = request.sample;
    const data = sample?.data || {};
    renderMetrics(data, true);
    renderQuality(data);
    renderStats(sample || {}, true);
    renderComparisonDetails(sample, true);
    setText('latitude-value', fallbackPosition ? `${fallbackPosition[0].toFixed(7)}°` : EMPTY);
    setText('longitude-value', fallbackPosition ? `${fallbackPosition[1].toFixed(7)}°` : EMPTY);
    el['position-time-row'].hidden = !fallbackPosition;
    if (fallbackPosition) setText('position-time', timelineTimeFormat.format(fallbackPosition[2] * 1000));
    setText('timeline-details', request.status);
  }

  function timelineBounds() {
    const { qz1, comparison } = selectedTracks;
    const tracks = activeTab === 'gps' ? [qz1, comparison] : [qz1];
    const session = latestSnapshot?.session;
    let first = session?.first_sample_at ?? Infinity;
    let last = session?.last_sample_at ?? -Infinity;
    for (const { samples } of tracks) {
      first = Math.min(first, samples[0]?.[2] ?? Infinity);
      last = Math.max(last, samples[samples.length - 1]?.[2] ?? -Infinity);
    }
    return Number.isFinite(first) && Number.isFinite(last) ? { first, last } : null;
  }

  const measurement = (value, unit, digits = 1) => Number.isFinite(value)
    ? `${value.toFixed(digits)} ${unit}` : EMPTY;
  const elapsed = (value) => {
    const seconds = Math.round(value);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const pace = (speed) => {
    if (!(speed > 0)) return EMPTY;
    const seconds = Math.round(3600 / speed);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} 分/km`;
  };

  function qz1Route() {
    const record = selectedTracks.qz1;
    if (!routeSummary || routeSummary.count !== record.count) {
      routeSummary = { count: record.count, ...GNSSHistory.route(record) };
      graphData = null;
    }
    return routeSummary;
  }

  function seriesStatus() {
    if (telemetry.loading) return 'グラフ用の測位情報を読み込んでいます。';
    if (telemetry.failed) return '速度・高度の履歴を取得できません。';
    if (!telemetry.rows.length) return '速度・高度の履歴は未記録です。';
    return '';
  }

  function renderGraph(bounds, second) {
    if (activeTab !== 'graph') return;
    const route = qz1Route();
    const rows = telemetry.rows;
    el['graph-playback'].hidden = !bounds;
    setText('graph-status', bounds ? seriesStatus() : 'この記録には時刻付きのデータがありません。');
    if (!bounds) {
      setText('graph-time', EMPTY);
      return;
    }

    const first = Math.floor(bounds.first);
    const last = Math.floor(bounds.last);
    if (!graphData || graphData.first !== first || graphData.last !== last) {
      const lines = [rows.map(([time, value]) => [time, value]),
        rows.map(([time, , value]) => [time, value]), route.series];
      graphData = { first, last, series: lines.map(GNSSHistory.chartSeries) };
    }
    const index = GNSSHistory.before(rows, second + 1) - 1;
    const row = rows[index]?.[0] >= second ? rows[index] : [];
    const distance = route.series[GNSSHistory.before(route.series, second + 1) - 1]?.[1];
    const label = timelineTimeFormat.format(second * 1000);
    setText('graph-time', label);
    setText('graph-speed', measurement(row[1], 'km/h'));
    setText('graph-altitude', measurement(row[2], 'm'));
    setText('graph-distance', measurement(distance, 'km', 3));
    chart?.(graphData, playbackTime ?? second, label);
  }

  function renderAnalysis(bounds) {
    if (activeTab !== 'analysis') return;
    setText('analysis-status', seriesStatus());
    const route = qz1Route();
    const key = `${route.count}:${telemetry.rows.length}:${bounds?.first}:${bounds?.last}`;
    if (key === analysisKey) return;
    analysisKey = key;
    const summary = GNSSHistory.summarize(telemetry.rows, route, bounds?.first, bounds?.last);
    const values = {
      distance: measurement(route.total === null ? null : route.total / 1000, 'km', 3),
      time: summary.duration === null ? EMPTY : elapsed(summary.duration),
      'average-pace': pace(summary.average),
      'best-pace': pace(summary.maxSpeed),
      'average-speed': measurement(summary.average, 'km/h'),
      'max-speed': measurement(summary.maxSpeed, 'km/h'),
      'max-altitude': measurement(summary.maxAltitude, 'm'),
      'min-altitude': measurement(summary.minAltitude, 'm'),
      ascent: measurement(summary.ascent, 'm'),
      descent: measurement(summary.descent, 'm'),
    };
    for (const [key, value] of Object.entries(values)) setText(`analysis-${key}`, value);
  }

  function renderComparisonSummary() {
    if (activeTab !== 'gps' || !latestSnapshot?.comparison_mode) return;
    const { qz1, comparison } = selectedTracks;
    const key = `${qz1.count}:${comparison.count}`;
    if (key === comparisonSummaryKey) return;
    comparisonSummaryKey = key;
    const summary = GNSSHistory.compare(qz1.samples, comparison.samples);
    const qzDistance = qz1Route().total;
    const otherDistance = GNSSHistory.route(comparison).total;
    setText('comparison-pairs', summary.count.toLocaleString('ja-JP'));
    setText('comparison-mean', measurement(summary.mean, 'm'));
    setText('comparison-median', measurement(summary.median, 'm'));
    setText('comparison-p95', measurement(summary.p95, 'm'));
    setText('comparison-max', measurement(summary.max, 'm'));
    setText('comparison-time-gap', measurement(summary.timeGap, '秒', 2));
    setText('comparison-lengths', [qzDistance, otherDistance]
      .map((value) => measurement(value === null ? null : value / 1000, 'km', 3)).join(' / '));
  }

  async function loadTelemetry() {
    const end = latestSnapshot?.session?.last_sample_at;
    if (!Number.isFinite(end) || telemetry.loading || telemetry.loadedThrough === end
      || !['graph', 'analysis'].includes(activeTab)) return;
    const record = telemetry;
    const id = selectedSessionId;
    record.loading = true;
    record.failed = false;
    try {
      let more = true;
      while (more && telemetry === record && ['graph', 'analysis'].includes(activeTab)) {
        const result = await fetchJson('series', { id, after: record.after });
        if (telemetry !== record) return;
        const points = Array.isArray(result.points) ? result.points : [];
        if (!points.length) {
          more = false;
          break;
        }
        record.rows.push(...points);
        record.after = points[points.length - 1][0];
        graphData = null;
        more = result.has_more;
      }
      if (!more || record.after >= end) record.loadedThrough = end;
    } catch {
      record.failed = true;
      record.loadedThrough = end;
    } finally {
      record.loading = false;
      if (telemetry === record) renderTimeline();
    }
  }

  function loadReplayDetails(second, fallbackPosition) {
    if (replayRequest?.second === second) {
      renderReplayDetails(replayRequest, fallbackPosition);
      return;
    }
    clearTimeout(replayTimer);
    const session = latestSnapshot.session;
    const canLoad = second >= Math.floor(session?.first_sample_at ?? Infinity)
      && second <= Math.floor(session?.last_sample_at ?? -Infinity);
    const request = {
      second,
      sample: null,
      status: canLoad ? '指定時刻のデータを読み込んでいます。' : '指定時刻の測位情報・受信統計は未記録です。',
    };
    replayRequest = request;
    renderReplayDetails(request, fallbackPosition);
    if (!canLoad) return;

    const id = selectedSessionId;
    replayTimer = setTimeout(async () => {
      try {
        const result = await fetchJson('sample', { id, second });
        request.sample = result.sample;
        request.status = result.sample
          ? '指定時刻に保存した受信時点の状態を表示しています。-- は未記録の項目です。'
          : '指定時刻の測位情報・受信統計は未記録です。';
      } catch {
        request.status = '指定時刻の測位情報・受信統計を取得できません。';
      }
      if (replayRequest === request) renderReplayDetails(request, replayPositions.qz1);
    }, 150);
  }

  function renderTimeline(pan = false) {
    if (!latestSnapshot) return;
    const slider = el['timeline-slider'];
    const qz1 = selectedTracks.qz1.samples;
    const comparison = activeTab === 'gps' ? selectedTracks.comparison.samples : [];
    const bounds = timelineBounds();
    renderAnalysis(bounds);
    renderComparisonSummary();
    el['history-timeline'].hidden = false;
    el['timeline-controls'].hidden = !bounds;
    const atLatest = !bounds || timelineOffset === null;
    el['timeline-latest'].disabled = atLatest;
    el['graph-latest'].disabled = atLatest;
    if (!bounds) {
      pausePlayback();
      el['play-record'].disabled = true;
      el['gps-slider'].disabled = true;
      el['gps-slider'].max = '0';
      el['gps-slider'].value = '0';
      el['timeline-single'].hidden = true;
      timelineOffset = null;
      clearTimeout(replayTimer);
      replayRequest = null;
      setText('timeline-details', '');
      updateTimelineMarkers({}, false, false);
      setText('timeline-note', 'この記録には測位時刻が保存されていません。');
      renderGraph(null);
      return;
    }

    const firstSecond = Math.floor(bounds.first);
    const lastSecond = Math.floor(bounds.last);
    const duration = lastSecond - firstSecond;
    if (duration === 0) pausePlayback();
    el['play-record'].disabled = duration === 0;
    slider.max = String(duration);
    slider.disabled = duration === 0;
    el['timeline-single'].hidden = duration !== 0;
    el['timeline-single'].disabled = timelineOffset !== null;
    const second = Math.max(firstSecond, Math.min(timelineOffset ?? lastSecond, lastSecond));
    if (slider.valueAsNumber !== second - firstSecond) slider.value = String(second - firstSecond);
    const timestamp = second + 1;
    const timeLabel = timelineTimeFormat.format(second * 1000);
    slider.setAttribute('aria-valuetext', timeLabel);
    const gpsSlider = el['gps-slider'];
    gpsSlider.max = String(duration);
    gpsSlider.disabled = duration === 0;
    gpsSlider.value = String(second - firstSecond);
    gpsSlider.setAttribute('aria-valuetext', timeLabel);
    setText('timeline-time', timeLabel);
    setText('timeline-note', '地図は時刻までの最後の測位点、一覧はその秒の記録を表示します。');

    const positions = { qz1: sampleBefore(qz1, timestamp), comparison: sampleBefore(comparison, timestamp) };
    replayPositions = positions;
    const replaying = timelineOffset !== null;
    if (playbackTime === null) updateTimelineMarkers(positions, replaying, pan);
    else renderPlaybackMap();
    renderGraph(bounds, second);
    if (replaying) {
      if (activeTab === 'information' || activeTab === 'gps') loadReplayDetails(second, positions.qz1);
    } else {
      setText('timeline-details', '測位情報・受信統計は記録の最終値です。');
    }
  }

  function seekTo(second) {
    if (!latestSnapshot) return;
    if (timelineOffset === second) return;
    timelineOffset = second;
    followLatestSession = false;
    renderTimeline(true);
  }

  function pausePlayback() {
    if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
    playbackFrame = null;
    playbackTime = null;
    playbackFocus = null;
    setText('play-icon', '▶');
    setText('play-label', '再生');
  }

  function seekManually(second) {
    pausePlayback();
    seekTo(second);
  }

  function renderPlaybackMap() {
    if (!mapAvailable) return;
    const positions = { qz1: GNSSHistory.positionAt(selectedTracks.qz1.samples, playbackTime) };
    if (activeTab === 'gps') {
      positions.comparison = GNSSHistory.positionAt(selectedTracks.comparison.samples, playbackTime);
    }
    updateTimelineMarkers(positions, true, true);
  }

  function schedulePlayback() {
    if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
    const speed = Number(el['play-speed'].value);
    const start = playbackTime ?? timelineOffset;
    const startedAt = performance.now();
    let detailsUpdatedAt = startedAt;
    function frame(now) {
      const bounds = timelineBounds();
      if (!bounds || timelineOffset === null) {
        pausePlayback();
        return;
      }
      const elapsed = Math.max(0, now - startedAt) / 1000;
      playbackTime = Math.min(bounds.last, start + elapsed * speed);
      timelineOffset = Math.floor(playbackTime);
      if (playbackTime === bounds.last) {
        pausePlayback();
        renderTimeline(true);
        return;
      }

      // 地図とグラフは毎フレーム描画し、詳細の問い合わせは間引く。
      if (now - detailsUpdatedAt >= 250) {
        renderTimeline();
        detailsUpdatedAt = now;
      } else {
        renderPlaybackMap();
        renderGraph(bounds, timelineOffset);
      }
      if (playbackTime !== null) playbackFrame = requestAnimationFrame(frame);
    }
    playbackTime = start;
    playbackFrame = requestAnimationFrame(frame);
  }

  function togglePlayback() {
    if (playbackFrame !== null) {
      pausePlayback();
      renderTimeline(true);
      return;
    }
    const bounds = timelineBounds();
    if (!bounds) return;
    const first = Math.floor(bounds.first);
    const last = Math.floor(bounds.last);
    if (first === last) return;

    const current = Math.max(first, Math.min(timelineOffset ?? last, last));
    seekTo(current < last ? current : first);
    setText('play-icon', 'Ⅱ');
    setText('play-label', '一時停止');
    schedulePlayback();
  }

  function returnToLatest() {
    pausePlayback();
    if (timelineOffset === null) return;
    timelineOffset = null;
    clearTimeout(replayTimer);
    replayRequest = null;
    followLatestSession = selectedSessionId === newestSessionId;
    if (latestSnapshot) render(latestSnapshot);
    renderTimeline();
  }

  async function pollRemoteState() {
    if (Date.now() - lastSessionsRefresh >= SESSION_REFRESH_INTERVAL_MS) {
      await refreshSessions();
    }
    const sessionId = selectedSessionId;
    if (!sessionId) return;
    const token = selectionToken;
    const snapshot = await fetchJson('state', { id: sessionId });
    if (token !== selectionToken) return;
    const requests = [loadSelectedTrack(token, 'qz1')];
    if (activeTab === 'gps' && snapshot.comparison_mode) requests.push(loadSelectedTrack(token, 'comparison'));
    const results = await Promise.allSettled(requests);
    if (token !== selectionToken) return;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    snapshot.trail = selectedTracks.qz1.points;
    latestSnapshot = snapshot;
    render(snapshot);
    void loadTelemetry();
    renderTimeline();
    setText('history-status', '');
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
      if (REMOTE_VIEW) {
        await pollRemoteState();
        return;
      }
      const response = await fetch(apiUrl('state'), { cache: 'no-store' });
      if (!response.ok) throw new Error('位置情報APIからエラーが返されました。');
      render(await response.json());
    } catch (error) {
      showMessage(SERVER_DOWN, true);
      if (REMOTE_VIEW) el['history-status'].textContent = '記録を取得できません。';
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
    for (; ;) {
      if (!document.hidden) await pollState();
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  function init() {
    initMap();
    const tabs = [...el['monitor-tabs'].querySelectorAll('[data-tab]')];
    function switchTab() {
      const requested = window.location.hash.slice(1);
      const defaultTab = REMOTE_VIEW ? 'graph' : 'information';
      activeTab = REMOTE_VIEW && tabs.some((tab) => tab.dataset.tab === requested) ? requested : defaultTab;
      for (const tab of tabs) {
        const selected = tab.dataset.tab === activeTab;
        el[tab.dataset.tab].hidden = !selected;
        if (selected) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
      }
      el['monitor-tabs'].hidden = !REMOTE_VIEW;
      if (latestSnapshot) {
        render(latestSnapshot);
        void loadTelemetry();
        renderTimeline();
      }
    }
    for (const tab of tabs) {
      tab.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (window.location.hash !== tab.hash) history.pushState(null, '', tab.hash);
        switchTab();
      });
    }
    window.addEventListener('hashchange', switchTab);
    switchTab();
    if (REMOTE_VIEW) {
      chart = GNSSHistory.setupChart(el['history-chart'], el['graph-scale'], seekManually);
      el['play-controls'].hidden = false;
      el['play-record'].addEventListener('click', togglePlayback);
      el['play-speed'].addEventListener('change', () => {
        if (playbackFrame !== null) schedulePlayback();
      });
      setText('equipment-program', 'send_gnss.py（Python / pyserial）→ yahikoサーバー（HTTPS）');
      el['serial-controls'].hidden = true;
      el['history-panel'].hidden = false;
      el['history-select'].addEventListener('change', () => {
        const chosenId = el['history-select'].value || null;
        if (linkedSessionId) sessionListKey = null;
        linkedSessionId = null;
        followLatestSession = chosenId === newestSessionId;
        selectRemoteSession(chosenId);
      });
      el['share-record'].addEventListener('click', copyRecordLink);
      for (const id of ['timeline-slider', 'gps-slider']) {
        el[id].addEventListener('input', (event) => {
          const bounds = timelineBounds();
          if (bounds) seekManually(Math.floor(bounds.first) + event.currentTarget.valueAsNumber);
        });
      }
      el['timeline-single'].addEventListener('click', () => {
        const bounds = timelineBounds();
        if (bounds) seekTo(Math.floor(bounds.first));
      });
      el['timeline-latest'].addEventListener('click', returnToLatest);
      el['graph-latest'].addEventListener('click', returnToLatest);
      setText('site-title', 'みちびき遠隔モニター');
      setText('map-instructions', 'Windows PCから位置データが届くと、現在地と軌跡を表示します');
      el['footer-mode'].hidden = true;
      document.title = 'みちびき遠隔モニター';
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
      returnToLatest();
      if (map && lastPosition) map.setView(lastPosition, Math.max(map.getZoom(), FOLLOW_ZOOM));
    });
    el['fit-map'].addEventListener('click', () => {
      const bounds = L.latLngBounds([]);
      const lines = activeTab === 'gps' ? [track, comparisonTrack] : [track];
      for (const line of lines) {
        if (line.getBounds().isValid()) bounds.extend(line.getBounds());
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20], maxZoom: FOLLOW_ZOOM });
    });
    for (const id of ['reference-lat', 'reference-lon']) {
      el[id].addEventListener('input', () => {
        if (timelineOffset !== null) renderComparisonDetails(replayRequest?.sample, true);
        else renderComparisonDetails(latestSnapshot);
      });
    }

    pollLoop();
  }

  init();
})();
