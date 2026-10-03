/*
 *  Радио для Lampa — станции Radio Record и латвийские радиостанции.
 *  https://github.com/borjanich/lamparadio
 *
 *  Устройство файла:
 *    1. Настройки и хранилище
 *    2. Названия станций, uid и дедупликация
 *    3. Логотипы и порядок латвийских станций
 *    4. Обложки (каскад источников + память на сессию)
 *    5. Избранное
 *    6. Аудио-движок (один на всё приложение)
 *    7. Экран «Радио»: списки, вкладки, поиск, меню, заставка
 *    8. Запуск плагина: шаблоны, стили, пункт меню
 */
(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════
    //  1. НАСТРОЙКИ И ХРАНИЛИЩЕ
    // ════════════════════════════════════════════════════════════

    var PLUGIN_ID = 'lampa_radio_lv';

    var RECORD_API = 'https://lampaplugins.github.io/store/stations.json';
    var API_LV     = 'https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/LV?hidebroken=true&order=votes&limit=80';

    // Запасные станции Record (только если зеркало со списком недоступно)
    var RECORD_FALLBACK = [
        { title: 'Radio Record', tooltip: 'Главная станция', stream: 'https://radiorecord.hostingradio.ru/rr_main96.aacp', icon: '', group: 'record' },
        { title: 'Record Deep',  tooltip: 'Deep House',      stream: 'https://radiorecord.hostingradio.ru/deep96.aacp', icon: '', group: 'record' },
        { title: 'Record Trap',  tooltip: 'Trap',            stream: 'https://radiorecord.hostingradio.ru/trap96.aacp', icon: '', group: 'record' },
        { title: 'Record Russian Mix', tooltip: 'Русские хиты', stream: 'https://radiorecord.hostingradio.ru/rus96.aacp', icon: '', group: 'record' },
        { title: 'Record Techno', tooltip: 'Techno',          stream: 'https://radiorecord.hostingradio.ru/techno96.aacp', icon: '', group: 'record' }
    ];

    var FAV_KEY    = 'lrv_favorites';
    var LAST_KEY   = 'lrv_last';

    var Store = {
        list: function(key) { var v = Lampa.Storage.get(key, '[]'); return Array.isArray(v) ? v : []; },
        save: function(key, v) { Lampa.Storage.set(key, v); }
    };

    // ════════════════════════════════════════════════════════════
    //  2. НАЗВАНИЯ СТАНЦИЙ, UID И ДЕДУПЛИКАЦИЯ
    // ════════════════════════════════════════════════════════════

    // для хранения в избранном — только нужные поля станции
    function stripState(st) {
        return { title: st.title, tooltip: st.tooltip, stream: st.stream, icon: st.icon, group: st.group, uid: st.uid, record_id: st.record_id, home: st.home };
    }
    // Нормализация названия для сравнения станций: нижний регистр, без
    // хвостов « lv»/«.lv»/« latvia», без пунктуации, пробелы схлопнуты.
    // Так «TOP radio lv» и «TOP Radio» считаются одной станцией.
    function normTitle(name) {
        var s = (name || '').toLowerCase();
        // убираем диакритику: «latviešu» == «latviesu»
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch(e) {}
        s = s
            .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')      // убираем пометки (128k), [LV], {hq}
            .replace(/\b\d{2,3}\s?(kbps|kbit|kb|k|bit)\b/g, ' ') // битрейт
            .replace(/\.(lv|com|fm|net|eu|ru)\b/g, ' ')       // доменные хвосты
            .replace(/\b(lv|latvia|latvija|online|live|stream|radio station|hd|hq|aac|mp3)\b/g, ' ') // слова-шум
            // убираем пунктуацию, символы и эмодзи; буквы любого алфавита остаются
            .replace(/[\u0000-\u001f\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u00d7\u00f7\u2000-\u2bff\u3000-\u303f\ud800-\udfff\ufe00-\ufe0f]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return s;
    }
    function stationUid(st) {
        // Нормализованное название + группа не меняются при смене URL потока и
        // мелких разночтениях — избранное и дедупликация остаются стабильными.
        // Если от названия остался только «шум» (пустая строка), берём исходное
        // название или поток, чтобы такие станции не получили один общий uid.
        var name = normTitle(st.title) || cleanTitle(st.title).toLowerCase() || st.stream || '';
        return Lampa.Utils.hash(name + '|' + (st.group || ''));
    }
    function cleanTitle(name) { return (name || '').replace(/\s+/g, ' ').trim(); }

    // Убираем дубли (одинаковый uid). radio-browser часто отдаёт одну станцию
    // несколькими строками (разный битрейт/поток); uid строится по названию,
    // поэтому они схлопываются в одну. Остаётся первая копия, а если у неё
    // нет иконки — берём иконку у дубля.
    function dedupByUid(list) {
        var seen = {};
        var out = [];
        list.forEach(function(st) {
            var ex = seen[st.uid];
            if (!ex) { seen[st.uid] = st; out.push(st); }
            else if (!ex.icon && st.icon) { ex.icon = st.icon; } // дополняем оставленную копию
        });
        return out;
    }

    // ════════════════════════════════════════════════════════════
    //  3. ЛОГОТИПЫ И ПОРЯДОК ЛАТВИЙСКИХ СТАНЦИЙ
    // ════════════════════════════════════════════════════════════

    // Принудительный https (иначе ТВ блокирует смешанный контент);
    // каскад: логотип -> favicon домена -> аватар с буквой.
    function httpsify(url) {
        if (!url) return '';
        if (url.indexOf('//') === 0) return 'https:' + url;
        return url.replace(/^http:\/\//i, 'https://');
    }
    function domainOf(url) {
        try { return (url || '').split('/')[2] || ''; } catch(e){ return ''; }
    }

    // ── Сопоставление ключевых слов целыми словами ──
    // «pik» не должен находиться в «spiker», «lr 1» — в «lr 10».
    function isWordChar(c) { return !!c && /[a-z0-9\u00c0-\u024f\u0400-\u04ff]/.test(c); }
    function hasKw(t, kw) {
        var from = 0, i;
        while ((i = t.indexOf(kw, from)) >= 0) {
            if (!isWordChar(t.charAt(i - 1)) && !isWordChar(t.charAt(i + kw.length))) return true;
            from = i + 1;
        }
        return false;
    }
    // Запись, у которой совпало самое длинное (самое точное) ключевое слово
    // по всей таблице: «swh rock» побеждает «swh» независимо от порядка.
    function bestKwEntry(map, title) {
        var t = (title || '').toLowerCase(), best = null, bestLen = 0;
        for (var i = 0; i < map.length; i++) {
            for (var k = 0; k < map[i].kw.length; k++) {
                var kw = map[i].kw[k];
                if (kw.length > bestLen && hasKw(t, kw)) { best = map[i]; bestLen = kw.length; }
            }
        }
        return best;
    }

    // ── Логотипы латвийских станций ──
    // Одна таблица: код мини-логотипа eradio.lv (https://eradio.lv/mini/<code>.webp,
    // чистый квадратный логотип почти для любой станции LV — лучший источник)
    // плюс домен самой станции, если известен (apple-touch-icon и т. п.).
    // Совпадение по целым словам; побеждает самое точное ключевое слово.
    var LSM = 'latvijasradio.lsm.lv';
    var LV_LOGOS = [
        { kw: ['swh rock','swh roks'],                code: 'swhrock',        domain: 'radioswhrock.lv' },
        { kw: ['swh plus','swh+'],                    code: 'swhplus',        domain: 'radioswhplus.lv' },
        { kw: ['swh lv'],                             code: 'swhlv',          domain: 'radioswh.lv' },
        { kw: ['swh'],                                code: 'swh',            domain: 'radioswh.lv' },
        { kw: ['skonto plus'],                        code: 'skontoplus',     domain: 'radioskonto.lv' },
        { kw: ['skonto'],                             code: 'skonto',         domain: 'radioskonto.lv' },
        { kw: ['star fm','starfm'],                   code: 'starfm',         domain: 'starfm.lv' },
        { kw: ['ehr superhits','superhits'],          code: 'superhits',      domain: 'ehr.lv' },
        { kw: ['ehr top 40 ru'],                      code: 'ehrtop40ru',     domain: 'ehr.lv' },
        { kw: ['ehr russkie','russkie hiti','krievijas'], code: 'ehrru',      domain: 'ehr.lv' },
        { kw: ['latviešu hiti','latviesu hiti'],      code: 'latviesuhiti',   domain: 'ehr.lv' },
        { kw: ['ehr','european hit'],                 code: 'ehr',            domain: 'ehr.lv' },
        { kw: ['retro fm'],                           code: 'retrofm',        domain: 'retrofm.lv' },
        { kw: ['pieci','pieci.lv','radio 5'],         code: 'pieci',          domain: 'pieci.lv' },
        { kw: ['naba'],                               code: 'naba',           domain: 'naba.lv' },
        { kw: ['latvijas radio 1','lr1','lr 1'],      code: 'lr1',            domain: LSM },
        { kw: ['latvijas radio 2','lr2','lr 2'],      code: 'lr2',            domain: LSM },
        { kw: ['latvijas radio 3','lr3','klasika'],   code: 'lr3',            domain: LSM },
        { kw: ['latvijas radio 4','lr4','doma'],      code: 'lr4',            domain: LSM },
        { kw: ['latvijas radio 5','lr5'],             code: 'lr5',            domain: LSM },
        { kw: ['latvijas radio 6','lr6'],             code: 'lr6',            domain: LSM },
        { kw: ['latvijas radio'],                     code: 'lr1',            domain: LSM },
        { kw: ['top radio'],                          code: 'topradio',       domain: 'topradio.lv' },
        { kw: ['capital fm'],                         code: 'capitalfm',      domain: 'capitalfm.lv' },
        { kw: ['mix fm','mixfm'],                     code: 'mixfm',          domain: 'mixfm.lv' },
        { kw: ['xo fm','xofm'],                       code: 'xofm',           domain: 'xofm.lv' },
        { kw: ['kurzemes'],                           code: 'kurzemesradio',  domain: 'kurzemesradio.lv' },
        { kw: ['radio tev','radio tēv'],              code: 'radiotev',       domain: 'radiotev.lv' },
        { kw: ['power hit','power fm','power'],       code: 'powerhitradio',  domain: 'powerhitradio.lv' },
        { kw: ['spin fm','spin'],                     code: 'spinfm',         domain: 'spinfm.lv' },
        { kw: ['divi','radio divi','radio 2 lv'],     code: 'divi',           domain: 'divi.lv' },
        { kw: ['relax fm','relax'],                   code: 'relaxfm' },
        { kw: ['lounge fm','lounge'],                 code: 'loungefm' },
        { kw: ['schlagertime','schlager'],            code: 'schlagertime' },
        { kw: ['russkoe radio','русское'],            code: 'russkoeradio' },
        { kw: ['radio pik','pik'],                    code: 'radiopik' },
        { kw: ['radio alise','alise'],                code: 'alise' },
        { kw: ['radio 7'],                            code: 'radio7' },
        { kw: ['radio 1'],                            code: 'radio1' },
        { kw: ['l radio'],                            code: 'lradio' },
        { kw: ['latgolys','latgales'],                code: 'latgolysradeja' },
        { kw: ['kristīgais','kristigais','christian'], code: 'lkr' },
        { kw: ['tlig'],                               code: 'tlig' },
        { kw: ['talsi'],                              code: 'talsi' },
        { kw: ['radio atklājumi','atklajumi'],        code: 'atklajumi' }
    ];

    // ── Порядок станций как на eradio.lv («Visas stacijas») ──
    // Латвийские станции сортируются сверху вниз как на eradio.lv. Совпадение
    // по целым словам в названии; всё, чего нет в списке, уходит вниз
    // (в исходном порядке radio-browser). Строки в нижнем регистре.
    var ERADIO_ORDER = [
        'latvijas radio 1','latvijas radio 2','latvijas radio 3','pieci.lv',
        'naba','skonto','star fm','swh plus','swh rock','swh gold','ehr',
        'ehr superhits','ehr plus','ehr latviešu hiti','ehr latviesu hiti','topradio','top radio',
        'retro fm','tev','swh lv','mix fm','radio roks','melodija','swh spin',
        'relax fm','xo fm','lounge fm','autoradio','kurzemes','radio 7','radio 1 jēkabpils',
        'skonto plus','rēzekne','rezekne','alise','njoy','divu krastu','marija',
        'kristīgais radio','kristigais radio','latgales radio','norma','nordic chill out',
        'radio9','radio 9','schlagertime','schlager','pieci ukraiņu','pieci ukrainu','pieci hiti',
        'pieci latvieši','pieci latviesi','pieci latgalieši','pieci latgaliesi','ehr chillout','ehr dance',
        'ehr fresh','tev lv','nemiers','lustīgs','lustigs','energy rus','energy','l radio','talsi',
        'xradio','power fm','ef-ei','ehr party service','ehr latviešu deju','ehr latviesu deju',
        'ehr latviešu hiti reps','ehr latviesu hiti reps','lr 2 vecās','lr 2 vecas','pieci hip hop',
        'chillax','skonto lv','tev dance','skontons','mix fm drum','mix fm house','mix fm party',
        'nordic chillout indie',
        // «swh» последним: «swh plus/rock/lv/gold/spin» длиннее и выигрывают
        'swh'
    ];

    function eradioRank(title) {
        var t = (title || '').toLowerCase();
        // берём самое точное (длинное) совпадение, чтобы «swh»
        // не перебивал «swh plus»
        var best = -1, bestLen = -1;
        for (var i = 0; i < ERADIO_ORDER.length; i++) {
            var kw = ERADIO_ORDER[i];
            if (kw.length > bestLen && hasKw(t, kw)) { best = i; bestLen = kw.length; }
        }
        return best;
    }

    // Сортировка станций LV в порядке eradio.lv; станции не из списка
    // сохраняют исходный взаимный порядок внизу.
    function sortLatvian(list) {
        return list.map(function(s, i){ return { s: s, i: i, r: eradioRank(s.title) }; })
                   .sort(function(a, b) {
                       var ra = a.r < 0 ? 9999 : a.r;
                       var rb = b.r < 0 ? 9999 : b.r;
                       if (ra !== rb) return ra - rb;
                       return a.i - b.i; // стабильность для станций не из списка
                   })
                   .map(function(o){ return o.s; });
    }

    // Лучшие источники обложки LV по приоритету: мини-логотип eradio, затем
    // логотипы с сайта станции. Кэшируется по названию (чистая функция).
    var lvLogoCache = {};
    function lvLogoSources(title) {
        var hit = lvLogoCache[title];
        if (hit) return hit;
        var e = bestKwEntry(LV_LOGOS, title), out = [];
        if (e) {
            var mini = 'eradio.lv/mini/' + e.code + '.webp';
            out.push('https://' + mini);
            // старые ТВ-браузеры не умеют WebP — тот же логотип, перекодированный в PNG
            out.push('https://images.weserv.nl/?url=' + mini + '&output=png');
            if (e.domain) out = out.concat(siteLogoSources(e.domain));
        }
        return (lvLogoCache[title] = out);
    }

    // Логотипы с сайта станции: apple-touch-icon обычно 180px+, иконки
    // DuckDuckGo и Google — запасные (часто мелкие, отсеиваются по размеру).
    function siteLogoSources(domain) {
        if (!domain) return [];
        var d = domain.replace(/^www\./i, '');
        return [
            'https://' + domain + '/apple-touch-icon.png',
            'https://' + domain + '/apple-touch-icon-precomposed.png',
            'https://icons.duckduckgo.com/ip3/' + d + '.ico',
            'https://www.google.com/s2/favicons?sz=128&domain=' + d
        ];
    }

    // ════════════════════════════════════════════════════════════
    //  4. ОБЛОЖКИ
    //  Каскад: логотип eradio -> логотипы сайта станции -> иконка из API ->
    //  аватар с первой буквой. Мелкие размытые картинки — только в крайнем случае.
    // ════════════════════════════════════════════════════════════

    var AVATAR_COLORS = ['#5b6ee1','#27ae60','#e67e22','#c0392b','#8e44ad','#16a085','#2c3e50','#d35400','#2980b9','#c2185b'];
    function avatarFor(title) {
        var t = (title || '?').trim();
        var ch = t.charAt(0).toUpperCase() || '?';
        var idx = Math.abs(Lampa.Utils.hash(t)) % AVATAR_COLORS.length;
        return { letter: ch, color: AVATAR_COLORS[idx] };
    }

    // Память обложек на сессию: сработавший источник станции идёт первым
    // в следующий раз (перестройка списка, поиск, заставка — сразу), а
    // неудачные источники какое-то время пропускаются, без повторных запросов.
    var ART_BAD_MS = 10 * 60 * 1000;
    var artGood = {}, artBad = {};
    function artIsBad(src) { var t = artBad[src]; return t && Date.now() - t < ART_BAD_MS; }

    // Минимальный размер «хорошей» картинки. Мелкие (размытые favicon) не
    // принимаются сразу: каскад идёт дальше в поисках чёткого логотипа, и
    // только если лучше ничего нет — показывается самая крупная из мелких.
    var ART_MIN_PX = 64;
    function minPxFor(src) {
        if (src.indexOf('eradio.lv') >= 0) return 24;     // мини-логотипы eradio всегда подходят
        return ART_MIN_PX;
    }

    // Каскад источников проверяется на отдельной невидимой картинке, поэтому
    // на экране не мелькают промежуточные варианты; в <img> ставится только
    // выбранный. Токен отсекает запоздалые события от прошлого вызова.
    function loadArtwork(imgEl, boxEl, station) {
        if (!imgEl || !boxEl) return;
        var $box = $(boxEl);
        $box.removeClass('loaded loaded-icon').removeAttr('data-letter').css('background-color', '');
        var token = imgEl._artToken = (imgEl._artToken || 0) + 1;
        function stale() { return imgEl._artToken !== token; }

        var all = [];
        if (artGood[station.uid]) all.push(artGood[station.uid]);
        if (station.group === 'latvian') {
            // 1) известная станция LV -> мини-логотип eradio и логотипы её сайта
            all = all.concat(lvLogoSources(station.title));
            // 2) логотипы с домашней страницы станции (из radio-browser)
            all = all.concat(siteLogoSources(domainOf(httpsify(station.home))));
        }
        // 3) собственная иконка станции из API (через https)
        all.push(httpsify(station.icon));
        // 4) Record: favicon домена потока. Для LV не берём — потоки часто
        //    раздаёт чужой хостинг, и получался бы его логотип, а не станции.
        if (station.group !== 'latvian') {
            var dom = domainOf(station.stream) || domainOf(station.icon);
            if (dom) all.push('https://www.google.com/s2/favicons?sz=128&domain=' + dom);
        }

        var sources = [], seen = {};
        all.forEach(function(s){ if (s && !seen[s] && !artIsBad(s)) { seen[s] = 1; sources.push(s); } });

        var i = 0, weak = null, weakPx = 0;
        var probe = new Image();
        function tryNext() {
            if (stale()) return;
            if (i >= sources.length) { if (weak) show(weak); else showAvatar(); return; }
            var src = sources[i++];
            probe.onload = function() {
                if (stale()) return;
                var px = Math.min(probe.naturalWidth || 0, probe.naturalHeight || probe.naturalWidth || 0);
                // сервисы favicon для неизвестных доменов отдают «глобус» 16px — это промах
                if (px && px <= 16) { artBad[src] = Date.now(); tryNext(); return; }
                if (px && px < minPxFor(src)) {
                    if (px > weakPx) { weak = src; weakPx = px; }   // запомним на крайний случай
                    tryNext();
                    return;
                }
                show(src);
            };
            probe.onerror = function() {
                if (stale()) return;
                artBad[src] = Date.now();
                if (artGood[station.uid] === src) delete artGood[station.uid];
                tryNext();
            };
            probe.src = src;
        }
        function show(src) {
            artGood[station.uid] = src;
            imgEl.onload = function() { if (!stale()) $box.addClass('loaded'); };
            imgEl.onerror = function() { if (!stale()) showAvatar(); };
            imgEl.src = src;                                   // уже в кэше браузера — мгновенно
        }
        function showAvatar() {
            var a = avatarFor(station.title);
            imgEl.removeAttribute('src');
            $box.addClass('loaded-icon').attr('data-letter', a.letter)
                .css('--lrv-avatar', a.color)
                .css('background-color', a.color);   // запасной вариант для движков без CSS-переменных
        }
        tryNext();
    }

    // ════════════════════════════════════════════════════════════
    //  5. ИЗБРАННОЕ
    // ════════════════════════════════════════════════════════════

    // Избранное держим в памяти после первого чтения; Storage — только при изменениях.
    var favCache = null, favSet = null;
    var Favorites = {
        get: function() { if (!favCache) favCache = Store.list(FAV_KEY); return favCache; },
        has: function(uid) {
            if (!favSet) { favSet = {}; this.get().forEach(function(a){ favSet[a.uid] = true; }); }
            return favSet[uid] === true;
        },
        save: function(l) { favCache = l; favSet = null; Store.save(FAV_KEY, l); },
        add: function(st) { if (!this.has(st.uid)) this.save(this.get().concat([stripState(st)])); },
        remove: function(st) { this.save(this.get().filter(function(a){ return a.uid !== st.uid; })); },
        toggle: function(st) { if (this.has(st.uid)) this.remove(st); else this.add(st); return this.has(st.uid); },
        move: function(st, dir) {
            var l = this.get().slice();
            var i = l.findIndex(function(a){ return a.uid === st.uid; });
            var j = i + dir;
            if (i < 0 || j < 0 || j >= l.length) return false;
            var t = l[i]; l[i] = l[j]; l[j] = t;
            this.save(l);
            return true;
        }
    };

    // Пересчёт uid избранного под текущую схему stationUid со схлопыванием
    // дублей. Заодно удаляем старые данные: «Недавние» и список станций через прокси.
    function migrateStored() {
        var stored = Store.list(FAV_KEY), before = JSON.stringify(stored), seen = {}, out = [];
        stored.forEach(function(s) {
            var uid = stationUid(s);
            if (seen[uid]) return;
            seen[uid] = 1; s.uid = uid; out.push(s);
        });
        if (JSON.stringify(out) !== before) Store.save(FAV_KEY, out);
        try { window.localStorage.removeItem('lrv_recent'); window.localStorage.removeItem('lrv_proxied'); } catch(e) {}
    }

    // ════════════════════════════════════════════════════════════
    //  6. АУДИО-ДВИЖОК — один экземпляр на всё приложение
    //  Хранит станцию, которая РЕАЛЬНО играет. Интерфейс только подписывается
    //  на него и сам состоянием воспроизведения не владеет.
    //  Рассчитан на слабые встроенные браузеры ТВ:
    //   - автопереподключение, сторож зависаний, таймаут загрузки
    //   - декодер честно освобождается между потоками
    //   - проверка AudioContext + самовосстановление (пересоздание
    //     медиа-элемента, если Web Audio завис)
    //   - запоминание громкости, плавный старт, экран не гаснет
    // ════════════════════════════════════════════════════════════
    function AudioEngine() {
        var audio   = null;
        var hls;
        var current = null;          // станция, загруженная сейчас
        var state   = 'idle';        // idle | loading | playing | paused | error
        var listeners = [];
        var volume    = clampVol(Lampa.Storage.get('lrv_volume', 1));
        var fadeTimer, loadTimer, retryTimer, sysPauseTimer;
        var retries   = 0;
        var MAX_RETRY = 4;
        var lastTime  = 0;
        var wakeLock  = null;
        var manualPause = false;     // пауза пользователя, а не обрыв сети
        var needFade  = false;       // плавное нарастание только при старте потока, не после каждой подгрузки

        // Анализатор Web Audio для эквалайзера заставки (по возможности, необязательно)
        var audioCtx = null, analyser = null, srcNode = null, freqData = null;
        var analyserReady = false, analyserTried = false;
        var webAudioOff = false;     // после самовосстановления Web Audio в этой сессии больше не используется
        var noCors = {};             // потоки без CORS: играют напрямую, без эквалайзера
        var ignorePauseUntil = 0;    // событие pause от нашего же releaseSrc() — не системная пауза
        var ctxBad = 0, lastResume = 0;
        // сторож (работает всегда): прогресс, сон/пробуждение, повтор после ошибки
        var lastProgress = 0, lastBeat = Date.now(), errorAt = 0, hiddenAt = 0, hiddenPos = 0, failNotified = false;
        // играл ли поток всё время `ms` с позиции `from`?
        function keptPlaying(from, ms) {
            try { return audio && !audio.paused && (audio.currentTime - from) >= (ms / 1000) * 0.5; } catch(e) { return false; }
        }

        function clampVol(v){ v = parseFloat(v); if (isNaN(v)) v = 1; return Math.max(0, Math.min(1, v)); }

        // ── Создание (пересоздание) медиа-элемента ──
        // Все обработчики игнорируют события от уже заменённого элемента.
        // CORS-режим нужен только чтобы читать поток через Web Audio (эквалайзер
        // заставки). Поток без CORS-заголовков в этом режиме не грузится вовсе, поэтому
        // для таких потоков элемент создаётся без него (см. обработчик 'error').
        function createAudio(cors) {
            var a = new Audio();
            a.preload = 'none';
            a.volume  = volume;
            if (cors) a.crossOrigin = 'anonymous';

            a.addEventListener('playing', function(){
                if (a !== audio) return;
                a._played = true;
                retries = 0;
                failNotified = false;
                clearTimeout(loadTimer);
                lastTime = a.currentTime; lastProgress = Date.now(); ctxBad = 0;
                if (needFade) { needFade = false; fadeIn(); }
                setState('playing');
                acquireWake();
                setupAnalyser();
                wakeCtx(true);
            });
            a.addEventListener('waiting', function(){
                if (a !== audio) return;
                if (state !== 'idle' && !manualPause) setState('loading');
            });
            a.addEventListener('pause', function(){
                if (a !== audio || state === 'idle') return;
                if (manualPause) { if (state !== 'paused') { setState('paused'); releaseWake(); } return; }
                if (Date.now() < ignorePauseUntil) return;   // это мы сами поставили паузу при смене потока
                // Пауза не наша: ТВ забрал аудиофокус (дежурный режим, смена входа,
                // другое приложение). Ждём немного и переоткрываем живой поток.
                clearTimeout(sysPauseTimer);
                sysPauseTimer = setTimeout(function(){
                    if (a === audio && a.paused && !manualPause && current && (state === 'playing' || state === 'loading')) {
                        revive('paused by system');
                    }
                }, 1500);
            });
            a.addEventListener('ended', function(){ if (a === audio && !manualPause) reconnect('stream ended'); });
            a.addEventListener('error', function(){
                if (a !== audio || !a.getAttribute('src')) return;   // ошибки от освобождения источника игнорируем
                if (state === 'idle' || manualPause) return;
                if (reroute()) return;       // не начав играть — пробуем другой маршрут
                reconnect('audio error');
            });
            return a;
        }

        // Освобождает декодер и сеть текущего потока. src = '' заставляет элемент
        // грузить URL страницы; удаление атрибута + load() — надёжный способ
        // освободить его во встроенных браузерах ТВ.
        function releaseSrc() {
            if (!audio) return;
            if (!audio.paused) ignorePauseUntil = Date.now() + 1000;
            try { audio.pause(); } catch(e) {}
            try { if (audio.getAttribute('src')) { audio.removeAttribute('src'); audio.load(); } } catch(e) {}
        }

        audio = createAudio(true);

        function wantCors(url) { return !webAudioOff && !noCors[url || '']; }

        // Поток упал в CORS-режиме, так и не начав играть: пробуем тот же поток
        // без CORS (без анализа звука), а не тратим попытки переподключения
        // на отсутствие заголовков. true — поток переоткрыт.
        function reroute() {
            if (!current || !audio || audio._played || !audio.crossOrigin || hls) return false;
            var u = current.stream || '';
            if (noCors[u]) return false;
            noCors[u] = true;
            console.log('Radio: stream has no CORS, playing without visuals');
            clearTimers();
            setState('loading');
            open(current);
            return true;
        }

        // Заменяет медиа-элемент новым; старый и его аудиограф выбрасываются
        // (элемент, подключённый к Web Audio, отключить нельзя).
        function replaceAudio(cors) {
            releaseSrc();
            closeCtx();
            analyserTried = false;
            audio = createAudio(cors);
        }

        // ── Анализатор Web Audio ──
        function setupAnalyser() {
            if (analyserTried) return;     // одна попытка на элемент — источник подключается только раз
            analyserTried = true;
            // без CORS чужой поток через Web Audio даёт только тишину
            if (webAudioOff || !audio.crossOrigin) return;
            try {
                var Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                var ctx = new Ctx();
                if (ctx.state !== 'running') {
                    // Подключить элемент к приостановленному контексту = тишина.
                    // Сначала пробуем resume(), подключаем только когда контекст реально работает.
                    var el = audio;
                    try { var rp = ctx.resume(); if (rp && rp.catch) rp.catch(function(){}); } catch(e) {}
                    setTimeout(function(){
                        if (el !== audio || audioCtx || ctx.state !== 'running') {
                            try { ctx.close(); } catch(e) {}
                            return;
                        }
                        attach(ctx);
                    }, 1500);
                    return;
                }
                attach(ctx);
            } catch (e) {
                closeCtx();
                console.log('Radio: bass analyser unavailable:', e.message);
            }
        }
        function attach(ctx) {
            try {
                audioCtx = ctx;
                srcNode  = audioCtx.createMediaElementSource(audio);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.5;    // остальное сглаживание — в отрисовке
                srcNode.connect(analyser);
                analyser.connect(audioCtx.destination);   // выход на динамики, чтобы звук не пропал
                freqData = new Uint8Array(analyser.frequencyBinCount);
                analyserReady = true;
            } catch (e) {
                // поток без CORS или нет поддержки -> тихо работаем без анализатора
                analyserReady = false;
                closeCtx();
                console.log('Radio: bass analyser unavailable:', e.message);
            }
        }

        function closeCtx() {
            try { if (srcNode) srcNode.disconnect(); } catch(e) {}
            try { if (analyser) analyser.disconnect(); } catch(e) {}
            try { if (audioCtx && audioCtx.close) { var p = audioCtx.close(); if (p && p.catch) p.catch(function(){}); } } catch(e) {}
            audioCtx = null; analyser = null; srcNode = null; freqData = null;
            analyserReady = false;
        }

        // Возобновляет приостановленный AudioContext — с ограничением частоты.
        function wakeCtx(force) {
            if (!audioCtx || audioCtx.state === 'running' || audioCtx.state === 'closed') return;
            var now = Date.now();
            if (!force && now - lastResume < 2000) return;
            lastResume = now;
            try { var p = audioCtx.resume(); if (p && p.catch) p.catch(function(){}); } catch(e) {}
        }

        // Когда элемент идёт через Web Audio, зависший контекст означает тишину,
        // которую раньше лечил только перезапуск приложения. Пересоздаём элемент
        // (уже без Web Audio) и продолжаем ту же станцию.
        function heal(reason) {
            console.log('Radio: self-heal (' + reason + ')');
            var st = current;
            clearTimers(); teardownStream();
            webAudioOff = true;          // визуализация дальше — только CSS-«дыхание»
            replaceAudio(false);
            if (st && !manualPause) { setState('loading'); open(st); }
        }

        // После дежурного режима / потери фокуса: выбрасываем старый элемент и
        // аудиограф (их состояние после сна ненадёжно) и переоткрываем поток.
        function revive(reason) {
            if (!current || manualPause) return;
            console.log('Radio: revive (' + reason + ')');
            var st = current;
            clearTimers(); teardownStream();
            replaceAudio(wantCors(st.stream));
            retries = 0;
            setState('loading');
            open(st);
        }

        // Спектр для эквалайзера заставки: заполняет out[0..n-1] значениями 0..1
        // по логарифмическим полосам (от баса к верхам) и возвращает true.
        // false — анализа нет. Если анализатор подключён, но ~1.5 с отдаёт одни
        // нули (поток перенаправлен на сервер без CORS: звук играет, а данные
        // браузер обнуляет), тоже считаем, что анализа нет.
        var flatFrames = 0;
        this.spectrum = function(out) {
            if (!analyserReady || !analyser) return false;
            try {
                wakeCtx(false);
                analyser.getByteFrequencyData(freqData);
                var n = out.length, len = freqData.length, any = 0;
                var top = Math.min(len - 1, Math.round(len * 0.7));   // выше ~15 кГц почти пусто
                for (var k = 0; k < n; k++) {
                    var a = Math.floor(Math.pow(top, k / n));
                    var b = Math.max(a + 1, Math.floor(Math.pow(top, (k + 1) / n)));
                    var m = 0;
                    for (var i = a; i < b && i < len; i++) if (freqData[i] > m) m = freqData[i];
                    any += m;
                    var v = m / 255 * (1 + 0.7 * k / n);              // верхние полосы тише — подтягиваем
                    v = (v - 0.12) / 0.88;                             // тишину — в ноль, контраст выше
                    out[k] = v < 0 ? 0 : v > 1 ? 1 : v;
                }
                if (!any) { if (++flatFrames > 45) return false; }
                else flatFrames = 0;
                return true;
            } catch (e) { return false; }
        };

        function setState(s) { state = s; emit(); }
        function emit() { listeners.forEach(function(fn){ try { fn(current, state); } catch(e){} }); }

        function online() { try { return navigator.onLine !== false; } catch(e) { return true; } }

        // ── Сторож здоровья, работает всегда (каждые 3 с) ──
        // - часы прыгнули => ТВ спал с замороженным JS => revive
        // - нет прогресса 12 с при playing/loading => переподключение
        // - контекст Web Audio завис => heal (пересоздание без Web Audio)
        // - станция упала, но пользователь её не останавливал => тихий повтор раз в 30 с
        setInterval(function(){
            var now = Date.now();
            var gap = now - lastBeat;
            lastBeat = now;
            if (gap > 15000) {
                lastProgress = now;
                // таймеры стояли (дежурный режим) — если только звук не играл в фоне
                if (current && !manualPause && state !== 'idle' && !keptPlaying(lastTime, gap)) { revive('woke after ' + Math.round(gap / 1000) + 's'); return; }
                if (audio) lastTime = audio.currentTime;
            }
            if (!current || manualPause) return;

            if (state === 'playing' || state === 'loading') {
                if (retryTimer) return;      // переподключение уже запланировано — второе не добавляем
                var t = audio ? audio.currentTime : 0;
                if (t !== lastTime && !audio.paused) {
                    lastTime = t; lastProgress = now;
                    if (state === 'loading' && !retryTimer) setState('playing');   // подгрузка закончилась без события
                } else if (now - lastProgress > 12000 && online()) {
                    lastProgress = now;
                    reconnect('no progress');
                    return;
                }
                if (audioCtx && audioCtx.state !== 'running') {
                    wakeCtx(true);
                    if (++ctxBad >= 4) heal('audio context ' + audioCtx.state);
                } else ctxBad = 0;
            } else if (state === 'error' && online() && now - errorAt > 30000) {
                errorAt = now;
                retries = 0;
                setState('loading');
                open(current);
            }
        }, 3000);

        // Сеть вернулась: перезапускаем то, что должно было играть.
        try {
            window.addEventListener('online', function(){
                if (current && !manualPause && (state === 'loading' || state === 'error')) {
                    clearTimers(); retries = 0; setState('loading'); open(current);
                }
            });
        } catch(e) {}

        // ── Автопереподключение с линейной задержкой ──
        function reconnect(reason) {
            if (manualPause || !current) return;
            clearTimers();
            if (!online()) {                 // нет сети: ждём события 'online', а не тратим попытки
                releaseSrc();
                setState('loading');
                return;
            }
            if (retries >= MAX_RETRY) {
                releaseSrc();
                errorAt = Date.now();
                setState('error');
                if (!failNotified) { failNotified = true; Lampa.Noty.show('Поток недоступен. Проверьте соединение.'); }
                releaseWake();
                return;                      // сторож повторит через 30 с
            }
            retries++;
            lastProgress = Date.now();       // ожидание повтора — не зависание
            setState('loading');
            console.log('Radio: reconnect (' + retries + '): ' + reason);
            retryTimer = setTimeout(function(){ retryTimer = null; if (current) open(current); }, 1200 * retries);
        }

        // ── Плавное нарастание громкости при старте ──
        function fadeIn() {
            clearInterval(fadeTimer);
            var target = volume, step = target / 12;
            audio.volume = 0;
            fadeTimer = setInterval(function() {
                var v = audio.volume + step;
                if (v >= target) { audio.volume = target; clearInterval(fadeTimer); }
                else audio.volume = v;
            }, 30);
        }

        function clearTimers(){ clearTimeout(loadTimer); clearTimeout(retryTimer); retryTimer = null; clearTimeout(sysPauseTimer); clearInterval(fadeTimer); }

        function teardownStream() { if (hls) { try{ hls.destroy(); }catch(e){} hls = null; } }

        function open(station) {
            teardownStream();
            clearTimeout(loadTimer);
            clearTimeout(sysPauseTimer);
            var url = station.stream || '';
            var cors = wantCors(url);
            var src = url;
            // CORS-режим нельзя сменить у элемента, уже подключённого к Web Audio
            if (Boolean(audio.crossOrigin) !== cors) replaceAudio(cors);
            else releaseSrc();             // сначала освобождаем прошлый поток
            audio._played = false;         // для каждого потока: начал ли он играть на этом элементе?
            needFade = true;
            audio.volume = volume;
            lastTime = 0; lastProgress = Date.now();

            // таймаут загрузки -> переподключение/ошибка, если ничего не заиграло
            loadTimer = setTimeout(function(){
                if (state === 'loading') reconnect('load timeout');
            }, 12000);

            var useHls = (typeof Hls !== 'undefined' && Hls.isSupported() && url.indexOf('.m3u8') >= 0
                          && !audio.canPlayType('application/vnd.apple.mpegurl'));
            if (useHls) {
                try {
                    hls = new Hls({ liveSyncDuration: 3, enableWorker: true });
                    hls.attachMedia(audio);
                    hls.loadSource(src);
                    hls.on(Hls.Events.MANIFEST_PARSED, play);
                    hls.on(Hls.Events.ERROR, function(e, d){
                        if (!d || !d.fatal) return;
                        if (d.type === 'networkError' && reroute()) return;
                        reconnect('hls fatal');
                    });
                } catch(e) { audio.src = src; audio.load(); play(); }
            } else {
                audio.src = src; audio.load(); play();
            }
        }

        function play() {
            manualPause = false;
            var p;
            try { p = audio.play(); } catch(e) {}
            if (p && p.catch) p.catch(function(e){
                // автозапуск заблокирован или временный сбой — пишем в лог, не падаем
                console.log('Radio: play error:', e && e.message);
            });
        }

        // ── Wake Lock (экран не гаснет, пока играет радио) ──
        function acquireWake() {
            try {
                if ('wakeLock' in navigator && !wakeLock) {
                    navigator.wakeLock.request('screen').then(function(w){
                        wakeLock = w;
                        // система снимает блокировку, когда приложение скрыто
                        try { w.addEventListener('release', function(){ if (wakeLock === w) wakeLock = null; }); } catch(e) {}
                    }).catch(function(){});
                }
            } catch(e) {}
        }
        function releaseWake() {
            try { if (wakeLock) { var w = wakeLock; wakeLock = null; w.release(); } } catch(e) {}
        }

        // Возврат в приложение (смена входа ТВ, главный экран): будим Web Audio
        // и снова берём блокировку экрана, если ещё играем.
        try {
            var onShow = function(){
                var away = hiddenAt ? Date.now() - hiddenAt : 0;
                hiddenAt = 0;
                wakeCtx(true);
                if (away > 5000 && current && !manualPause && state !== 'idle' && !keptPlaying(hiddenPos, away)) revive('back after ' + Math.round(away / 1000) + 's');
                else if (state === 'playing') acquireWake();
            };
            document.addEventListener('visibilitychange', function(){
                if (document.hidden) { hiddenAt = Date.now(); hiddenPos = audio ? audio.currentTime : 0; return; }
                onShow();
            });
            window.addEventListener('pageshow', function(e){ if (e && e.persisted) { hiddenAt = hiddenAt || (Date.now() - 6000); onShow(); } });
        } catch(e) {}

        this.current   = function(){ return current; };
        this.state     = function(){ return state; };
        this.isCurrent = function(st){ return current && st && current.uid === st.uid; };
        this.volume    = function(){ return volume; };
        this.setVolume = function(v) {
            clearInterval(fadeTimer);      // идущее нарастание перебило бы новый уровень
            volume = clampVol(v);
            audio.volume = volume;
            Lampa.Storage.set('lrv_volume', volume);
            emit();
        };

        this.subscribe = function(fn){ listeners.push(fn); return function(){ listeners = listeners.filter(function(f){ return f !== fn; }); }; };

        this.play = function(station) {
            if (!station) return;
            wakeCtx(true);                 // нажатие кнопки = жест пользователя, удобный момент для resume
            if (this.isCurrent(station) && state === 'paused') { this.resume(); return; }
            if (this.isCurrent(station) && (state === 'playing' || state === 'loading')) return;
            current = station;
            retries = 0;
            manualPause = false;
            try { Lampa.Storage.set(LAST_KEY, stripState(station)); } catch(e) {}
            setState('loading');
            open(station);
        };
        this.toggle = function() {
            if (state === 'playing' || state === 'loading') this.pause();
            else if (state === 'paused' || state === 'error') this.resume();
        };
        // Пауза заодно закрывает поток (HLS-сегменты, HTTP-соединение):
        // resume() всё равно переоткрывает живой поток.
        this.pause  = function(){
            manualPause = true;
            clearTimers(); teardownStream(); releaseSrc();
            if (state !== 'idle' && state !== 'paused') setState('paused');
            releaseWake();
        };
        this.resume = function(){
            if (!current) return;
            manualPause = false;
            wakeCtx(true);
            // живой поток после паузы устарел — переоткрываем его, а не доигрываем
            // старый буфер (заодно выходим из состояния ошибки)
            retries = 0;
            setState('loading');
            open(current);
        };
        this.stop = function() {
            manualPause = true;
            clearTimers(); teardownStream(); releaseWake();
            releaseSrc();
            current = null; retries = 0;
            setState('idle');
        };
    }

    var Engine = null; // создаётся при первом открытии экрана

    // ════════════════════════════════════════════════════════════
    //  7. ЭКРАН «РАДИО»
    //  Списки станций, вкладки, поиск, меню станции и заставка.
    // ════════════════════════════════════════════════════════════
    function Component() {
        var _this   = this;
        var network = new Lampa.Reguest();
        var scroll, last;
        var html    = $('<div></div>');
        var filtred = [];
        var record  = [];
        var latvian = [];
        var mode    = 'all';
        var page    = 0;
        var unsub   = null;     // подписка на движок
        var PAGE    = 30;       // строк на одну порцию отрисовки
        var allList = null;     // кэш record+latvian (сбрасывается при перезагрузке списков)
        var rendered = {};      // uid -> узел строки для строк, отрисованных сейчас
        var playingRow = null;  // строка с отметкой «играет» (чтобы не обходить все строки)
        var saverEl = $();      // заставка: живёт прямо в <body>, чтобы перекрывать и шапку Lampa

        if (!Engine) Engine = new AudioEngine();

        // ── Загрузка ─────────────────────────────────
        this.create = function() {
            html.append(Lampa.Template.get('lrv_content', {}));
            // заставку выносим в <body>: внутри экрана Lampa её перекрывала шапка
            saverEl = html.find('.lrv-saver').detach().appendTo('body');
            scroll = new Lampa.Scroll({ mask: true, over: true });
            scroll.onEnd = function() { _this.next(); };
            html.find('.lrv-content__list').append(scroll.render(true));
            scroll.minus(html.find('.lrv-content__head'));

            this.renderSkeletons();

            var pending = 2;
            var done = function() { if (--pending <= 0) _this.onData(); };
            this.loadRecord(done);
            this.loadLatvian(done);

            return this.render();
        };

        // ── Списки станций ──
        // Неудачная загрузка (например, Lampa перезапустилась сразу после
        // пробуждения ТВ, а Wi-Fi ещё не поднялся) повторяется при появлении сети
        // или по таймеру, и список обновляется на месте.
        var listsFull = { record: false, latvian: false }, listRetry = 0, listTimer = null, alive = true;
        var listsBusy = false;  // идёт повторная загрузка (событие online и таймер не должны запустить две)

        function parseRecord(data) {
            if (!(data && data.result && data.result.stations)) return [];
            var stations = data.result.stations.slice().sort(function(a, b){ return (a.sort||0) - (b.sort||0); });
            return dedupByUid(stations.map(function(s) {
                var stream = s.stream_320 || s.stream_128 || (s.stream_hls ? s.stream_hls.replace('playlist.m3u8', '96/playlist.m3u8') : '');
                var st = { title: cleanTitle(s.title), tooltip: s.tooltip || 'Radio Record', stream: stream, icon: s.icon_gray || s.icon || '', group: 'record' };
                st.uid = stationUid(st);
                return st;
            }).filter(function(s){ return s.stream; }));
        }
        function parseLatvian(data) {
            if (!Array.isArray(data)) return [];
            return sortLatvian(dedupByUid(data.filter(function(s){ return s.url_resolved || s.url; }).map(function(s) {
                var st = { title: cleanTitle(s.name), tooltip: (s.tags || '').split(',').slice(0,3).join(' • ') || s.country || '', stream: s.url_resolved || s.url, icon: s.favicon || '', home: s.homepage || '', group: 'latvian' };
                st.uid = stationUid(st);
                return st;
            })));
        }

        function recordFallback() {
            allList = null;
            return RECORD_FALLBACK.map(function(s){ var st = Object.assign({}, s); st.uid = stationUid(st); return st; });
        }

        this.loadRecord = function(cb) {
            network['native'](RECORD_API, function(data) {
                var list = parseRecord(data);
                if (list.length) { record = list; listsFull.record = true; allList = null; }
                else if (!record.length) record = recordFallback();
                cb && cb();
            }, function(){
                if (!record.length) record = recordFallback();
                cb && cb();
            });
        };
        this.loadLatvian = function(cb) {
            var mirrors = [API_LV, API_LV.replace('de1.', 'de2.'), API_LV.replace('de1.', 'fi1.')];
            var i = 0;
            var attempt = function() {
                network['native'](mirrors[i], function(data) {
                    var list = parseLatvian(data);
                    if (list.length) { latvian = list; listsFull.latvian = true; allList = null; cb && cb(); }
                    else next();
                }, next);
            };
            var next = function() { if (++i < mirrors.length) attempt(); else { cb && cb(); } };
            attempt();
        };

        // догружаем то, что не загрузилось, и обновляем вкладки и список на месте
        this.retryLists = function() {
            if (!alive || listsBusy || (listsFull.record && listsFull.latvian)) return;
            clearTimeout(listTimer);
            listsBusy = true;
            var todo = 0, finished = function() {
                if (--todo > 0) return;
                listsBusy = false;
                if (!alive) return;
                _this.buildTabs();
                if (mode === 'all' || mode === 'record' || mode === 'latvian') {
                    var keep = last && last._station ? last._station.uid : null;
                    _this.applyFilter(keep);
                    if (Lampa.Controller.own && Lampa.Controller.own(_this)) _this.restoreFocus();
                }
                if (!(listsFull.record && listsFull.latvian)) _this.scheduleListRetry();
            };
            if (!listsFull.record)  { todo++; _this.loadRecord(finished); }
            if (!listsFull.latvian) { todo++; _this.loadLatvian(finished); }
        };
        this.scheduleListRetry = function() {
            if (!alive || listRetry >= 5 || (listsFull.record && listsFull.latvian)) return;
            clearTimeout(listTimer);
            listTimer = setTimeout(function(){ listRetry++; _this.retryLists(); }, 15000 * (listRetry + 1));
        };
        this._onOnline = function(){ _this.retryLists(); };
        try { window.addEventListener('online', this._onOnline); } catch(e) {}

        this.onData = function() {
            mode = Favorites.get().length ? 'fav' : 'all';
            // курсор на играющую станцию, иначе на ту, что играла в прошлый раз
            var lastSt = Engine.current() || Lampa.Storage.get(LAST_KEY, null);
            this.buildTabs();
            this.applyFilter(lastSt && typeof lastSt === 'object' && lastSt.title ? stationUid(lastSt) : null);

            // подписка на движок -> отметки на строках всегда актуальны
            unsub = Engine.subscribe(function(){
                _this.markPlaying();
                // смена воспроизведения — тоже активность (если жмут только OK),
                // но заставку здесь не закрываем — на этом держится переключение в ней
                if (idleTimer !== null) _this.resetIdle(_this.saverActive());
            });
            this.markPlaying();

            this.resetIdle();   // запуск таймера бездействия / заставки
            this.bindKeys();    // кнопки заставки + долгое нажатие OK (через Lampa.Keypad)

            this.activity.toggle();
            Lampa.Layer.update(html);
            if (!(listsFull.record && listsFull.latvian)) this.scheduleListRetry();
        };

        // ── Кнопки (через Lampa.Keypad — тот же хук, что у заставки Lampa) ──
        // Lampa отдаёт каждую кнопку слушателям ДО активного контроллера и
        // пропускает контроллер, если слушатель вызвал preventDefault().
        // OK срабатывает на keyup, поэтому блокируем его там. Так заставка
        // полностью управляет пультом, какой бы контроллер (меню, поиск,
        // меню станции) Lampa ни считала активным.
        function isEnterCode(c){ return c == 13 || c == 29443 || c == 117 || c == 65385; }
        function fireEvent(el, name) {
            if (!el) return;
            try { var ev = document.createEvent('Event'); ev.initEvent(name, false, true); el.dispatchEvent(ev); } catch(e) {}
        }

        var saverEnterArmed = false;   // текущее нажатие OK началось при открытой заставке
        var swallowEnterUp  = false;   // отпускание долгого нажатия, открывшего заставку
        var pendingLong     = null;    // строка, на которой держат OK: отпустили — меню, держат дальше — заставка
        var longTimer       = null;
        var lastSwitch      = 0;

        this.bindKeys = function() {
            this._keydown = function(e) {
                var code = e.code, ev = e.event;
                if (!_this.isActiveScreen()) return;
                // кнопку уже обработал кто-то раньше нас (заставка Lampa)
                if (ev && ev.defaultPrevented) { _this.resetIdle(saverOn); return; }
                if (!saverOn) { _this.resetIdle(); return; }   // любая кнопка = активность

                // заставка открыта: все кнопки её
                if (ev && ev.preventDefault) ev.preventDefault();
                if (isEnterCode(code)) { saverEnterArmed = true; return; }   // действие — на keyup
                if (code == 37 || code == 39) {
                    var now = Date.now();
                    if (now - lastSwitch < 350) return;   // удерживаемая стрелка не должна дёргать поток
                    lastSwitch = now;
                    _this.resetIdle(true);
                    _this.saverSwitch(code == 39 ? 1 : -1);
                    return;
                }
                _this.hideSaver();                       // любая другая кнопка закрывает заставку
                _this.resetIdle();
            };
            this._keyup = function(e) {
                if (!isEnterCode(e.code)) return;
                var ev = e.event;
                if (pendingLong) {                       // отпустили до порога заставки -> меню
                    clearTimeout(longTimer);
                    var el = pendingLong; pendingLong = null;
                    fireEvent(el, 'hover:long');
                    return;
                }
                if (swallowEnterUp) { swallowEnterUp = false; saverEnterArmed = false; if (ev) ev.preventDefault(); return; }
                if (!saverOn) { saverEnterArmed = false; return; }
                if (ev) ev.preventDefault();             // не даём Lampa вызвать Controller.enter()
                if (saverEnterArmed) { saverEnterArmed = false; _this.resetIdle(true); Engine.toggle(); }
            };

            var K = Lampa.Keypad && Lampa.Keypad.listener;
            if (K && K.follow) {
                K.follow('keydown', this._keydown);
                K.follow('keyup', this._keyup);
                this._keysVia = 'keypad';
            } else {
                // очень старая Lampa без Keypad: перехватываем на window раньше Lampa
                this._rawDown = function(ev){
                    var wrap = { code: ev.keyCode || ev.which, event: ev };
                    _this._keydown(wrap);
                    if (saverOn || ev.defaultPrevented) { ev.preventDefault(); ev.stopPropagation(); }
                };
                this._rawUp = function(ev){
                    var wrap = { code: ev.keyCode || ev.which, event: ev };
                    _this._keyup(wrap);
                    if (ev.defaultPrevented) ev.stopPropagation();
                };
                window.addEventListener('keydown', this._rawDown, true);
                window.addEventListener('keyup', this._rawUp, true);
                this._keysVia = 'window';
            }
        };
        this.unbindKeys = function() {
            var K = Lampa.Keypad && Lampa.Keypad.listener;
            if (this._keysVia === 'keypad' && K && K.remove) {
                K.remove('keydown', this._keydown);
                K.remove('keyup', this._keyup);
            } else if (this._keysVia === 'window') {
                window.removeEventListener('keydown', this._rawDown, true);
                window.removeEventListener('keyup', this._rawUp, true);
            }
            this._keysVia = null;
            clearTimeout(longTimer); pendingLong = null;
        };

        // Lampa вызывает это через ~0.8 с удержания OK. Если играет станция, ждём:
        // отпустили -> меню станции, держат дальше -> заставка.
        this.onLongPress = function() {
            if (saverOn) return;                         // удержание OK внутри заставки игнорируем
            var el = html.find('.focus')[0];
            _this.resetIdle();
            if (!Engine.current() || Engine.state() === 'idle' || !el || !$(el).hasClass('lrv-item')) {
                fireEvent(el, 'hover:long');
                return;
            }
            pendingLong = el;
            clearTimeout(longTimer);
            longTimer = setTimeout(function() {
                if (!pendingLong) return;
                pendingLong = null;
                swallowEnterUp = true;                   // отпускание этого нажатия не должно ставить паузу
                _this.showSaver();
            }, 1700);                                    // ≈2.5 с удержания в сумме
        };

        // ── Заставка (бездействие + играет станция) ──────────────
        var IDLE_MS = 30 * 1000;   // 30 секунд
        var idleTimer = null;
        var saverOn = false;
        var saverGuard = null;
        var saverPending = null, saverPlayTimer = null, slideTimer = null;

        this.isActiveScreen = function() {
            try { var a = Lampa.Activity.active(); if (a && a.activity !== _this.activity) return false; } catch(e) {}
            return true;
        };
        // пользователь смотрит на наш список, а не на меню, поиск или диалог
        this.contentHasControl = function() {
            try { var en = Lampa.Controller.enabled(); if (en && en.name && en.name !== 'content') return false; } catch(e) {}
            return true;
        };

        this.resetIdle = function(keepSaver) {
            if (saverOn && !keepSaver) this.hideSaver();
            clearTimeout(idleTimer);
            idleTimer = setTimeout(function(){ _this.showSaver(); }, IDLE_MS);
        };
        this.stopIdle = function() { clearTimeout(idleTimer); idleTimer = null; };

        // Список для заставки: станции текущей вкладки, а если их нет — все,
        // чтобы «назад/вперёд» всегда было куда листать.
        this.saverList = function() {
            var list = (filtred && filtred.length) ? filtred : this.sourceFor(mode);
            if (!list || !list.length) list = record.concat(latvian);
            return list;
        };
        function indexOfUid(list, st) {
            if (!st) return -1;
            for (var i = 0; i < list.length; i++) { if (list[i].uid === st.uid) return i; }
            return -1;
        }

        this.renderSaver = function(station) {
            var st = station || Engine.current();
            if (!st) return;
            var list = this.saverList();
            var idx = indexOfUid(list, st);

            var box = saverEl;
            box.find('.lrv-saver__title').text(st.title || '');
            box.find('.lrv-saver__sub').text(st.tooltip || '');
            var artBx = box.find('.lrv-saver__art');
            artBx.removeClass('loaded loaded-icon').removeAttr('data-letter').css('background-color', '');
            loadArtwork(box.find('.lrv-saver__img')[0], artBx[0], st);

            function fillNeighbor(node, s) {
                var $n = $(node);
                if (!s) { $n.css('visibility', 'hidden'); return; }
                $n.css('visibility', 'visible');
                $n.find('.lrv-saver__nname').text(s.title || '');
                var bx = $n.find('.lrv-saver__nart');
                bx.removeClass('loaded loaded-icon').removeAttr('data-letter').css('background-color', '');
                loadArtwork($n.find('img')[0], bx[0], s);
            }

            var hasMany = idx >= 0 && list.length > 1;
            // левая сторона: n1 — ближайшая (idx-1), n2 и n3 дальше
            for (var p = 1; p <= 3; p++) {
                fillNeighbor(box.find('.lrv-saver__side--prev .lrv-saver__n' + p)[0], hasMany && list.length > p ? list[(idx - p + list.length) % list.length] : null);
                fillNeighbor(box.find('.lrv-saver__side--next .lrv-saver__n' + p)[0], hasMany && list.length > p ? list[(idx + p) % list.length] : null);
            }
        };

        // Смена станции прямо в заставке. dir = -1 назад, +1 вперёд.
        // Картинка меняется сразу, а поток запускается, когда стрелки затихнут,
        // чтобы быстрое листание не открывало поток на каждое нажатие.
        this.saverSwitch = function(dir) {
            var list = this.saverList();
            if (!list.length) return;
            var idx = indexOfUid(list, saverPending || Engine.current());
            var nextSt = list[idx < 0 ? 0 : (idx + dir + list.length) % list.length];
            if (!nextSt) return;
            saverPending = nextSt;

            var box = saverEl;
            box.removeClass('lrv-saver--slidenext lrv-saver--slideprev');
            void box[0].offsetWidth;                     // перезапуск анимации сдвига
            box.addClass(dir > 0 ? 'lrv-saver--slidenext' : 'lrv-saver--slideprev');
            clearTimeout(slideTimer);
            slideTimer = setTimeout(function(){ box.removeClass('lrv-saver--slidenext lrv-saver--slideprev'); }, 200);
            this.renderSaver(nextSt);

            clearTimeout(saverPlayTimer);
            saverPlayTimer = setTimeout(function() {
                var st = saverPending; saverPending = null;
                if (st) Engine.play(st);
            }, 500);
        };

        this.showSaver = function() {
            if (saverOn) return;                         // никогда не открываем вторую заставку / второй цикл анимации
            if (!this.isActiveScreen()) return;          // start() включит таймер снова, когда вернёмся
            if (!Engine.current() || Engine.state() === 'idle' || !this.contentHasControl()) { this.resetIdle(); return; }
            saverPending = null;
            this.renderSaver();
            saverEl.addClass('show');
            html.addClass('lrv-saving');
            saverOn = true;
            this.startBass();
            this.startSaverGuard();
        };

        this.hideSaver = function() {
            var wasOn = saverOn;
            saverOn = false;
            saverEnterArmed = false;
            clearInterval(saverGuard); saverGuard = null;
            // станцию выбрали стрелками, но ещё не запустили — запускаем сейчас
            if (saverPending) {
                clearTimeout(saverPlayTimer);
                var st = saverPending; saverPending = null;
                Engine.play(st);
            }
            if (!wasOn) return;
            saverEl.removeClass('show');
            html.removeClass('lrv-saving');
            this.stopBass();
        };

        this.saverActive = function(){ return saverOn; };

        // Страховка, пока открыта заставка: закрываем её, если наш экран или
        // список потеряли управление, и не даём заставке Lampa открыться поверх
        // нашей (встроенный плеер делает так же во время видео).
        this.startSaverGuard = function() {
            clearInterval(saverGuard);
            saverGuard = setInterval(function() {
                if (!saverOn) { clearInterval(saverGuard); saverGuard = null; return; }
                if (!_this.isActiveScreen() || !_this.contentHasControl()) { _this.hideSaver(); _this.resetIdle(); return; }
                try { if (Lampa.Screensaver && Lampa.Screensaver.resetTimer) Lampa.Screensaver.resetTimer(); } catch(e) {}
            }, 2000);
        };

        // ── Реакция на бас: белое свечение вокруг обложки, как у сабвуфера ──
        // Слои: мягкое белое свечение за обложкой, белый ореол вплотную к ней
        // и сама обложка — всё пульсирует от баса. Каждый кадр меняются только
        // transform и opacity заранее отрисованных слоёв (это делает видеокарта),
        // запись пропускается, если видимо ничего не изменилось. Цикл всегда
        // один — за этим следит токен.
        //   есть анализ звука  -> удар определяется по резкому приросту баса
        //                         (точнее, чем по громкости), быстрый подъём и спад
        //   анализа нет        -> ровный пульс ~124 BPM в том же стиле (поток без
        //   (напр. EHR)           CORS: звук есть, а данных для анализа браузер не даёт)
        //   пауза / загрузка   -> свечение плавно гаснет
        var bassRAF = null, bassToken = 0;
        this.startBass = function() {
            var box   = saverEl;
            var art   = box.find('.lrv-saver__art')[0];
            var glow  = box.find('.lrv-saver__glow')[0];
            var thump = box.find('.lrv-saver__thump')[0];
            if (!art) return;
            if (bassRAF) { cancelAnimationFrame(bassRAF); bassRAF = null; }
            var token = ++bassToken;

            var bands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            var cone = 0, level = 0, prevBass = 0, fluxAvg = 0.02, lastHit = 0;
            var lastFrame = 0, shown = -1, simNext = 0, simStep = 0;
            var SIM_MS = 60000 / 124;                    // доля пульса без анализа

            var tick = function(ts) {
                if (!saverOn || token !== bassToken) return;
                bassRAF = requestAnimationFrame(tick);
                if (ts - lastFrame < 33) return;         // не чаще ~30 кадров/с
                var f = lastFrame ? Math.min(3, (ts - lastFrame) / 33) : 1;   // поправка на пропуски
                lastFrame = ts;

                var st = Engine.state();
                if (st === 'playing' && Engine.spectrum(bands)) {
                    // бас = нижние 3 полосы спектра; удар — резкий прирост выше среднего
                    var b = (bands[0] + bands[1] + bands[2]) / 3;
                    var flux = Math.max(0, b - prevBass);
                    prevBass = b;
                    fluxAvg += (flux - fluxAvg) * Math.min(1, 0.06 * f);
                    var target = b * b * 0.25;           // фон — громкость баса (слабо: в танцевальной музыке бас громкий всегда)
                    if (flux > fluxAvg * 2 + 0.03 && b > 0.2 && ts - lastHit > 230) {
                        lastHit = ts;
                        target = Math.max(target, Math.min(1, 0.6 + b * 0.45));
                    }
                    if (target > cone) cone = target;                       // мгновенная атака
                    else cone += (target - cone) * Math.min(1, 0.4 * f);    // быстрый спад
                    simNext = 0;
                } else if (st === 'playing') {
                    // пульс ~124 BPM: сильная доля, слабая, сильная, слабая
                    if (!simNext || ts >= simNext) {
                        cone = simStep % 2 === 0 ? 0.85 : 0.5;
                        simStep = (simStep + 1) % 4;
                        simNext = (simNext && ts - simNext < SIM_MS ? simNext : ts) + SIM_MS;
                    }
                    cone *= Math.pow(0.84, f);
                } else {
                    cone *= Math.pow(0.88, f);           // пауза / загрузка: гаснет
                    simNext = 0;
                }
                level += (cone - level) * Math.min(1, 0.5 * f);   // свечение чуть мягче обложки

                var q = Math.round(cone * 200) * 1000 + Math.round(level * 200);
                if (q === shown) return;                 // пропускаем записи, которых не будет видно
                shown = q;
                var s = 'scale(' + (1 + cone * 0.12).toFixed(3) + ')';
                art.style.transform = s;
                if (thump) { thump.style.transform = s; thump.style.opacity = Math.min(1, cone * 0.9).toFixed(2); }
                if (glow) {
                    glow.style.transform = 'scale(' + (1 + level * 0.05).toFixed(3) + ')';
                    glow.style.opacity = (0.12 + level * 0.6).toFixed(2);
                }
            };
            bassRAF = requestAnimationFrame(tick);
        };
        this.stopBass = function() {
            bassToken++;
            if (bassRAF) { cancelAnimationFrame(bassRAF); bassRAF = null; }
            saverEl.find('.lrv-saver__art, .lrv-saver__thump, .lrv-saver__glow').each(function(){
                this.style.transform = ''; this.style.opacity = '';
            });
        };

        // ── Скелетоны (заглушки при загрузке) ────────
        this.renderSkeletons = function() {
            scroll.clear();
            for (var i = 0; i < 8; i++) {
                scroll.append($(
                    '<div class="lrv-item lrv-skeleton">' +
                        '<div class="lrv-item__cover"><div class="lrv-item__cover-box lrv-sk"></div></div>' +
                        '<div class="lrv-item__body">' +
                            '<div class="lrv-sk lrv-sk--line" style="width:' + (40 + Math.random()*40) + '%"></div>' +
                            '<div class="lrv-sk lrv-sk--line lrv-sk--sub" style="width:' + (25 + Math.random()*35) + '%"></div>' +
                        '</div>' +
                    '</div>'
                ));
            }
            Lampa.Layer.visible(scroll.render(true));
        };

        // ── Вкладки ─────────────────────────────────
        this.tabDefs = function() {
            var defs = [];
            var fav = Favorites.get().length;
            if (fav) defs.push({ id: 'fav', name: 'Избранное', count: fav });
            defs.push({ id: 'all',     name: 'Все',     count: this.sourceFor('all').length });
            defs.push({ id: 'record',  name: 'Record',  count: record.length });
            defs.push({ id: 'latvian', name: 'Латвия',  count: latvian.length });
            return defs;
        };

        this.buildTabs = function() {
            var head = html.find('.lrv-content__head');
            head.empty();

            this.tabDefs().forEach(function(d) {
                var badge = d.count != null ? '<span class="lrv-tab__badge">' + d.count + '</span>' : '';
                var btn = $('<div class="simple-button simple-button--filter selector lrv-tab" data-tab="' + d.id + '">' + d.name + badge + '</div>');
                btn.on('hover:enter', function() {
                    if (mode === d.id) { _this.focusList(); return; }
                    mode = d.id;
                    _this.applyFilter();
                    _this.focusList();
                });
                head.append(btn);
            });
            html.find('.lrv-tab[data-tab="' + mode + '"]').addClass('active');
        };

        // ── Фильтр ──────────────────────────────────
        this.sourceFor = function(m) {
            if (m === 'fav') {
                // сохранённые копии заменяем живыми данными станции (свежий поток,
                // сайт для логотипа), если станция есть в загруженных списках
                var live = {};
                this.sourceFor('all').forEach(function(s){ live[s.uid] = s; });
                return dedupByUid(Favorites.get().map(function(f){ return live[f.uid] || f; }));
            }
            if (m === 'record')  return record;
            if (m === 'latvian') return latvian;
            return allList || (allList = dedupByUid(record.concat(latvian)));
        };

        this.applyFilter = function(keepUid) {
            // вкладки «Избранное» больше нет (опустело) — переходим во «Все»
            if (mode === 'fav' && !Favorites.get().length) mode = 'all';

            filtred = this.sourceFor(mode);
            html.find('.lrv-tab').removeClass('active');
            html.find('.lrv-tab[data-tab="' + mode + '"]').addClass('active');
            this.display(keepUid);
        };

        this.display = function(keepUid) {
            scroll.clear();
            scroll.reset();
            last = false;
            page = 0;
            rendered = {};
            playingRow = null;
            if (filtred.length) {
                this.next();
                // куда поставить курсор: на заданную станцию, иначе на первую строку
                var target = null;
                if (keepUid) {
                    // дорисовываем порции, пока нужная станция не окажется в списке
                    var at = -1;
                    for (var i = 0; i < filtred.length; i++) { if (filtred[i].uid === keepUid) { at = i; break; } }
                    while (at >= 0 && page * PAGE <= at) this.next();
                    target = rendered[keepUid];
                }
                if (!target) target = rendered[filtred[0].uid];
                if (target) { last = target; }
            } else {
                var hint = mode === 'fav' ? 'Избранное пусто. Удерживайте OK на станции в любой вкладке, чтобы добавить.' : 'Станции не загрузились.';
                scroll.append($('<div class="lrv-empty"></div>').text(hint));
                last = false;
            }
            Lampa.Layer.visible(scroll.render(true));
        };

        // Возвращает фокус контроллера на текущую строку (или на вкладки, если
        // список пуст), чтобы после перестройки фокус не терялся.
        this.restoreFocus = function() {
            var target = (last && $(last).hasClass('lrv-item')) ? last : html.find('.lrv-item')[0];
            if (target) {
                last = target;
                Lampa.Controller.collectionSet(html);
                Lampa.Controller.collectionFocus(target, html);
            } else {
                // список пуст (например, убрали последнее избранное) -> фокус на вкладки
                var tab = html.find('.lrv-tab.active')[0] || html.find('.lrv-tab')[0];
                if (tab) {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(tab, html);
                }
            }
        };

        this.next = function() {
            var start = page * PAGE;
            var slice = filtred.slice(start, start + PAGE);
            slice.forEach(function(s){ _this.append(s); });
            if (slice.length) page++;
            this.markPlaying();
            Lampa.Layer.visible(scroll.render(true));
            // обложки грузим только для первых строк (дёшево); остальные — по фокусу
            if (page === 1) this.loadInitialArt();
        };

        // отмечает строку, которая играет / грузится / на паузе (независимо от фокуса)
        this.markPlaying = function() {
            var cur = Engine.current();
            var st  = Engine.state();
            var row = cur && st !== 'idle' ? rendered[cur.uid] || null : null;
            if (playingRow && playingRow !== row) $(playingRow).removeClass('playing paused loading');
            playingRow = row;
            if (row) {
                $(row).addClass('playing')
                      .toggleClass('paused', st === 'paused')
                      .toggleClass('loading', st === 'loading');
            }
        };

        // ── Строка списка ───────────────────────────
        this.append = function(station) {
            // защита: одна и та же станция не рисуется в списке дважды
            if (rendered[station.uid]) return;

            var item   = Lampa.Template.get('lrv_item', {});
            item.attr('data-uid', station.uid);
            item.find('.lrv-item__title').text(station.title);
            item.find('.lrv-item__tooltip').text(station.tooltip || '');

            // Обложка откладывается: станция хранится на узле, картинка грузится рядом
            // с фокусом. Быстрая прокрутка остаётся плавной — без сетевых запросов на каждую строку.
            item[0]._station = station;
            item[0]._artLoaded = false;

            item.toggleClass('favorite', Favorites.has(station.uid));
            rendered[station.uid] = item[0];

            item.on('hover:focus', function() {
                last = item[0];
                scroll.update(item);
                _this.loadRowArt(item[0]);     // обложка строки в фокусе
                _this.loadNearby(item[0]);     // и нескольких соседних
            });
            item.on('hover:enter', function() {
                if (Engine.isCurrent(station)) Engine.toggle();
                else Engine.play(station);
            });
            item.on('hover:long', function(){ _this.stationMenu(station, item); });

            if (!last) { last = item[0]; }
            if (Lampa.Controller.own(_this)) Lampa.Controller.collectionAppend(item);
            scroll.append(item);
        };

        // Обложка для одной строки (один раз).
        this.loadRowArt = function(node) {
            if (!node || node._artLoaded || !node._station) return;
            node._artLoaded = true;
            var $n = $(node);
            loadArtwork($n.find('img')[0], $n.find('.lrv-item__cover-box')[0], node._station);
        };

        // Обложки для соседей строки в фокусе (окно вперёд), чтобы картинки
        // были готовы, когда до них долистают.
        // соседняя строка списка (dir = -1 выше, +1 ниже) без обхода всего списка
        function sibRow(node, dir) {
            var n = node;
            do { n = n && (dir < 0 ? n.previousElementSibling : n.nextElementSibling); }
            while (n && !(n.classList && n.classList.contains('lrv-item')));
            return n || null;
        }

        this.loadNearby = function(node) {
            var n, k;
            for (n = sibRow(node, -1), k = 0; n && k < 2; n = sibRow(n, -1), k++) _this.loadRowArt(n);
            for (n = sibRow(node, 1),  k = 0; n && k < 6; n = sibRow(n, 1),  k++) _this.loadRowArt(n);
        };

        // Обложки первых строк после перерисовки, чтобы первый экран
        // сразу показывал логотипы, не дожидаясь фокуса.
        this.loadInitialArt = function() {
            filtred.slice(0, 10).forEach(function(s){ _this.loadRowArt(rendered[s.uid]); });
        };

        // Сверяет сердечки на отрисованных строках с избранным.
        // Вызывается после любого изменения избранного — сердечки верны во всех вкладках.
        this.refreshFavorites = function() {
            Object.keys(rendered).forEach(function(uid) {
                $(rendered[uid]).toggleClass('favorite', Favorites.has(uid));
            });
        };

        // ── Меню станции ────────────────────────────
        this.stationMenu = function(station, item) {
            var isFav = Favorites.has(station.uid);
            var items = [];
            // Во вкладке «Избранное» сначала порядок (меньше нажатий):
            // вверх/вниз первыми, «убрать из избранного» — в конце.
            if (mode === 'fav') {
                items.push({ title: '⬆ Вверх', action: 'up' });
                items.push({ title: '⬇ Вниз',  action: 'down' });
                if (!Engine.isCurrent(station)) items.push({ title: '▶ Воспроизвести', action: 'play' });
                items.push({ title: '💔 Убрать из избранного', action: 'fav' });
            } else {
                if (!Engine.isCurrent(station)) items.push({ title: '▶ Воспроизвести', action: 'play' });
                items.push({ title: isFav ? '💔 Убрать из избранного' : '❤️ В избранное', action: 'fav' });
            }
            items.push({ title: '🔊 Громкость: ' + Math.round(Engine.volume() * 100) + '%', action: 'volume' });
            Lampa.Select.show({
                title: station.title,
                items: items,
                onSelect: function(a) {
                    if (a.action === 'play')        Engine.play(station);
                    else if (a.action === 'volume') { _this.volumeMenu(); return; }
                    else if (a.action === 'fav') {
                        var nowFav = Favorites.toggle(station);
                        Lampa.Noty.show(nowFav ? 'Добавлено в избранное' : 'Убрано из избранного');
                        _this.buildTabs();
                        if (mode === 'fav') {
                            // удаление во вкладке «Избранное» перестраивает список; фокус
                            // оставляем рядом (следующая строка или вкладки)
                            var rows = html.find('.lrv-item').toArray();
                            var curIdx = rows.indexOf(item[0]);
                            var stillFav = Favorites.get().length > 0;
                            // избранное опустело: вкладка сменилась — остаёмся на этой станции
                            _this.applyFilter(stillFav ? null : station.uid);
                            if (stillFav) {
                                var newRows = html.find('.lrv-item').toArray();
                                last = newRows[Math.min(curIdx, newRows.length - 1)] || false;
                            }
                            _this.restoreFocus();
                            Lampa.Controller.toggle('content');
                            return;
                        } else {
                            _this.refreshFavorites();
                        }
                    } else if (a.action === 'up' || a.action === 'down') {
                        if (Favorites.move(station, a.action === 'up' ? -1 : 1)) {
                            _this.applyFilter();
                            var el = rendered[station.uid];
                            if (el) { last = el; }
                            _this.restoreFocus();
                            if (el) scroll.update($(el));
                            Lampa.Controller.toggle('content');
                            return;
                        }
                    }
                    Lampa.Controller.toggle('content');
                },
                onBack: function(){ Lampa.Controller.toggle('content'); }
            });
        };

        this.volumeMenu = function() {
            var cur = Math.round(Engine.volume() * 100);
            Lampa.Select.show({
                title: 'Громкость',
                items: [100, 80, 60, 40, 20, 10].map(function(p){
                    return { title: (Math.abs(cur - p) < 5 ? '✔ ' : '') + p + '%', value: p / 100 };
                }),
                onSelect: function(a) { Engine.setVolume(a.value); Lampa.Controller.toggle('content'); },
                onBack: function(){ Lampa.Controller.toggle('content'); }
            });
        };

        // ── Навигация ───────────────────────────────
        this.background = function(){ Lampa.Background.immediately(''); };

        // Где сейчас фокус? (строка списка / вкладка)
        this.zone = function() {
            var f = html.find('.focus')[0] || last;
            if (!f) return 'list';
            if ($(f).hasClass('lrv-tab')) return 'tab';
            return 'list';
        };

        this.focusList = function() {
            var target = last && $(last).hasClass('lrv-item') ? last : html.find('.lrv-item')[0];
            if (target) { last = target; Lampa.Controller.collectionFocus(target, html); }
        };
        this.focusTabs = function() {
            var active = html.find('.lrv-tab.active')[0] || html.find('.lrv-tab')[0];
            if (active) Lampa.Controller.collectionFocus(active, html);
        };
        // true, только если шаг вверх/вниз попадает на другую строку списка
        // (чтобы список не перескакивал на вкладки сверху).
        this.canMoveWithinList = function(dir) {
            var cur = html.find('.lrv-item.focus')[0] || last;
            if (!cur || !$(cur).hasClass('lrv-item')) return false;
            return Boolean(sibRow(cur, dir === 'up' ? -1 : 1));
        };

        this.start = function() {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) return;
            this.background();

            // Любая кнопка сбрасывает таймер бездействия. Если открыта заставка,
            // кнопка только закрывает её и больше ничего в интерфейсе не делает.
            function gate(fn) {
                return function() {
                    var wasSaver = _this.saverActive();
                    _this.resetIdle();
                    if (wasSaver) return;
                    fn();
                };
            }

            Lampa.Controller.add('content', {
                link: this,
                toggle: function() {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(last || false, html);
                },
                left: function() {
                    if (_this.saverActive()) { _this.resetIdle(true); _this.saverSwitch(-1); return; }
                    _this.resetIdle();
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function() {
                    if (_this.saverActive()) { _this.resetIdle(true); _this.saverSwitch(1); return; }
                    _this.resetIdle();
                    if (Navigator.canmove('right')) Navigator.move('right');
                },
                up: gate(function() {
                    var z = _this.zone();
                    if (z === 'tab') { return; }   // вкладки — верхний ряд, в шапку Lampa не уходим
                    // в списке шаги листают; на самой верхней строке — переход на вкладки
                    if (_this.canMoveWithinList('up')) Navigator.move('up');
                    else _this.focusTabs();                    // на верхней строке -> вкладки
                }),
                down: gate(function() {
                    var z = _this.zone();
                    if (z === 'tab') { _this.focusList(); return; }   // вкладки -> обратно в список
                    if (_this.canMoveWithinList('down')) { Navigator.move('down'); return; }
                    // на последней отрисованной строке: дорисовываем порцию и шагаем вниз
                    if (page * PAGE < filtred.length) {
                        _this.next();
                        Navigator.move('down');
                    }
                }),
                // OK оставлен Lampa (родная анимация нажатия + hover:enter);
                // в заставке сюда не доходит — его перехватывает bindKeys().
                long: function(){ _this.onLongPress(); },
                back: function() {
                    if (_this.saverActive()) { _this.resetIdle(); return; } // будим заставку, а не выходим
                    _this.stopIdle();
                    Lampa.Activity.backward();   // радио продолжает играть в фоне
                }
            });
            Lampa.Controller.toggle('content');
            this.resetIdle();            // вернулись на наш экран: снова запускаем таймер заставки
        };

        this.pause   = function(){};
        this.stop    = function(){};
        this.render  = function(){ return html; };
        this.destroy = function() {
            if (unsub) unsub();
            this.stopIdle();
            this.hideSaver();
            this.unbindKeys();
            alive = false; clearTimeout(listTimer);
            try { window.removeEventListener('online', this._onOnline); } catch(e) {}
            clearTimeout(saverPlayTimer); clearTimeout(slideTimer);
            network.clear();
            if (scroll) scroll.destroy();
            saverEl.remove();
            html.remove();
            // ВАЖНО: движок намеренно НЕ останавливается — радио играет
            // и после ухода с экрана, как в обычном плеере.
        };
    }

    // ════════════════════════════════════════════════════════════
    //  8. ЗАПУСК ПЛАГИНА
    //  Шаблоны, стили, пункт «Радио» в главном меню.
    // ════════════════════════════════════════════════════════════
    function startPlugin() {
        window[PLUGIN_ID] = true;
        migrateStored();
        Lampa.Lang.add({ lrv_title: { ru: 'Радио', en: 'Radio', uk: 'Радіо' } });

        var manifest = { type: 'audio', version: '1.28.3', name: Lampa.Lang.translate('lrv_title'), description: 'Radio: Record + Latvia', component: 'lrv' };
        Lampa.Manifest.plugins = manifest;

        var ICON =
            '<svg viewBox="0 0 38 31" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="17.6" width="3" height="16.3" rx="1.5" transform="rotate(63.5 17.6 0)" fill="currentColor"/>' +
            '<circle cx="13" cy="19" r="6" fill="currentColor"/>' +
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M0 11a4 4 0 0 1 4-4h30a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4zm21 8a8 8 0 1 1-16 0 8 8 0 0 1 16 0m9.5-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" fill="currentColor"/></svg>';

        Lampa.Template.add('lrv_content',
            '<div class="lrv-wrap">' +
                '<div class="lrv-content">' +
                    '<div class="lrv-content__head"></div>' +
                    '<div class="lrv-content__body">' +
                        '<div class="lrv-content__list"></div>' +
                    '</div>' +
                '</div>' +
                // заставка (появляется после бездействия, пока играет станция)
                '<div class="lrv-saver">' +
                    '<div class="lrv-saver__stage">' +
                        '<div class="lrv-saver__side lrv-saver__side--prev">' +
                            '<div class="lrv-saver__neighbor lrv-saver__n3"><div class="lrv-saver__nart"><img /><div class="lrv-saver__nph">' + ICON + '</div></div></div>' +
                            '<div class="lrv-saver__neighbor lrv-saver__n2"><div class="lrv-saver__nart"><img /><div class="lrv-saver__nph">' + ICON + '</div></div></div>' +
                            '<div class="lrv-saver__neighbor lrv-saver__n1"><div class="lrv-saver__nart"><img /><div class="lrv-saver__nph">' + ICON + '</div></div><div class="lrv-saver__nname"></div></div>' +
                            '<div class="lrv-saver__arrow">‹</div>' +
                        '</div>' +
                        '<div class="lrv-saver__center">' +
                            '<div class="lrv-saver__well">' +
                                '<div class="lrv-saver__glow"></div>' +
                                '<div class="lrv-saver__thump"></div>' +
                                '<div class="lrv-saver__art"><img class="lrv-saver__img" /><div class="lrv-saver__ph">' + ICON + '</div></div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="lrv-saver__side lrv-saver__side--next">' +
                            '<div class="lrv-saver__arrow">›</div>' +
                            '<div class="lrv-saver__neighbor lrv-saver__n1"><div class="lrv-saver__nart"><img /><div class="lrv-saver__nph">' + ICON + '</div></div><div class="lrv-saver__nname"></div></div>' +
                            '<div class="lrv-saver__neighbor lrv-saver__n2"><div class="lrv-saver__nart"><img /><div class="lrv-saver__nph">' + ICON + '</div></div></div>' +
                            '<div class="lrv-saver__neighbor lrv-saver__n3"><div class="lrv-saver__nart"><img /><div class="lrv-saver__nph">' + ICON + '</div></div></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="lrv-saver__title"></div>' +
                    '<div class="lrv-saver__sub"></div>' +
                    '<div class="lrv-saver__hint">‹ ›  переключить · любая кнопка — выход</div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_item',
            '<div class="lrv-item selector layer--visible">' +
                '<div class="lrv-item__cover"><div class="lrv-item__cover-box"><img /><div class="lrv-item__ph">' + ICON + '</div></div></div>' +
                '<div class="lrv-item__body"><div class="lrv-item__title"></div><div class="lrv-item__tooltip"></div></div>' +
                '<div class="lrv-item__state">' +
                    '<div class="lrv-item__fav"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path class="lrv-heart" d="M12 21s-8.5-5.4-11-10.2C-.5 6.6 1.8 3 5.5 3 8 3 9.7 4.4 12 7c2.3-2.6 4-4 6.5-4C22.2 3 24.5 6.6 23 10.8 20.5 15.6 12 21 12 21z"/></svg></div>' +
                    '<div class="lrv-item__eq"><i></i><i></i><i></i><i></i></div>' +
                    '<div class="lrv-item__pause"><svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg></div>' +
                    '<div class="lrv-item__spin"></div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_style',
            '<style>' +
            '.lrv-content{padding:0 1.5em}' +
            '.lrv-content__head{display:flex;padding:1.2em 0;flex-wrap:wrap;align-items:center}' +
            '.lrv-tab{margin-right:.7em;margin-bottom:.5em;display:inline-flex;align-items:center}' +
            '.lrv-tab.active{background:rgba(255,255,255,.2)}' +
            '.lrv-tab__badge{margin-left:.5em;font-size:.78em;opacity:.6;background:rgba(255,255,255,.14);border-radius:1em;padding:.05em .55em;min-width:1.4em;text-align:center}' +
            '.lrv-tab.focus .lrv-tab__badge{background:rgba(0,0,0,.12);opacity:.7}' +
            '.lrv-content__body{display:flex;justify-content:center}' +
            '.lrv-content__list{width:100%;max-width:46em;padding-bottom:5em}' +
            '.lrv-empty{padding:2em 1em;opacity:.55;font-size:1.15em;line-height:1.5}' +
            // строка
            '.lrv-item{padding:.7em 1em;display:flex;align-items:center;line-height:1.35;border-radius:.8em;transition:background .15s}' +
            '.lrv-item__cover{width:3.2em;flex-shrink:0;margin-right:1.1em}' +
            '.lrv-item__cover-box{position:relative;padding-bottom:100%;background:rgba(255,255,255,.07);border-radius:.5em;overflow:hidden}' +
            '.lrv-item__cover-box img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:.5em;opacity:0;transition:opacity .25s}' +
            '.lrv-item__ph{position:absolute;left:28%;top:28%;width:44%;height:44%;opacity:.35;display:flex}.lrv-item__ph svg{width:100%;height:100%}' +
            '.lrv-item__cover-box.loaded img{opacity:1}.lrv-item__cover-box.loaded .lrv-item__ph{display:none}' +
            '.lrv-item__cover-box.loaded-icon .lrv-item__ph{display:none}' +
            '.lrv-item__cover-box[data-letter]:after{content:attr(data-letter);position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.4em;color:#fff;background:var(--lrv-avatar,#444);border-radius:.5em}' +
            '.lrv-item__body{flex:1;min-width:0}' +
            '.lrv-item__title{font-weight:600;font-size:1.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-item__tooltip{opacity:.45;margin-top:.25em;font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-item__state{margin-left:.8em;flex-shrink:0;width:1.6em;display:flex;align-items:center;justify-content:center}' +
            // сердечко на КАЖДОЙ строке: только контур (серая обводка, без заливки)
            '.lrv-item__fav{display:flex;transition:transform .2s cubic-bezier(.34,1.56,.64,1)}' +
            '.lrv-item__fav svg{width:1.3em;height:1.3em;overflow:visible}' +
            '.lrv-item__fav .lrv-heart{fill:transparent;stroke:rgba(255,255,255,.45);stroke-width:1.8px;transition:fill .2s ease,stroke .2s ease}' +
            // строка в фокусе (белый фон): контур темнее, чтобы был виден
            '.lrv-item.focus .lrv-item__fav .lrv-heart{stroke:rgba(0,0,0,.4)}' +
            // избранное: красная заливка, светлая обводка, мягкое свечение и «пульс» при добавлении
            '.lrv-item.favorite .lrv-item__fav .lrv-heart{fill:#ff4d6d;stroke:rgba(255,255,255,.85)}' +
            '.lrv-item.favorite.focus .lrv-item__fav .lrv-heart{stroke:rgba(0,0,0,.55)}' +
            '.lrv-item.favorite .lrv-item__fav svg{filter:drop-shadow(0 0 .3em rgba(255,77,109,.5))}' +
            '.lrv-item.favorite .lrv-item__fav{animation:lrvHeartPop .4s cubic-bezier(.34,1.56,.64,1)}' +
            '@keyframes lrvHeartPop{0%{transform:scale(.5)}55%{transform:scale(1.25)}100%{transform:scale(1)}}' +
            '.lrv-item__eq{display:none;align-items:flex-end;height:1.2em}' +
            '.lrv-item__eq i+i{margin-left:.12em}' +
            // полоски анимируют только transform (без перерасчёта раскладки на ТВ)
            '.lrv-item__eq i{display:block;width:.2em;height:1.2em;background:#4caf50;border-radius:2px;-webkit-transform-origin:bottom;transform-origin:bottom;-webkit-transform:scaleY(.25);transform:scaleY(.25);-webkit-animation:lrvRowEq .9s ease-in-out infinite;animation:lrvRowEq .9s ease-in-out infinite}' +
            '.lrv-item__eq i:nth-child(2){-webkit-animation-delay:.18s;animation-delay:.18s}' +
            '.lrv-item__eq i:nth-child(3){-webkit-animation-delay:.42s;animation-delay:.42s}' +
            '.lrv-item__eq i:nth-child(4){-webkit-animation-delay:.28s;animation-delay:.28s}' +
            '@-webkit-keyframes lrvRowEq{0%,100%{-webkit-transform:scaleY(.21)}30%{-webkit-transform:scaleY(1)}55%{-webkit-transform:scaleY(.46)}80%{-webkit-transform:scaleY(.83)}}' +
            '@keyframes lrvRowEq{0%,100%{transform:scaleY(.21)}30%{transform:scaleY(1)}55%{transform:scaleY(.46)}80%{transform:scaleY(.83)}}' +
            '.lrv-item__pause{opacity:0;display:none}.lrv-item__pause svg{width:1.3em;height:1.3em;color:#4caf50}' +
            '.lrv-item__spin{display:none;width:1.1em;height:1.1em;border:.15em solid rgba(255,255,255,.2);border-top-color:#4caf50;border-radius:50%;animation:lrvSpin .8s linear infinite}' +
            // играет: эквалайзер, сердечко скрыто; грузится: спиннер; пауза: значок паузы
            '.lrv-item.playing .lrv-item__fav{display:none}' +
            '.lrv-item.playing .lrv-item__eq{display:flex}' +
            '.lrv-item.playing.loading .lrv-item__eq{display:none}' +
            '.lrv-item.playing.loading .lrv-item__spin{display:block}' +
            '.lrv-item.playing.paused .lrv-item__eq{display:none}' +
            '.lrv-item.playing.paused .lrv-item__pause{display:flex;opacity:.9}' +
            // подсветка играющей строки: лёгкий тон + зелёная полоса слева
            '.lrv-item.playing{background:rgba(76,175,80,.1);position:relative}' +
            '.lrv-item.playing:before{content:"";position:absolute;left:0;top:.5em;bottom:.5em;width:.22em;border-radius:0 3px 3px 0;background:#4caf50}' +
            '.lrv-item.playing .lrv-item__title{color:#fff;font-weight:700}' +
            '.lrv-item.focus .lrv-item__title{color:inherit}' +
            '.lrv-item.focus{background:#fff;color:#000}' +
            '.lrv-item.focus .lrv-item__cover-box{background:rgba(0,0,0,.08)}' +
            '.lrv-item.focus.playing{background:#fff}' +
            '.lrv-item.focus.playing .lrv-item__title{color:#000}' +
            '.lrv-item.focus.playing:before{background:#2e7d32}' +
            '.lrv-item.focus.playing .lrv-item__eq i{background:#2e7d32}' +
            // скелетоны
            '.lrv-skeleton{pointer-events:none}' +
            '.lrv-sk{background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.12) 37%,rgba(255,255,255,.05) 63%);background-size:400% 100%;animation:lrvShimmer 1.4s ease infinite;border-radius:.4em}' +
            '.lrv-item__cover-box.lrv-sk{padding-bottom:0;height:100%}.lrv-skeleton .lrv-item__cover{height:3.2em}' +
            '.lrv-sk--line{height:.95em;margin:.2em 0}.lrv-sk--sub{height:.7em;opacity:.7}' +
            '@keyframes lrvShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}' +
            '@keyframes lrvSpin{to{transform:rotate(360deg)}}' +
            // заставка — непрозрачный фон в цвет темы
            '.lrv-saver{position:fixed;top:0;right:0;bottom:0;left:0;z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--main-color-bg,#15151a);opacity:0;visibility:hidden;transition:opacity 1s ease,visibility 1s;pointer-events:none}' +
            '.lrv-saver__stage,.lrv-saver__title,.lrv-saver__sub,.lrv-saver__hint{position:relative;z-index:2}' +
            '.lrv-saver.show{opacity:1;visibility:visible}' +
            '.lrv-saver__stage{display:flex;align-items:center;justify-content:center;width:100%;max-width:100%}' +
            // обложка по центру, вокруг — белое свечение от баса
            '.lrv-saver__center{display:flex;flex-direction:column;align-items:center;flex-shrink:0;z-index:2;margin:0 1em}' +
            // запас по размеру, чтобы пульсация не обрезалась
            '.lrv-saver__well{position:relative;width:22em;height:22em;display:flex;align-items:center;justify-content:center}' +
            // мягкий ореол по форме обложки (скруглённый квадрат), яркость — от ударов
            '.lrv-saver__glow{position:absolute;left:50%;top:50%;width:13em;height:13em;margin:-6.5em 0 0 -6.5em;border-radius:1.4em;box-shadow:0 0 4.5em 1.2em rgba(255,255,255,.3);opacity:.12;will-change:transform,opacity;pointer-events:none}' +
            // ореол удара: заранее отрисованный белый ореол вплотную к обложке;
            // каждый кадр меняются только opacity/scale (без перерисовки box-shadow)
            '.lrv-saver__thump{position:absolute;left:50%;top:50%;width:13em;height:13em;margin:-6.5em 0 0 -6.5em;border-radius:1.4em;box-shadow:0 0 1.8em .5em rgba(255,255,255,.55);opacity:0;will-change:transform,opacity;pointer-events:none;z-index:0}' +
            '.lrv-saver__art{position:relative;width:13em;height:13em;border-radius:1.4em;overflow:hidden;background:#24242c;background:linear-gradient(145deg,#2e2e38 0%,#1c1c23 100%);box-shadow:0 1.2em 3em rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.14);will-change:transform;z-index:1}' +
            // пока открыта заставка, список под ней скрыт, а его анимации на паузе
            // (он всё равно под непрозрачным слоем)
            '.lrv-saving .lrv-content{visibility:hidden;-webkit-transition:visibility 0s 1s;transition:visibility 0s 1s}' +
            '.lrv-saving .lrv-item__eq i,.lrv-saving .lrv-item__spin,.lrv-saving .lrv-sk{-webkit-animation-play-state:paused;animation-play-state:paused}' +
            '.lrv-saver__img{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .6s}' +
            '.lrv-saver__art.loaded .lrv-saver__img{opacity:1}' +
            '.lrv-saver__ph{position:absolute;left:32%;top:32%;width:36%;height:36%;opacity:.25;display:flex}.lrv-saver__ph svg{width:100%;height:100%}' +
            '.lrv-saver__art.loaded .lrv-saver__ph{display:none}' +
            '.lrv-saver__art[data-letter]:after{content:attr(data-letter);position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:6em;color:#fff;background:var(--lrv-avatar,#333)}' +
            // соседи слева/справа: по 3, размер и прозрачность по убыванию,
            // дальний (n3) частично обрезан — эффект «выглядывания»
            '.lrv-saver__side{display:flex;align-items:center;width:18em;overflow:hidden}' +
            '.lrv-saver__side--prev{justify-content:flex-end;flex-direction:row}' +
            '.lrv-saver__side--next{justify-content:flex-start;flex-direction:row}' +
            '.lrv-saver__neighbor{display:flex;flex-direction:column;align-items:center;flex-shrink:0;transition:opacity .3s}' +
            '.lrv-saver__n1{margin:0 .7em}.lrv-saver__n2{margin:0 .4em}.lrv-saver__n3{margin:0 .2em}' +
            '.lrv-saver__n1 .lrv-saver__nart{width:6.5em;height:6.5em}.lrv-saver__n1{opacity:.55}' +
            '.lrv-saver__n2 .lrv-saver__nart{width:5em;height:5em}.lrv-saver__n2{opacity:.32}' +
            '.lrv-saver__n3 .lrv-saver__nart{width:4em;height:4em}.lrv-saver__n3{opacity:.16}' +
            '.lrv-saver__nart{position:relative;border-radius:.9em;overflow:hidden;background:rgba(255,255,255,.05)}' +
            '.lrv-saver__nart img{position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .4s}' +
            '.lrv-saver__nart.loaded img{opacity:1}' +
            '.lrv-saver__nph{position:absolute;left:32%;top:32%;width:36%;height:36%;opacity:.3;display:flex}.lrv-saver__nph svg{width:100%;height:100%}' +
            '.lrv-saver__nart.loaded .lrv-saver__nph{display:none}' +
            '.lrv-saver__nart[data-letter]:after{content:attr(data-letter);position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.8em;color:#fff;background:var(--lrv-avatar,#333)}' +
            '.lrv-saver__nname{margin-top:.35em;font-size:.85em;opacity:.8;text-align:center;max-width:8em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-saver__arrow{font-size:2.2em;line-height:1;margin:0 .3em;flex-shrink:0;color:#fff;opacity:.55}' +
            // плавное затухание края, чтобы n3 растворялся в фоне
            '.lrv-saver__side--prev{-webkit-mask:linear-gradient(90deg,transparent 0,rgba(0,0,0,.4) 20%,#000 60%);mask:linear-gradient(90deg,transparent 0,rgba(0,0,0,.4) 20%,#000 60%)}' +
            '.lrv-saver__side--next{-webkit-mask:linear-gradient(270deg,transparent 0,rgba(0,0,0,.4) 20%,#000 60%);mask:linear-gradient(270deg,transparent 0,rgba(0,0,0,.4) 20%,#000 60%)}' +
            // анимация сдвига при переключении
            '.lrv-saver--slidenext .lrv-saver__center{animation:lrvSlideN .18s ease}' +
            '.lrv-saver--slideprev .lrv-saver__center{animation:lrvSlideP .18s ease}' +
            '@keyframes lrvSlideN{0%{transform:translateX(0);opacity:1}50%{transform:translateX(-1.5em);opacity:.4}100%{transform:translateX(0);opacity:1}}' +
            '@keyframes lrvSlideP{0%{transform:translateX(0);opacity:1}50%{transform:translateX(1.5em);opacity:.4}100%{transform:translateX(0);opacity:1}}' +
            '.lrv-saver__title{margin-top:.2em;font-size:2.2em;font-weight:700;text-align:center;padding:0 1em;color:#fff}' +
            '.lrv-saver__sub{margin-top:.4em;font-size:1.2em;opacity:.5;text-align:center;padding:0 1.5em}' +
            '.lrv-saver__hint{margin-top:1.6em;font-size:1em;opacity:.3;letter-spacing:.05em;text-align:center}' +
            '</style>'
        );

        Lampa.Component.add('lrv', Component);

        function add() {
            var btn = $(
                '<li class="menu__item selector">' +
                    '<div class="menu__ico"><svg width="38" height="31" viewBox="0 0 38 31" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<rect x="17.613" width="3" height="16.3327" rx="1.5" transform="rotate(63.4707 17.613 0)" fill="currentColor"/>' +
                    '<circle cx="13" cy="19" r="6" fill="currentColor"/>' +
                    '<path fill-rule="evenodd" clip-rule="evenodd" d="M0 11C0 8.79086 1.79083 7 4 7H34C36.2091 7 38 8.79086 38 11V27C38 29.2091 36.2092 31 34 31H4C1.79083 31 0 29.2091 0 27V11ZM21 19C21 23.4183 17.4183 27 13 27C8.58173 27 5 23.4183 5 19C5 14.5817 8.58173 11 13 11C17.4183 11 21 14.5817 21 19ZM30.5 18C31.8807 18 33 16.8807 33 15.5C33 14.1193 31.8807 13 30.5 13C29.1193 13 28 14.1193 28 15.5C28 16.8807 29.1193 18 30.5 18Z" fill="currentColor"/></svg></div>' +
                    '<div class="menu__text">' + manifest.name + '</div>' +
                '</li>'
            );
            btn.on('hover:enter', function(){ Lampa.Activity.push({ url: '', title: manifest.name, component: 'lrv', page: 1 }); });
            $('.menu .menu__list').eq(0).append(btn);
            $('body').append(Lampa.Template.get('lrv_style', {}, true));
        }

        if (window.appready) add();
        else Lampa.Listener.follow('app', function(e){ if (e.type === 'ready') add(); });
    }

    if (!window[PLUGIN_ID]) startPlugin();

})();
