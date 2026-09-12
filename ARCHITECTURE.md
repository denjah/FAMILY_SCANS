# Архитектура Фазы A

```text
Browser
  ├─ invite/password ──> Next.js auth route ──> signed HttpOnly cookie
  ├─ catalog page ─────> server-only manifest
  ├─ image request ────> authenticated media route ──> derivative cache
  └─ memory/comment ───> authenticated API ──> local SQLite (WAL)

Immutable source: Z:/SCAN/{ALENA,DAN,DEN,PAPA,SCANS_2025,БАБУШКА}
Private generated state: SYSTEM_WEB/data + SYSTEM_WEB/generated
Public directory: contains no archive media
```

Публичный идентификатор изображения — воспроизводимый SHA-256 от нормализованного относительного пути. API никогда не принимает путь к файлу. Сервер получает путь только из закрытого manifest и проверяет, что он остается внутри configured root.

SQLite хранит комментарии и авторство сессионного пользователя. Клиентское Zustand-состояние отвечает только за активный снимок, фильтры, масштаб, слайд-шоу и черновик.
