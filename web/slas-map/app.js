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
    ? '学校サーバーの位置情報APIに接続できません。'
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
  let comparisonSnapshot = null;
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
  let newestSessionId = null;
  let linkedSessionId = REMOTE_VIEW ? new URLSearchParams(window.location.search).get('record') : null;
  let followLatestSession = true;
  let timelineOffset = null;
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
    comparisonTrack = L.polyline([], { color: COMPARISON_COLOR, weight: 3, dashArray: '7 5' }).addTo(map);
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

  function metresBetween(a, b) {
    const radians = Math.PI / 180;
    const halfLat = Math.sin((b[0] - a[0]) * radians / 2);
    const halfLon = Math.sin((b[1] - a[1]) * radians / 2);
    const h = halfLat ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * halfLon ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function renderComparison(snapshot) {
    comparisonSnapshot = snapshot;
    const mode = snapshot?.comparison_mode;
    el['comparison-panel'].hidden = !mode;
    if (!mode) return;

    const label = mode === 'gps' ? 'GPS 単独（比較用受信機）' : 'PC の推定位置';
    const sample = snapshot.comparison;
    const point = coordinates(sample);
    const qz1 = snapshot.data?.fix ? coordinates(snapshot.data) : null;
    const age = snapshot.connected ? Date.now() / 1000 - sample?.timestamp : 0;
    const paired = point && qz1 && Number.isFinite(snapshot.position_at)
      && Math.abs(snapshot.position_at - sample.timestamp) <= 5 && age <= 10;
    const accuracy = sample?.accuracy;
    setText('comparison-source', label);
    setText('comparison-position', point
      ? point.map((value) => value.toFixed(7) + '°').join(', ') + (age > 10 ? '（最終取得位置）' : '')
      : '取得待ち');
    setText('comparison-accuracy', Number.isFinite(accuracy) ? `${accuracy.toFixed(1)} m` : '—');
    setText('comparison-distance', paired ? `${metresBetween(qz1, point).toFixed(1)} m` : '—');

    const lat = el['reference-lat'].valueAsNumber;
    const lon = el['reference-lon'].valueAsNumber;
    setText('reference-result', paired && isValidCoordinate(lat, lon)
      ? `QZ1 ${metresBetween(qz1, [lat, lon]).toFixed(1)} m ／ ${label} ${metresBetween(point, [lat, lon]).toFixed(1)} m`
      : '—');

    if (!mapAvailable) return;
    const points = selectedTracks.comparison.points;
    if (comparisonTrack.getLatLngs().length !== points.length) comparisonTrack.setLatLngs(points);
    if (point) {
      if (!comparisonMarker) {
        comparisonMarker = L.circleMarker(point, { color: '#fff', fillColor: COMPARISON_COLOR,
          fillOpacity: 1, radius: 7 }).bindTooltip(label).addTo(map);
      } else {
        comparisonMarker.setLatLng(point);
      }
      if (Number.isFinite(accuracy)) {
        if (!accuracyCircle) {
          accuracyCircle = L.circle(point, { color: COMPARISON_COLOR, weight: 1,
            fillOpacity: 0.08, interactive: false }).addTo(map);
        }
        accuracyCircle.setLatLng(point).setRadius(accuracy);
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
    if (connected && !wasConnected) {
      // 新しい接続では軌跡が消えるので、最初の位置で地図を合わせ直す
      centered = false;
      trackKey = '';
      renderedTrackPointCount = 0;
      if (track) track.setLatLngs([]);
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
    if (REMOTE_VIEW) renderComparison(snapshot);
    if (mapAvailable) {
      el['fit-map'].disabled = !track.getBounds().isValid() && !comparisonTrack.getBounds().isValid();
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
    return `${imported}${date} · ${Number(session.point_count || 0).toLocaleString('ja-JP')} 点 · ${status}`;
  }

  function resetSelectedRecord() {
    selectedTracks = {
      qz1: { points: [], samples: [], count: 0, offset: 0 },
      comparison: { points: [], samples: [], count: 0, offset: 0 },
    };
    timelineOffset = null;
    el['history-timeline'].hidden = true;
    trackKey = '';
    renderedTrackPointCount = 0;
    markerKey = '';
    markerFixed = null;
    centered = false;
    lastPosition = null;
    if (track) track.setLatLngs([]);
    if (marker && map) map.removeLayer(marker);
    marker = null;
    comparisonTrack?.setLatLngs([]);
    comparisonMarker?.remove();
    accuracyCircle?.remove();
    comparisonMarker = accuracyCircle = null;
    updateTimelineMarkers({}, false, false);
    renderComparison(null);
    el['center-map'].disabled = true;
    el['fit-map'].disabled = true;
  }

  function selectRemoteSession(sessionId) {
    if (sessionId === selectedSessionId) return;
    selectedSessionId = sessionId || null;
    selectionToken += 1;
    resetSelectedRecord();
    el['share-record'].disabled = !selectedSessionId;
    el['record-link'].hidden = true;
    el['record-link'].value = '';
    setText('share-status', '');
    el['history-status'].textContent = selectedSessionId ? '経路を読み込んでいます…' : '記録を待っています。';
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
      setText('share-status', 'リンクをコピーしました。');
    } catch {
      if (token !== selectionToken) return;
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
    const key = sessions.map((item) => `${item.id}|${item.started_at}|${item.point_count}|${item.connected}`).join('\n');
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
    while (hasMore && token === selectionToken && selectedSessionId) {
      const result = await fetchJson('track', { id: selectedSessionId, source, offset: record.offset, timed: 1 });
      if (token !== selectionToken) return;
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

  function sampleAtOrBefore(samples, timestamp) {
    let start = 0;
    let end = samples.length;
    while (start < end) {
      const mid = Math.floor((start + end) / 2);
      if (samples[mid][2] <= timestamp) start = mid + 1;
      else end = mid;
    }
    return samples[start - 1];
  }

  function updateTimelineMarkers(positions, active, pan) {
    if (!mapAvailable) return;
    for (const layer of [marker, comparisonMarker, accuracyCircle]) {
      if (!layer) continue;
      if (active) layer.remove();
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
        timelineMarkers[source].setLatLng([point[0], point[1]]);
      }
    }
    const focus = positions.qz1 || positions.comparison;
    if (active && focus) {
      el['map-message'].hidden = true;
      if (pan) map.panTo([focus[0], focus[1]], { animate: false });
    }
  }

  function renderTimeline(pan = false) {
    const slider = el['timeline-slider'];
    const qz1 = selectedTracks.qz1.samples;
    const comparison = selectedTracks.comparison.samples;
    const hasSamples = qz1.length > 0 || comparison.length > 0;
    el['history-timeline'].hidden = connected;
    el['timeline-controls'].hidden = connected || !hasSamples;
    if (connected || !hasSamples) {
      timelineOffset = null;
      updateTimelineMarkers({}, false, false);
      setText('timeline-note', 'この記録には測位時刻が保存されていません。');
      return;
    }

    const first = Math.min(qz1[0]?.[2] ?? Infinity, comparison[0]?.[2] ?? Infinity);
    const last = Math.max(qz1[qz1.length - 1]?.[2] ?? -Infinity, comparison[comparison.length - 1]?.[2] ?? -Infinity);
    const duration = Math.ceil(last - first);
    if (Number(slider.max) !== duration) slider.max = String(duration);
    slider.disabled = duration === 0;
    const offset = Math.min(timelineOffset ?? duration, duration);
    if (slider.valueAsNumber !== offset) slider.value = String(offset);
    const timestamp = Math.min(first + offset, last);
    const timeLabel = timelineTimeFormat.format(timestamp * 1000);
    slider.setAttribute('aria-valuetext', timeLabel);
    setText('timeline-time', timeLabel);
    setText('timeline-note', '測位時刻が保存された範囲で、指定時刻以前の最後の測位点を表示します。');

    const positions = { qz1: sampleAtOrBefore(qz1, timestamp), comparison: sampleAtOrBefore(comparison, timestamp) };
    const comparisonLabel = comparisonSnapshot?.comparison_mode === 'gps' ? 'GPS単独' : 'PCの推定位置';
    el['timeline-comparison'].hidden = comparison.length === 0;
    for (const [source, label] of [['qz1', 'QZ1'], ['comparison', comparisonLabel]]) {
      const point = positions[source];
      setText(`timeline-${source}`, point
        ? `${label}　${point[0].toFixed(7)}°, ${point[1].toFixed(7)}°（測位 ${timelineTimeFormat.format(point[2] * 1000)}）`
        : `${label}　この時刻までに測位点がありません`);
    }
    updateTimelineMarkers(positions, timelineOffset !== null || duration === 0, pan);
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
    if (snapshot.comparison_mode) requests.push(loadSelectedTrack(token, 'comparison'));
    const results = await Promise.allSettled(requests);
    if (token !== selectionToken) return;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    snapshot.trail = selectedTracks.qz1.points;
    render(snapshot);
    renderTimeline();
    const session = snapshot.session || {};
    const count = selectedTracks.qz1.count.toLocaleString('ja-JP');
    el['history-status'].textContent = `${count} 点 · ${session.connected ? '送信中' : '記録済み'}`;
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
    if (REMOTE_VIEW) {
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
      el['timeline-slider'].addEventListener('input', (event) => {
        timelineOffset = event.currentTarget.valueAsNumber;
        followLatestSession = false;
        renderTimeline(true);
      });
      setText('site-title', 'みちびき遠隔モニター');
      setText('map-instructions', 'Windows PCから位置データが届くと、現在地と軌跡を表示します');
      setText('footer-mode', '位置情報は接続中のWindows PCから学校サーバーへ送信されます。');
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
      if (timelineOffset !== null) {
        timelineOffset = null;
        followLatestSession = selectedSessionId === newestSessionId;
        renderTimeline();
      }
      if (map && lastPosition) map.setView(lastPosition, Math.max(map.getZoom(), FOLLOW_ZOOM));
    });
    el['fit-map'].addEventListener('click', () => {
      const bounds = L.latLngBounds([]);
      for (const line of [track, comparisonTrack]) {
        if (line.getBounds().isValid()) bounds.extend(line.getBounds());
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20], maxZoom: FOLLOW_ZOOM });
    });
    for (const id of ['reference-lat', 'reference-lon']) {
      el[id].addEventListener('input', () => renderComparison(comparisonSnapshot));
    }

    pollLoop();
  }

  init();
})();
