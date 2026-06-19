const state = {
  currentVideo: null,
  m3u8Url: null,
  qualities: [],
  downloading: false,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'VIDEO_DETECTED') {
    state.currentVideo = msg;
    if (msg.m3u8Url) {
      state.m3u8Url = msg.m3u8Url;
      parseMasterPlaylist(msg.m3u8Url);
    }
    sendResponse({ ok: true });
  }

  if (msg.type === 'M3U8_DETECTED') {
    if (!state.m3u8Url || msg.url.includes('playlist')) {
      state.m3u8Url = msg.url;
      parseMasterPlaylist(msg.url);
    }
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_VIDEO_INFO') {
    sendResponse({
      video: state.currentVideo,
      qualities: state.qualities,
      m3u8Url: state.m3u8Url,
      downloading: state.downloading,
    });
  }

  if (msg.type === 'START_DOWNLOAD') {
    startDownload(msg.qualityIndex || 0);
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_PROGRESS') {
    sendResponse({ downloading: state.downloading });
  }

  return true;
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.url.includes('.m3u8')) {
      if (!state.m3u8Url) {
        state.m3u8Url = details.url;
        parseMasterPlaylist(details.url);
      }
    }
  },
  { urls: ['https://*.rutube.ru/*.m3u8*', 'http://*.rutube.ru/*.m3u8*'] }
);

async function parseMasterPlaylist(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parseM3U8(text, url);

    if (parsed.qualities.length > 0) {
      state.qualities = parsed.qualities.sort((a, b) => b.bandwidth - a.bandwidth);
    } else if (parsed.segments.length > 0) {
      state.qualities = [{
        bandwidth: 0,
        resolution: 'default',
        url: url,
        segments: parsed.segments,
        encryption: parsed.encryption,
      }];
    }
  } catch (e) {
    console.error('M3U8 parse error:', e);
  }
}

function parseM3U8(text, baseUrl) {
  const lines = text.split('\n').map(l => l.trim());
  const result = { segments: [], qualities: [], encryption: null, duration: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributes(line.substring('#EXT-X-STREAM-INF:'.length));
      const nextLine = lines[i + 1];
      if (nextLine && !nextLine.startsWith('#')) {
        result.qualities.push({
          bandwidth: parseInt(attrs.BANDWIDTH || '0'),
          resolution: attrs.RESOLUTION || '',
          url: resolveUrl(nextLine, baseUrl),
        });
      }
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.substring('#EXT-X-KEY:'.length));
      if (attrs.METHOD && attrs.METHOD !== 'NONE') {
        result.encryption = {
          method: attrs.METHOD,
          uri: attrs.URI ? resolveUrl(attrs.URI.replace(/"/g, ''), baseUrl) : null,
          iv: attrs.IV || null,
        };
      } else {
        result.encryption = null;
      }
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      result.duration = parseFloat(line.split(':')[1]) || 0;
    } else if (line && !line.startsWith('#') && line.length > 0) {
      const segUrl = resolveUrl(line, baseUrl);
      result.segments.push({ url: segUrl, encryption: result.encryption ? { ...result.encryption } : null });
    }
  }

  return result;
}

function parseAttributes(str) {
  const attrs = {};
  const regex = /([A-Z0-9_-]+)=(?:"([^"]*?)"|([^,]*))/g;
  let m;
  while ((m = regex.exec(str))) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
}

function resolveUrl(url, base) {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  try {
    return new URL(url, base).href;
  } catch {
    const baseObj = new URL(base);
    if (url.startsWith('/')) return baseObj.origin + url;
    const path = baseObj.pathname.substring(0, baseObj.pathname.lastIndexOf('/') + 1);
    return baseObj.origin + path + url;
  }
}

async function startDownload(qualityIndex) {
  if (state.downloading) return;
  state.downloading = true;
  updateBadge('...');

  try {
    let quality = state.qualities[qualityIndex] || state.qualities[0];
    if (!quality) {
      throw new Error('Нет доступных качеств для скачивания');
    }

    let segments, encryption;

    if (quality.segments && quality.segments.length > 0) {
      segments = quality.segments;
      encryption = segments[0]?.encryption || null;
    } else {
      updateBadge('...');
      const variantRes = await fetch(quality.url);
      const variantText = await variantRes.text();
      const variantParsed = parseM3U8(variantText, quality.url);
      segments = variantParsed.segments;
      encryption = variantParsed.encryption;
    }

    if (!segments || segments.length === 0) {
      throw new Error('Не найдены сегменты видео');
    }

    updateBadge(`0/${segments.length}`);

    let allSegments = await downloadSegments(segments, (done, total) => {
      updateBadge(`${done}/${total}`);
    });

    if (encryption && encryption.method === 'AES-128' && encryption.uri) {
      updateBadge('dec');
      allSegments = await decryptSegments(allSegments, encryption.uri, encryption.iv);
    }

    updateBadge('zip');
    const combined = combineSegments(allSegments);

    const base64 = uint8ArrayToBase64(combined);
    const dataUrl = `data:video/mp4;base64,${base64}`;

    const title = (state.currentVideo?.title || 'rutube_video')
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 100);

    chrome.downloads.download({
      url: dataUrl,
      filename: `${title}.mp4`,
      saveAs: true,
    }, (downloadId) => {
      updateBadge('done');
      setTimeout(() => updateBadge(''), 3000);
    });

  } catch (e) {
    console.error('Download error:', e);
    updateBadge('err');
    setTimeout(() => updateBadge(''), 3000);
  } finally {
    state.downloading = false;
  }
}

async function downloadSegments(segments, onProgress) {
  const results = [];
  const concurrency = 6;
  let done = 0;

  for (let i = 0; i < segments.length; i += concurrency) {
    const batch = segments.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (seg) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch(seg.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.arrayBuffer();
          } catch (e) {
            if (attempt === 2) throw e;
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      })
    );
    results.push(...batchResults);
    done += batch.length;
    onProgress(done, segments.length);
  }

  return results;
}

async function decryptSegments(segments, keyUrl, ivHex) {
  const keyRes = await fetch(keyUrl);
  const keyData = await keyRes.arrayBuffer();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'AES-CBC' }, false, ['decrypt']
  );

  const decrypted = [];
  for (let i = 0; i < segments.length; i++) {
    let iv;
    if (ivHex) {
      iv = hexToUint8Array(ivHex);
    } else {
      const seq = i + 1;
      iv = new Uint8Array(16);
      const view = new DataView(iv.buffer);
      view.setUint32(12, seq, false);
    }
    try {
      const dec = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv }, cryptoKey, segments[i]
      );
      decrypted.push(dec);
    } catch {
      decrypted.push(segments[i]);
    }
  }
  return decrypted;
}

function hexToUint8Array(hex) {
  hex = hex.replace(/^0x/i, '');
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return arr;
}

function combineSegments(segments) {
  const totalLength = segments.reduce((sum, s) => sum + (s.byteLength || s.length), 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const seg of segments) {
    const arr = seg instanceof Uint8Array ? seg : new Uint8Array(seg);
    combined.set(arr, offset);
    offset += arr.length;
  }
  return combined;
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function updateBadge(text) {
  chrome.action.setBadgeText({ text: text || '' });
  chrome.action.setBadgeBackgroundColor({ color: text === 'done' ? '#22c55e' : text === 'err' ? '#ef4444' : '#3b82f6' });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Rutube Downloader v2 установлен');
});
