const states = {
  initial: document.getElementById('state-initial'),
  loading: document.getElementById('state-loading'),
  video: document.getElementById('state-video'),
  downloading: document.getElementById('state-downloading'),
  done: document.getElementById('state-done'),
  error: document.getElementById('state-error'),
};

let selectedQuality = 0;

function switchState(name) {
  Object.values(states).forEach(el => { if (el) el.classList.remove('active'); });
  if (states[name]) states[name].classList.add('active');
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBandwidth(bps) {
  if (!bps) return '';
  if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps';
  if (bps >= 1000) return (bps / 1000).toFixed(0) + ' kbps';
  return bps + ' bps';
}

function sendMsg(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

async function detectVideo() {
  switchState('loading');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('rutube.ru')) {
      showError('Откройте страницу видео на Rutube');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    await new Promise(r => setTimeout(r, 2000));

    const info = await sendMsg({ type: 'GET_VIDEO_INFO' });

    if (!info || !info.video) {
      showError('Видео не обнаружено. Подождите загрузки страницы и попробуйте снова.');
      return;
    }

    showVideo(info);
  } catch (err) {
    showError('Ошибка: ' + err.message);
  }
}

function showVideo(info) {
  const video = info.video;
  const qualities = info.qualities || [];

  document.getElementById('video-title').textContent = video.title || 'Без названия';
  document.getElementById('video-author').textContent = video.author || '';

  const thumb = document.getElementById('video-thumb');
  if (video.thumbnail) {
    thumb.src = video.thumbnail;
    thumb.style.display = 'block';
  } else {
    thumb.style.display = 'none';
  }

  const qualityList = document.getElementById('quality-list');
  qualityList.innerHTML = '';

  if (qualities.length > 0) {
    document.getElementById('video-quality').textContent =
      `Найдено ${qualities.length} качеств`;
    qualities.forEach((q, i) => {
      const btn = document.createElement('button');
      btn.className = 'quality-btn' + (i === 0 ? ' selected' : '');
      btn.innerHTML = `
        <span class="quality-resolution">${q.resolution || 'Н/Д'}</span>
        <span class="quality-bitrate">${formatBandwidth(q.bandwidth)}</span>
      `;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedQuality = i;
      });
      qualityList.appendChild(btn);
    });
  } else {
    document.getElementById('video-quality').textContent = 'M3U8 плейлист не найден';
  }

  switchState('video');
}

async function startDownload() {
  switchState('downloading');
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-text').textContent = 'Подготовка...';
  document.getElementById('progress-status').textContent = 'Анализ плейлиста...';

  await sendMsg({ type: 'START_DOWNLOAD', qualityIndex: selectedQuality });

  pollProgress();
}

function pollProgress() {
  const interval = setInterval(async () => {
    const progress = await sendMsg({ type: 'GET_PROGRESS' });
    if (!progress || !progress.downloading) {
      clearInterval(interval);
      const badge = await new Promise(resolve => {
        chrome.action.getBadgeText({}, resolve);
      });
      if (badge === 'done') {
        switchState('done');
      } else if (badge === 'err') {
        showError('Ошибка при скачивании. Проверьте соединение.');
      } else {
        switchState('done');
      }
    }
  }, 500);
}

function showError(message) {
  document.getElementById('error-text').textContent = message;
  switchState('error');
}

document.getElementById('btn-detect').addEventListener('click', detectVideo);
document.getElementById('btn-download').addEventListener('click', startDownload);
document.getElementById('btn-back').addEventListener('click', () => switchState('initial'));
document.getElementById('btn-new').addEventListener('click', () => switchState('initial'));
document.getElementById('btn-retry').addEventListener('click', detectVideo);
