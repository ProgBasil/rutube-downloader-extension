# Rutube Downloader — Chrome Extension

Чистое Chrome-расширение для скачивания видео с Rutube. Без серверов, без yt-dlp — расширение само парсит HLS-плейлисты и скачивает видео через браузер.

## Демо

1. Установи расширение в Chrome
2. Открой видео на Rutube
3. Нажми иконку расширения → «Определить видео» → выбери качество → «Скачать»

## Возможности

- Автоматическое определение видео на странице Rutube
- Парсинг HLS (M3U8) плейлистов с выбором качества
- Скачивание сегментов с 6 параллельными потоками
- Расшифровка AES-128 шифрования через Web Crypto API
- Склейка сегментов в MP4-файл
- Прогресс-бар на иконке расширения

## Установка

1. Открой `chrome://extensions/`
2. Включи **Режим разработчика** (Developer mode)
3. Нажми **Загрузить распакованное расширение** (Load unpacked)
4. Выбери папку `rutube-downloader-extension`

## Архитектура

```
┌──────────────┐    chrome.runtime     ┌────────────────┐
│  Content     │ ─────sendMessage────▶ │  Background    │
│  Script      │                       │  Service       │
│  (content.js)│                       │  Worker        │
└──────┬───────┘                       │  (background.js)│
       │                               └───────┬────────┘
       │ PerformanceObserver                   │
       │ перехват M3U8 URL                     │ fetch segments
       ▼                                       ▼
┌──────────────┐                       ┌────────────────┐
│  Rutube CDN  │ ◀── CORS allowed ──── │  rtbcdn.ru    │
│  (m3u8+ts)   │                       │  (сегменты)    │
└──────────────┘                       └────────────────┘
                                               │
                                               ▼ chrome.downloads
                                        ┌────────────────┐
                                        │  mp4 файл      │
                                        └────────────────┘
```

## Как это работает (технически)

### 1. Обнаружение видео

Когда пользователь открывает страницу `rutube.ru/video/*`, content script:
- Извлекает video ID, название, обложку из OG-тегов
- Ищет M3U8 URL в `__INITIAL_STATE__`, скриптах, meta-тегах
- Запускает `PerformanceObserver` для перехвата M3U8-запросов из сети

### 2. Парсинг HLS

Background service worker:
- Получает M3U8 URL (из content script или `chrome.webRequest`)
- Парсит мастер-плейлист → извлекает доступные качества (разрешение + битрейт)
- Парсит плейлист качества → список сегментов (.ts файлы)
- Определяет AES-128 шифрование (URI ключа, IV)

### 3. Скачивание

- Сегменты скачиваются пачками по 6 штук параллельно (Promise.all)
- При ошибке — автоматический retry сponential backoff (3 попытки)
- Если AES-128: скачивается ключ, каждый сегмент расшифровывается через `crypto.subtle.decrypt`
- Все сегменты склеиваются в один `Uint8Array`
- Конвертируется в base64 data URL
- Сохраняется через `chrome.downloads.download`

### 4. Ключевые особенности

| Компонент | Технология |
|-----------|-----------|
| Content Script | `PerformanceObserver` — перехват сетевых запросов |
| Service Worker | `chrome.webRequest` — мониторинг M3U8 URL |
| HLS парсер | Ручной парсинг M3U8 тегов (#EXT-X-STREAM-INF, #EXT-X-KEY и т.д.) |
| Шифрование | Web Crypto API (`AES-CBC` расшифровка) |
| Скачивание | `fetch` с retry + параллельные загрузки |
| Сохранение | `chrome.downloads.download` с base64 data URL |
| Прогресс | `chrome.action.setBadgeText` на иконке |

## Структура проекта

```
rutube-downloader-extension/
├── manifest.json      # Manifest V3, permissions, content scripts
├── content.js         # Перехват M3U8 URL на странице Rutube
├── background.js      # Парсинг M3U8, скачивание, расшифровка, склейка
├── popup.html         # Интерфейс расширения
├── popup.css          # Стили (dark theme)
├── popup.js           # Логика popup: обнаружение, выбор качества, запуск
├── icons/             # Иконки 16/48/128px
├── .gitignore
└── README.md
```

## Возможные улучшения

- [ ] Поддержка плейлистов (несколько видео)
- [ ] Выбор формата (MP4 / MKV / WebM)
- [ ] Стриминговая запись через `FileSystemWritableFileStream` (без загрузки в RAM)
- [ ] Поддержка других платформ (YouTube, VK Video)
- [ ] Настройка количества параллельных потоков
- [ ] Экспорт в MP3 (вырезка аудио)

## Лицензия

MIT License
