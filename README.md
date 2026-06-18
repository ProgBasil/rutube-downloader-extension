# Rutube Downloader — Chrome Extension
Предупреждение! Данный проект создан в образовательных целях! Используйте его только для обучения!

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

## Лицензия
MIT License

## Примеры интерфейса 
<img width="472" height="540" alt="image" src="https://github.com/user-attachments/assets/69684bc5-0785-4779-9eb6-6655da719690" />

<img width="458" height="723" alt="image" src="https://github.com/user-attachments/assets/ad4cb62f-1e0b-4d4e-abbc-e20392284d34" />

<img width="462" height="540" alt="image" src="https://github.com/user-attachments/assets/c6ed75c3-eb81-418b-a5a6-2b6e116d96a2" />


