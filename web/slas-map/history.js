'use strict';

const GNSSHistory = (() => {
  const MAX_GAP = 10;
  const SERIES = ['--chart-speed', '--chart-altitude', '--chart-distance'];

  function distance(a, b) {
    const radians = Math.PI / 180;
    const lat = Math.sin((b[0] - a[0]) * radians / 2);
    const lon = Math.sin((b[1] - a[1]) * radians / 2);
    const h = lat ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * lon ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  function before(points, time, column = 0) {
    let low = 0;
    let high = points.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid][column] < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function positionAt(samples, time) {
    const index = before(samples, time, 2);
    const next = samples[index];
    if (next?.[2] === time) return next;
    const previous = samples[index - 1];
    if (!previous || !next || next[2] - previous[2] > MAX_GAP) return previous;

    const fraction = (time - previous[2]) / (next[2] - previous[2]);
    const longitudeDelta = (next[1] - previous[1] + 540) % 360 - 180;
    return [
      previous[0] + (next[0] - previous[0]) * fraction,
      previous[1] + longitudeDelta * fraction,
    ];
  }

  function route(record) {
    const { points, samples } = record;
    if (samples.length !== record.count) {
      // 時刻のない旧記録もファイル上の順番で距離を計算できる。
      let total = 0;
      for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
      return { total: points.length ? total : null, series: [] };
    }

    let total = 0;
    let previous = null;
    const series = [];
    for (const point of samples) {
      const gap = previous && point[2] - previous[2] > MAX_GAP;
      if (gap) series.push([point[2], null]);
      if (previous && !gap) total += distance(previous, point);
      series.push([point[2], total / 1000]);
      previous = point;
    }
    return { total: samples.length ? total : null, series };
  }

  function summarize(telemetry, route, first, last) {
    const duration = Number.isFinite(first) && Number.isFinite(last) ? last - first : null;
    const average = duration > 0 && route.total !== null ? 3.6 * route.total / duration : null;
    let maxSpeed = null;
    let minAltitude = Infinity;
    let maxAltitude = -Infinity;
    let ascent = 0;
    let descent = 0;
    let altitudePairs = 0;
    let previous = null;
    for (const [time, speed, altitude] of telemetry) {
      if (Number.isFinite(speed)) maxSpeed = Math.max(maxSpeed ?? speed, speed);
      if (!Number.isFinite(altitude)) continue;
      minAltitude = Math.min(minAltitude, altitude);
      maxAltitude = Math.max(maxAltitude, altitude);
      if (previous && time - previous[0] <= MAX_GAP) {
        const delta = altitude - previous[1];
        ascent += Math.max(0, delta);
        descent += Math.max(0, -delta);
        altitudePairs += 1;
      }
      previous = [time, altitude];
    }
    return {
      duration, average, maxSpeed,
      minAltitude: Number.isFinite(minAltitude) ? minAltitude : null,
      maxAltitude: Number.isFinite(maxAltitude) ? maxAltitude : null,
      ascent: altitudePairs ? ascent : null,
      descent: altitudePairs ? descent : null,
    };
  }

  function compare(qz1, other) {
    const differences = [];
    let timeGap = 0;
    let total = 0;
    let j = 0;
    for (let i = 0; i < qz1.length; i += 1) {
      const point = qz1[i];
      while (j < other.length && other[j][2] < point[2] - 5) j += 1;
      if (j >= other.length) break;
      while (j + 1 < other.length && Math.abs(other[j + 1][2] - point[2]) < Math.abs(other[j][2] - point[2])) j += 1;
      const nextQzTime = qz1[i + 1]?.[2] ?? Infinity;
      if (Math.abs(nextQzTime - other[j][2]) < Math.abs(point[2] - other[j][2])) continue;
      const span = other[j][2] - point[2];
      if (span > 5) continue;
      const gap = distance(point, other[j]);
      differences.push(gap);
      total += gap;
      timeGap += Math.abs(span);
      j += 1;
    }
    differences.sort((a, b) => a - b);
    const count = differences.length;
    return {
      count,
      mean: count ? total / count : null,
      median: count ? (differences[Math.floor((count - 1) / 2)] + differences[Math.floor(count / 2)]) / 2 : null,
      p95: count ? differences[Math.ceil(count * 0.95) - 1] : null,
      max: count ? differences[count - 1] : null,
      timeGap: count ? timeGap / count : null,
    };
  }

  function chartSeries(points) {
    let min = Infinity;
    let max = -Infinity;
    let previousTime = null;
    let missing = false;
    const samples = [];
    for (const [time, value] of points) {
      if (!Number.isFinite(value)) {
        missing = true;
        continue;
      }
      const estimated = previousTime !== null && (missing || time - previousTime > MAX_GAP);
      samples.push([time, value, estimated]);
      previousTime = time;
      missing = false;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return { samples, min, max };
  }

  function setupChart(canvas, scale, onSeek) {
    const context = canvas.getContext('2d');
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const timeFormat = new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tokyo',
    });
    let data = null;
    let cursor = 0;
    let frame = 0;
    let drag = null;

    function viewport() {
      const duration = Math.max(1, data.last - data.first);
      const zoom = scale.valueAsNumber / 100;
      const span = duration * (Math.min(8, duration) / duration) ** zoom;
      return { left: cursor - span / 2, span };
    }

    function draw() {
      frame = 0;
      const { width, height } = canvas.getBoundingClientRect();
      if (!data || !width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      const pixelsWide = Math.round(width * ratio);
      const pixelsHigh = Math.round(height * ratio);
      if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
      if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const css = getComputedStyle(canvas);
      const text = css.getPropertyValue('--text').trim();
      const muted = css.getPropertyValue('--text-sub').trim();
      const border = css.getPropertyValue('--border').trim();
      const { left, span: windowSeconds } = viewport();
      const right = left + windowSeconds;
      const top = 8;
      const bottom = height - 27;
      const x = (timestamp) => (timestamp - left) / windowSeconds * width;
      context.font = '11px system-ui, sans-serif';
      context.textBaseline = 'top';
      context.textAlign = 'left';

      context.strokeStyle = border;
      context.beginPath();
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const y = top + (bottom - top) * fraction;
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
      context.stroke();

      context.save();
      context.beginPath();
      context.rect(0, top - 2, width, bottom - top + 4);
      context.clip();
      context.lineWidth = 1.7;
      SERIES.forEach((color, index) => {
        const { samples, min, max } = data.series[index];
        if (!samples.length) return;

        const start = Math.max(0, before(samples, left) - 1);
        const end = Math.min(samples.length, before(samples, right) + 1);
        // 各項目の記録全体の最小値と最大値を、同じ描画領域に収める。
        const y = (value) => bottom - (max === min ? 0.5 : (value - min) / (max - min)) * (bottom - top);
        context.strokeStyle = css.getPropertyValue(color).trim();

        context.beginPath();
        for (let i = start; i < end; i += 1) {
          const [time, value, estimated] = samples[i];
          if (i === start || estimated) {
            context.moveTo(x(time) - 1, y(value));
            context.lineTo(x(time), y(value));
          } else {
            context.lineTo(x(time), y(value));
          }
        }
        context.stroke();

        context.setLineDash([2, 3]);
        context.beginPath();
        for (let i = start + 1; i < end; i += 1) {
          const [time, value, estimated] = samples[i];
          if (!estimated) continue;
          const [previousTime, previousValue] = samples[i - 1];
          context.moveTo(x(previousTime), y(previousValue));
          context.lineTo(x(time), y(value));
        }
        context.stroke();
        context.setLineDash([]);
      });
      context.restore();

      context.setLineDash([3, 3]);
      context.strokeStyle = text;
      context.beginPath();
      context.moveTo(width / 2, top);
      context.lineTo(width / 2, bottom);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = muted;
      for (const [fraction, align] of [[0, 'left'], [0.5, 'center'], [1, 'right']]) {
        context.textAlign = align;
        context.fillText(timeFormat.format((left + windowSeconds * fraction) * 1000),
          4 + (width - 8) * fraction, height - 19);
      }
      context.textAlign = 'left';
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(draw);
    }

    function seek(time) {
      onSeek(Math.max(data.first, Math.min(data.last, Math.round(time))));
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (!data || event.button !== 0 || drag) return;
      drag = { id: event.pointerId, x: event.clientX, cursor, span: viewport().span, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (drag?.id !== event.pointerId) return;
      const delta = event.clientX - drag.x;
      if (Math.abs(delta) >= 5) drag.moved = true;
      if (drag.moved) seek(drag.cursor - delta * drag.span / canvas.clientWidth);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (drag?.id !== event.pointerId) return;
      if (!drag.moved) {
        const bounds = canvas.getBoundingClientRect();
        const { left, span } = viewport();
        seek(left + (event.clientX - bounds.left) / bounds.width * span);
      }
      drag = null;
    });
    canvas.addEventListener('lostpointercapture', () => { drag = null; });
    canvas.addEventListener('keydown', (event) => {
      if (!data) return;
      const { span } = viewport();
      const step = event.shiftKey ? Math.ceil(span / 4) : 1;
      const targets = {
        ArrowLeft: cursor - step, ArrowRight: cursor + step,
        Home: data.first, End: data.last,
        PageUp: cursor + Math.ceil(span), PageDown: cursor - Math.ceil(span),
      };
      if (!Object.hasOwn(targets, event.key)) return;
      event.preventDefault();
      seek(targets[event.key]);
    });
    new ResizeObserver(schedule).observe(canvas);
    dark.addEventListener('change', schedule);
    function updateScale() {
      if (!data) return;
      const duration = data.last - data.first;
      scale.disabled = duration <= 8;
      const label = scale.valueAsNumber === 0 || scale.disabled
        ? '記録全体' : `約 ${Math.round(viewport().span).toLocaleString('ja-JP')} 秒分`;
      scale.setAttribute('aria-valuetext', label);
    }
    scale.addEventListener('input', () => {
      updateScale();
      schedule();
    });

    return (nextData, time, label) => {
      if (data === nextData && cursor === time) return;
      data = nextData;
      cursor = time;
      canvas.setAttribute('aria-valuemin', data.first);
      canvas.setAttribute('aria-valuemax', data.last);
      const second = String(Math.floor(time));
      if (canvas.getAttribute('aria-valuenow') !== second) canvas.setAttribute('aria-valuenow', second);
      if (canvas.getAttribute('aria-valuetext') !== label) canvas.setAttribute('aria-valuetext', label);
      updateScale();
      schedule();
    };
  }

  return { distance, before, positionAt, route, summarize, compare, chartSeries, setupChart };
})();
