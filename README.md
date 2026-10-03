# Радио для Lampa · Radio for Lampa

[Русский](#русский) · [English](#english)

Плагин радио для [Lampa](https://github.com/yumata/lampa): станции Radio Record и латвийские радиостанции, избранное и заставка, которая реагирует на музыку.

A radio plugin for [Lampa](https://github.com/yumata/lampa): Radio Record and Latvian stations, favorites, and a screensaver that reacts to the music.

---

## Русский

### Установка

1. В Lampa откройте **Настройки → Расширения → Добавить плагин**.
2. Вставьте ссылку:

   ```
   https://borjanich.github.io/lamparadio/index.js
   ```

3. Перезапустите Lampa. В главном меню появится пункт **«Радио»**.

Обновления приходят сами: Lampa загружает плагин при каждом запуске.

### Возможности

- **Вкладки:** Избранное, Все, Record, Латвия. На вкладках показано число станций. «Избранное» появляется, когда в нём что-то есть.
- **Избранное:** добавляется и убирается через меню станции. Порядок станций в избранном можно менять.
- **Латвийские станции** идут в том же порядке, что на eradio.lv. Иконки берутся с eradio.lv и сайтов станций, а если их нет — вместо иконки показывается буква. Повторяющиеся станции объединены.
- **Что играет сейчас:** играющая станция подсвечена в списке зелёным, на ней анимированный эквалайзер.
- **Фоновое воспроизведение:** если уйти из «Радио» в другой раздел Lampa, музыка продолжит играть.
- **Устойчивость:** при обрыве поток переподключается сам (до 4 попыток). Громкость меняется в меню станции и запоминается.
- **Последняя станция:** при открытии «Радио» курсор стоит на станции, которая играет сейчас или играла последней.

### Управление

| Кнопка пульта | Действие |
|---|---|
| Вверх / Вниз | Листать список |
| Вверх на первой станции | Перейти к вкладкам |
| Вниз на вкладках | Вернуться в список |
| OK | Слушать / пауза |
| Удерживать OK и отпустить | Меню станции: избранное, порядок, громкость |
| Удерживать OK (~2.5 с) | Открыть заставку |
| Назад | Свернуть, радио продолжит играть |

### Заставка

Включается сама через 30 секунд бездействия, если играет станция. Её можно открыть и вручную — удерживайте OK около 2.5 секунды.

- Обложка и свечение вокруг неё двигаются в такт басу.
- **Влево / Вправо** — переключить станцию в пределах текущей вкладки. По краям видны соседние станции.
- **OK** — пауза и продолжение без выхода из заставки.
- **Любая другая кнопка** — выйти.

Пока открыта заставка, встроенная заставка Lampa не включается.

Многие станции не дают браузеру данные о звуке. На таких станциях свечение ровно пульсирует примерно на 124 BPM — это имитация, а не реальный ритм станции.

### Если что-то не так

- **Нет пункта «Радио» в меню.** Проверьте ссылку в расширениях и перезапустите Lampa.
- **Не подтянулась новая версия.** Перезапустите Lampa.
- **«Поток недоступен. Проверьте соединение.»** Станция не отвечает. Попробуйте позже или выберите другую.
- **Другая проблема.** Опишите её в [Issues](https://github.com/borjanich/lamparadio/issues): устройство, версия Lampa, станция и что именно произошло (не реагирует интерфейс или пропал звук).

### Данные

Избранное, последняя станция и громкость хранятся локально в Lampa на вашем устройстве. Плагин обращается только к спискам станций и к самим радиопотокам.

### Источники

- Radio Record — список станций с [lampaplugins.github.io](https://lampaplugins.github.io/store/stations.json)
- Латвийские станции — [radio-browser.info](https://www.radio-browser.info)
- Иконки латвийских станций — [eradio.lv](https://eradio.lv) и сайты станций

Проверено на Lampa для Android TV (TCL) и Lampa для Windows.

---

## English

### Installation

1. In Lampa, open **Settings → Extensions → Add plugin**.
2. Paste the link:

   ```
   https://borjanich.github.io/lamparadio/index.js
   ```

3. Restart Lampa. A **"Радио"** (Radio) item appears in the main menu.

Updates arrive on their own: Lampa loads the plugin every time it starts.

### Features

- **Tabs:** Favorites, All, Record, Latvia. Each tab shows its station count. Favorites appears once it has something in it.
- **Favorites:** add and remove through the station menu. You can reorder stations in Favorites.
- **Latvian stations** are listed in the same order as on eradio.lv. Icons come from eradio.lv and station websites; when there is none, a letter is shown instead. Duplicate stations are merged.
- **Now playing:** the playing station is highlighted green in the list, with an animated equalizer.
- **Background playback:** leave Radio for another Lampa section and the music keeps playing.
- **Resilience:** the stream reconnects on its own after a drop (up to 4 attempts). Volume is set in the station menu and remembered.
- **Last station:** when you open Radio, the cursor lands on the station that is playing now or was played last.

### Controls

| Remote button | Action |
|---|---|
| Up / Down | Scroll the list |
| Up on the first station | Go to the tabs |
| Down on the tabs | Back to the list |
| OK | Play / pause |
| Hold OK and release | Station menu: favorites, order, volume |
| Hold OK (~2.5 s) | Open the screensaver |
| Back | Minimize, radio keeps playing |

### Screensaver

Starts on its own after 30 seconds of inactivity while a station is playing. You can also open it manually by holding OK for about 2.5 seconds.

- The cover and the glow around it move with the bass.
- **Left / Right** — switch stations within the current tab. Neighboring stations are shown at the sides.
- **OK** — pause and resume without leaving the screensaver.
- **Any other button** — exit.

While it is open, Lampa's built-in screensaver stays off.

Many stations don't let the browser read their audio. On those stations the glow pulses steadily at about 124 BPM — a simulation, not the station's real rhythm.

### Troubleshooting

- **No "Радио" item in the menu.** Check the link in Extensions and restart Lampa.
- **The new version didn't load.** Restart Lampa.
- **"Поток недоступен. Проверьте соединение."** ("Stream unavailable") The station isn't responding. Try later or pick another one.
- **Something else.** Report it in [Issues](https://github.com/borjanich/lamparadio/issues): device, Lampa version, station, and what exactly happened (the interface stopped responding or the sound stopped).

### Data

Favorites, the last station and volume are stored locally in Lampa on your device. The plugin only contacts the station lists and the radio streams themselves.

### Sources

- Radio Record — station list from [lampaplugins.github.io](https://lampaplugins.github.io/store/stations.json)
- Latvian stations — [radio-browser.info](https://www.radio-browser.info)
- Latvian station icons — [eradio.lv](https://eradio.lv) and station websites

Tested on Lampa for Android TV (TCL) and Lampa for Windows.
