# 📻 Lampa Radio LV

> Плагин радио для [Lampa TV](https://lampa.mx) — латвийские станции и Radio Record прямо в вашем телевизоре.

---

## ⚡ Установка

1. Открыть **Lampa** → Настройки → Плагины
2. Вставить ссылку и сохранить:

```
https://borjanich.github.io/lamparadio/index.js
```

3. Перезапустить приложение — в меню появится пункт **Радио LV**

---

## 📡 Что включено

| Станция | Жанр | Источник |
|---|---|---|
| Radio Record | Electronic / Dance | radiorecord.ru |
| Record Deep | Deep House | radiorecord.ru |
| Record Trap | Trap / Hip-Hop | radiorecord.ru |
| Латвийские станции (до 40) | Разные | radio-browser.info |

Латвийские станции загружаются автоматически с публичного API [radio-browser.info](https://radio-browser.info) и отсортированы по популярности.

---

## 🎮 Управление

| Кнопка | Действие |
|---|---|
| OK / Enter | Воспроизвести станцию |
| OK во время воспроизведения | Остановить |
| ↑ / ↓ | Переключить станцию |
| Back | Вернуться в меню |

---

## 🛠 Разработка

```
borjanich/lamparadio
├── index.js          # Плагин
└── .github/
    └── workflows/
        └── pages.yml # Деплой на GitHub Pages
```

Плагин хостится через **GitHub Pages** — файл отдаётся с правильным `Content-Type: text/javascript`.

---

## 📦 Зависимости

Не требует внешних библиотек. Использует стандартный Lampa API:
- `Lampa.Component` — компонент списка станций
- `Lampa.Template` — шаблоны UI
- `Lampa.Reguest` — сетевые запросы
- `Lampa.Manifest` — метаданные плагина

---

<p align="center">Made for Lampa TV</p>
