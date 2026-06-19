(() => {
  const videoId = extractVideoId(window.location.href);
  if (!videoId) return;

  const info = {
    type: 'VIDEO_DETECTED',
    id: videoId,
    url: window.location.href,
    title: getMeta('og:title') || document.title,
    thumbnail: getMeta('og:image') || '',
    author: getMeta('og:video:director') || '',
  };

  const m3u8 = findM3U8();
  if (m3u8) info.m3u8Url = m3u8;

  chrome.runtime.sendMessage(info);

  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name.includes('.m3u8')) {
        chrome.runtime.sendMessage({ type: 'M3U8_DETECTED', url: entry.name, videoId });
      }
    }
  });
  obs.observe({ type: 'resource', buffered: true });

  function extractVideoId(url) {
    const m = url.match(/rutube\.ru\/(?:video|private)\/([a-f0-9]+)/);
    return m ? m[1] : null;
  }

  function getMeta(prop) {
    const el = document.querySelector(`meta[property="${prop}"]`) ||
               document.querySelector(`meta[name="${prop}"]`);
    return el ? el.content : null;
  }

  function findM3U8() {
    const ogVideo = document.querySelector('meta[property="og:video"]');
    if (ogVideo && ogVideo.content.includes('.m3u8')) return ogVideo.content;

    if (window.__INITIAL_STATE__) {
      try {
        const s = window.__INITIAL_STATE__;
        const deep = (obj) => {
          if (!obj || typeof obj !== 'object') return null;
          if (obj.hls && typeof obj.hls === 'string' && obj.hls.includes('.m3u8')) return obj.hls;
          for (const k of Object.keys(obj)) {
            const r = deep(obj[k]);
            if (r) return r;
          }
          return null;
        };
        const url = deep(s);
        if (url) return url;
      } catch (e) {}
    }

    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
      if (match) return match[0];
    }

    return null;
  }
})();
