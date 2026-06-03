(function () {
    'use strict';

    var PLUGIN_ID = 'lampa_radio_lv';

    var RECORD_API = 'https://lampaplugins.github.io/store/stations.json';
    var API_LV     = 'https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/LV?hidebroken=true&order=votes&limit=80';

    // Fallback Record stations (used only if the mirror is unreachable)
    var RECORD_FALLBACK = [
        { title: 'Radio Record', tooltip: 'Главная станция', stream: 'https://radiorecord.hostingradio.ru/rr96.aacp', icon: '', group: 'record' },
        { title: 'Record Deep',  tooltip: 'Deep House',      stream: 'https://radiorecord.hostingradio.ru/deep96.aacp', icon: '', group: 'record' },
        { title: 'Record Trap',  tooltip: 'Trap',            stream: 'https://radiorecord.hostingradio.ru/trap96.aacp', icon: '', group: 'record' },
        { title: 'Record Russian Mix', tooltip: 'Русские хиты', stream: 'https://radiorecord.hostingradio.ru/rus96.aacp', icon: '', group: 'record' },
        { title: 'Record Techno', tooltip: 'Techno',          stream: 'https://radiorecord.hostingradio.ru/techno96.aacp', icon: '', group: 'record' }
    ];

    var FAV_KEY    = 'lrv_favorites';
    var RECENT_KEY = 'lrv_recent';
    var LAST_KEY   = 'lrv_last';
    var RECENT_MAX = 12;

    var Store = {
        list: function(key) { return Lampa.Storage.get(key, '[]'); },
        save: function(key, v) { Lampa.Storage.set(key, v); }
    };

    function stripState(st) {
        return { title: st.title, tooltip: st.tooltip, stream: st.stream, icon: st.icon, group: st.group, uid: st.uid, record_id: st.record_id };
    }
    function stationUid(st) {
        // Title+group is stable across stream-URL changes (mirror vs fallback,
        // http vs https, bitrate variants), so favorites/recents stay matched.
        var key = (st.title || '').toLowerCase().replace(/\s+/g, ' ').trim() + '|' + (st.group || '');
        return Lampa.Utils.hash(key || st.stream || '');
    }
    function cleanTitle(name) { return (name || '').replace(/\s+/g, ' ').trim(); }

    // ── Smart artwork loading ────────────────────────
    // Force https (avoids mixed-content blocking on TV),
    // cascade favicon -> domain favicon -> letter avatar.
    function httpsify(url) {
        if (!url) return '';
        if (url.indexOf('//') === 0) return 'https:' + url;
        return url.replace(/^http:\/\//i, 'https://');
    }
    function domainOf(url) {
        try { return (url || '').split('/')[2] || ''; } catch(e){ return ''; }
    }

    // ── Known Latvian broadcaster domains (for crisp official logos) ──
    // Matched by keyword against the station title. Order matters: more
    // specific keys first so "swh rock" wins over plain "swh".
    var LV_LOGO_MAP = [
        { kw: ['swh rock','swh roks'],                 domain: 'radioswhrock.lv' },
        { kw: ['swh plus','swh+'],                     domain: 'radioswhplus.lv' },
        { kw: ['swh lv'],                              domain: 'radioswh.lv' },
        { kw: ['swh'],                                 domain: 'radioswh.lv' },
        { kw: ['skonto plus'],                         domain: 'radioskonto.lv' },
        { kw: ['skonto'],                              domain: 'radioskonto.lv' },
        { kw: ['star fm','starfm'],                    domain: 'starfm.lv' },
        { kw: ['ehr superhits','superhits'],           domain: 'ehr.lv' },
        { kw: ['ehr russkie','russkie hiti','krievijas'], domain: 'ehr.lv' },
        { kw: ['latviešu hiti','latviesu hiti'],       domain: 'ehr.lv' },
        { kw: ['ehr','european hit'],                  domain: 'ehr.lv' },
        { kw: ['retro fm'],                            domain: 'retrofm.lv' },
        { kw: ['pieci','radio 5','pieci.lv'],          domain: 'pieci.lv' },
        { kw: ['naba'],                                domain: 'naba.lv' },
        { kw: ['latvijas radio 1','lr1','lr 1'],       domain: 'latvijasradio.lsm.lv' },
        { kw: ['latvijas radio 2','lr2','lr 2'],       domain: 'latvijasradio.lsm.lv' },
        { kw: ['latvijas radio 3','lr3','klasika'],    domain: 'latvijasradio.lsm.lv' },
        { kw: ['latvijas radio 4','lr4','doma'],       domain: 'latvijasradio.lsm.lv' },
        { kw: ['latvijas radio','latvijas radio 5'],   domain: 'latvijasradio.lsm.lv' },
        { kw: ['top radio'],                           domain: 'topradio.lv' },
        { kw: ['capital fm'],                          domain: 'capitalfm.lv' },
        { kw: ['mix fm','mixfm'],                      domain: 'mixfm.lv' },
        { kw: ['xo fm','xofm'],                         domain: 'xofm.lv' },
        { kw: ['kurzemes'],                            domain: 'kurzemesradio.lv' },
        { kw: ['radio tev','radio tēv'],               domain: 'radiotev.lv' },
        { kw: ['power hit','power fm','power'],         domain: 'powerhitradio.lv' },
        { kw: ['spin fm','spin'],                       domain: 'spinfm.lv' },
        { kw: ['divi','radio 2 lv'],                    domain: 'divi.lv' }
    ];

    function lvLogoDomain(title) {
        var t = (title || '').toLowerCase();
        for (var i = 0; i < LV_LOGO_MAP.length; i++) {
            var entry = LV_LOGO_MAP[i];
            for (var k = 0; k < entry.kw.length; k++) {
                if (t.indexOf(entry.kw[k]) >= 0) return entry.domain;
            }
        }
        return '';
    }

    // Build crisp-logo URLs for a broadcaster domain (apple-touch-icon is
    // usually 180px+, DuckDuckGo ip3 returns clean square logos).
    function logoSourcesForDomain(domain) {
        if (!domain) return [];
        return [
            'https://icons.duckduckgo.com/ip3/' + domain + '.ico',
            'https://' + domain + '/apple-touch-icon.png',
            'https://' + domain + '/apple-touch-icon-precomposed.png',
            'https://www.google.com/s2/favicons?sz=128&domain=' + domain
        ];
    }

    // ── eradio.lv mini-logos: https://eradio.lv/mini/<code>.webp ──
    // eradio.lv hosts a clean square mini-logo for essentially EVERY
    // Latvian station under a short code (their URL slug). This is the
    // best LV source. Matched by keyword; specific keys first.
    var ERADIO_MAP = [
        { kw: ['swh rock','swh roks'],                code: 'swhrock' },
        { kw: ['swh plus','swh+'],                    code: 'swhplus' },
        { kw: ['swh lv'],                             code: 'swhlv' },
        { kw: ['swh'],                                code: 'swh' },
        { kw: ['skonto plus'],                        code: 'skontoplus' },
        { kw: ['skonto'],                             code: 'skonto' },
        { kw: ['star fm','starfm'],                   code: 'starfm' },
        { kw: ['ehr superhits','superhits'],          code: 'superhits' },
        { kw: ['ehr top 40 ru'],                      code: 'ehrtop40ru' },
        { kw: ['ehr russkie','russkie hiti'],         code: 'ehrru' },
        { kw: ['latviešu hiti','latviesu hiti'],      code: 'latviesuhiti' },
        { kw: ['ehr','european hit'],                 code: 'ehr' },
        { kw: ['retro fm'],                           code: 'retrofm' },
        { kw: ['pieci','pieci.lv'],                   code: 'pieci' },
        { kw: ['naba'],                               code: 'naba' },
        { kw: ['latvijas radio 1','lr1','lr 1'],      code: 'lr1' },
        { kw: ['latvijas radio 2','lr2','lr 2'],      code: 'lr2' },
        { kw: ['latvijas radio 3','lr3','klasika'],   code: 'lr3' },
        { kw: ['latvijas radio 4','lr4','doma'],      code: 'lr4' },
        { kw: ['latvijas radio 6','lr6'],             code: 'lr6' },
        { kw: ['latvijas radio 5','lr5'],             code: 'lr5' },
        { kw: ['latvijas radio'],                     code: 'lr1' },
        { kw: ['top radio'],                          code: 'topradio' },
        { kw: ['capital fm'],                         code: 'capitalfm' },
        { kw: ['mix fm','mixfm'],                     code: 'mixfm' },
        { kw: ['xo fm','xofm'],                        code: 'xofm' },
        { kw: ['kurzemes'],                           code: 'kurzemesradio' },
        { kw: ['radio tev','radio tēv'],              code: 'radiotev' },
        { kw: ['power hit','power fm','power'],        code: 'powerhitradio' },
        { kw: ['spin fm','spin'],                      code: 'spinfm' },
        { kw: ['relax fm','relax'],                    code: 'relaxfm' },
        { kw: ['lounge fm','lounge'],                  code: 'loungefm' },
        { kw: ['schlager'],                            code: 'schlagertime' },
        { kw: ['russkoe radio','русское'],             code: 'russkoeradio' },
        { kw: ['radio pik','pik'],                     code: 'radiopik' },
        { kw: ['radio alise','alise'],                 code: 'alise' },
        { kw: ['radio 7'],                             code: 'radio7' },
        { kw: ['radio 1'],                             code: 'radio1' },
        { kw: ['l radio'],                             code: 'lradio' },
        { kw: ['latgolys','latgales'],                 code: 'latgolysradeja' },
        { kw: ['kristīgais','kristigais','christian'], code: 'lkr' },
        { kw: ['tlig'],                                code: 'tlig' },
        { kw: ['talsi'],                               code: 'talsi' },
        { kw: ['radio atklājumi','atklajumi'],         code: 'atklajumi' },
        { kw: ['divi','radio divi'],                   code: 'divi' }
    ];

    function eradioCode(title) {
        var t = (title || '').toLowerCase();
        for (var i = 0; i < ERADIO_MAP.length; i++) {
            var e = ERADIO_MAP[i];
            for (var k = 0; k < e.kw.length; k++) {
                if (t.indexOf(e.kw[k]) >= 0) return e.code;
            }
        }
        return '';
    }

    // ── eradio.lv display order ("Visas stacijas") ──
    // Stations are sorted to match eradio.lv top-to-bottom. Matched by
    // keyword against the title; anything not listed sinks to the bottom
    // (keeping its radio-browser order). Lowercase substrings.
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
        // swh last among swh-family base name so "swh plus/rock/lv/gold/spin" match first
        'swh'
    ];

    function eradioRank(title) {
        var t = (title || '').toLowerCase();
        // find the most specific (longest) matching keyword to avoid
        // "swh" matching before "swh plus"
        var best = -1, bestLen = -1;
        for (var i = 0; i < ERADIO_ORDER.length; i++) {
            var kw = ERADIO_ORDER[i];
            if (t.indexOf(kw) >= 0 && kw.length > bestLen) { best = i; bestLen = kw.length; }
        }
        return best;
    }

    // Sort LV stations into eradio.lv order; unlisted ones keep their
    // original relative order at the bottom.
    function sortLatvian(list) {
        return list.map(function(s, i){ return { s: s, i: i, r: eradioRank(s.title) }; })
                   .sort(function(a, b) {
                       var ra = a.r < 0 ? 9999 : a.r;
                       var rb = b.r < 0 ? 9999 : b.r;
                       if (ra !== rb) return ra - rb;
                       return a.i - b.i; // stable for unlisted
                   })
                   .map(function(o){ return o.s; });
    }

    // Best LV artwork sources in priority order: eradio mini-logo first,
    // then official broadcaster domain logo, then the rest of the cascade.
    function lvLogoSources(title) {
        var out = [];
        var code = eradioCode(title);
        if (code) out.push('https://eradio.lv/mini/' + code + '.webp');
        var dom = lvLogoDomain(title);
        if (dom) out = out.concat(logoSourcesForDomain(dom));
        return out;
    }

    var AVATAR_COLORS = ['#5b6ee1','#27ae60','#e67e22','#c0392b','#8e44ad','#16a085','#2c3e50','#d35400','#2980b9','#c2185b'];
    function avatarFor(title) {
        var t = (title || '?').trim();
        var ch = t.charAt(0).toUpperCase() || '?';
        var idx = Math.abs(Lampa.Utils.hash(t)) % AVATAR_COLORS.length;
        return { letter: ch, color: AVATAR_COLORS[idx] };
    }
    // Wire an <img> with cascading sources; on final failure show avatar.
    function loadArtwork(imgEl, boxEl, station) {
        var $box = $(boxEl);
        $box.removeClass('loaded loaded-icon').removeAttr('data-letter').css('background-color', '');
        var sources = [];

        // 1) Known Latvian broadcaster -> eradio mini-logo, then domain logo
        if (station.group === 'latvian') {
            sources = sources.concat(lvLogoSources(station.title));
        }

        // 2) Station's own favicon from the API (https-forced)
        var primary = httpsify(station.icon);
        if (primary && sources.indexOf(primary) < 0) sources.push(primary);

        // 3) Favicon of the stream's own domain
        var dom = domainOf(station.stream) || domainOf(station.icon);
        if (dom) {
            var g = 'https://www.google.com/s2/favicons?sz=128&domain=' + dom;
            if (sources.indexOf(g) < 0) sources.push(g);
        }

        var i = 0;
        function tryNext() {
            if (i >= sources.length) { showAvatar(); return; }
            var src = sources[i++];
            imgEl.onload = function() {
                // Favicon services return a tiny generic globe (16px) for unknown
                // domains — treat anything <=16px from a favicon service as a miss.
                var isFaviconSvc = src.indexOf('s2/favicons') >= 0 || src.indexOf('duckduckgo.com/ip3') >= 0;
                if (isFaviconSvc && imgEl.naturalWidth && imgEl.naturalWidth <= 16) { tryNext(); return; }
                $box.addClass('loaded');
            };
            imgEl.onerror = function(){ tryNext(); };
            imgEl.src = src;
        }
        function showAvatar() {
            var a = avatarFor(station.title);
            imgEl.removeAttribute('src');
            $box.addClass('loaded-icon').attr('data-letter', a.letter)
                .css('--lrv-avatar', a.color)
                .css('background-color', a.color);   // fallback for engines without CSS vars
        }
        if (sources.length) tryNext();
        else showAvatar();
    }

    var Favorites = {
        get: function() { return Store.list(FAV_KEY); },
        find: function(st) { return this.get().find(function(a){ return a.uid === st.uid; }); },
        add: function(st) { var l = this.get(); if (!this.find(st)) { l.push(stripState(st)); Store.save(FAV_KEY, l); } },
        remove: function(st) { Store.save(FAV_KEY, this.get().filter(function(a){ return a.uid !== st.uid; })); },
        toggle: function(st) { if (this.find(st)) this.remove(st); else this.add(st); return Boolean(this.find(st)); },
        move: function(st, dir) {
            var l = this.get();
            var i = l.findIndex(function(a){ return a.uid === st.uid; });
            var j = i + dir;
            if (i < 0 || j < 0 || j >= l.length) return false;
            var t = l[i]; l[i] = l[j]; l[j] = t;
            Store.save(FAV_KEY, l);
            return true;
        }
    };

    var Recent = {
        get: function() { return Store.list(RECENT_KEY); },
        push: function(st) {
            var l = this.get().filter(function(a){ return a.uid !== st.uid; });
            l.unshift(stripState(st));
            if (l.length > RECENT_MAX) l = l.slice(0, RECENT_MAX);
            Store.save(RECENT_KEY, l);
        }
    };

    // One-time migration: recompute uids for stored items so they match the
    // current stationUid scheme (title-based). Safe to run every launch.
    function migrateStored() {
        [FAV_KEY, RECENT_KEY].forEach(function(key) {
            var changed = false;
            var list = Store.list(key).map(function(s) {
                var u = stationUid(s);
                if (s.uid !== u) { s.uid = u; changed = true; }
                return s;
            });
            if (changed) Store.save(key, list);
        });
    }

    // ════════════════════════════════════════════════
    //  AUDIO ENGINE — single global instance.
    //  Holds the ACTUALLY playing station. UI surfaces
    //  subscribe to it; they never own playback state.
    //  Hardened: auto-reconnect, stall watchdog, load
    //  timeout, volume memory + fade-in, screen wake lock.
    // ════════════════════════════════════════════════
    function AudioEngine() {
        var audio   = new Audio();
        var hls;
        var current = null;          // currently loaded station
        var state   = 'idle';        // idle | loading | playing | paused | error
        var listeners = [];
        var volume    = clampVol(Lampa.Storage.get('lrv_volume', 1));
        var fadeTimer, loadTimer, stallTimer, retryTimer;
        var retries   = 0;
        var MAX_RETRY = 4;
        var lastTime  = 0;
        var wakeLock  = null;
        var manualPause = false;     // distinguishes user pause from network drop

        audio.preload = 'none';
        audio.volume  = volume;
        audio.crossOrigin = 'anonymous';

        function clampVol(v){ v = parseFloat(v); if (isNaN(v)) v = 1; return Math.max(0, Math.min(1, v)); }

        audio.addEventListener('playing', function(){
            retries = 0;
            clearTimeout(loadTimer);
            startStallWatch();
            fadeIn();
            setState('playing');
            acquireWake();
        });
        audio.addEventListener('waiting', function(){ if (state !== 'idle') setState('loading'); });
        audio.addEventListener('pause',   function(){
            if (state === 'idle') return;
            if (manualPause) { setState('paused'); releaseWake(); }
            // non-manual pause (e.g. network) -> let stall/error handlers react
        });
        audio.addEventListener('ended',   function(){ if (!manualPause) reconnect('stream ended'); });
        audio.addEventListener('error',   function(){ if (state !== 'idle' && !manualPause) reconnect('audio error'); });

        function setState(s) { state = s; emit(); }
        function emit() { listeners.forEach(function(fn){ try { fn(current, state); } catch(e){} }); }

        // ── Stall watchdog: if currentTime stops advancing, reconnect ──
        function startStallWatch() {
            clearInterval(stallTimer);
            lastTime = audio.currentTime;
            stallTimer = setInterval(function() {
                if (state !== 'playing') return;
                if (audio.currentTime === lastTime && !audio.paused) {
                    reconnect('stall detected');
                } else {
                    lastTime = audio.currentTime;
                }
            }, 8000);
        }

        // ── Auto-reconnect with linear backoff ──
        function reconnect(reason) {
            if (manualPause || !current) return;
            clearTimers();
            if (retries >= MAX_RETRY) {
                setState('error');
                Lampa.Noty.show('Поток недоступен. Проверьте соединение.');
                releaseWake();
                return;
            }
            retries++;
            setState('loading');
            console.log('Radio reconnect (' + retries + '): ' + reason);
            retryTimer = setTimeout(function(){ open(current, true); }, 1200 * retries);
        }

        // ── Fade-in for smooth start ──
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

        function clearTimers(){ clearTimeout(loadTimer); clearTimeout(retryTimer); clearInterval(stallTimer); }

        function teardownStream() { if (hls) { try{ hls.destroy(); }catch(e){} hls = null; } }

        function open(station, isRetry) {
            teardownStream();
            clearTimeout(loadTimer);
            var url = station.stream || '';

            // load timeout -> reconnect/error if nothing plays in time
            loadTimer = setTimeout(function(){
                if (state === 'loading') reconnect('load timeout');
            }, 12000);

            var useHls = (typeof Hls !== 'undefined' && Hls.isSupported() && url.indexOf('.m3u8') >= 0
                          && !audio.canPlayType('application/vnd.apple.mpegurl'));
            if (useHls) {
                try {
                    hls = new Hls({ liveSyncDuration: 3, enableWorker: true });
                    hls.attachMedia(audio);
                    hls.loadSource(url);
                    hls.on(Hls.Events.MANIFEST_PARSED, play);
                    hls.on(Hls.Events.ERROR, function(e, d){ if (d && d.fatal) reconnect('hls fatal'); });
                } catch(e) { audio.src = url; audio.load(); play(); }
            } else {
                audio.src = url; audio.load(); play();
            }
        }

        function play() {
            manualPause = false;
            var p;
            try { p = audio.play(); } catch(e) {}
            if (p) p.catch(function(e){
                // autoplay blocked or transient — surface but don't crash
                console.log('Radio play error:', e.message);
            });
        }

        // ── Wake Lock (keep screen on while listening) ──
        function acquireWake() {
            try {
                if ('wakeLock' in navigator && !wakeLock) {
                    navigator.wakeLock.request('screen').then(function(w){ wakeLock = w; }).catch(function(){});
                }
            } catch(e) {}
        }
        function releaseWake() {
            try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch(e) {}
        }

        this.current   = function(){ return current; };
        this.state     = function(){ return state; };
        this.isCurrent = function(st){ return current && st && current.uid === st.uid; };
        this.volume    = function(){ return volume; };
        this.setVolume = function(v) {
            volume = clampVol(v);
            audio.volume = volume;
            Lampa.Storage.set('lrv_volume', volume);
            emit();
        };

        this.subscribe = function(fn){ listeners.push(fn); return function(){ listeners = listeners.filter(function(f){ return f !== fn; }); }; };

        this.play = function(station) {
            if (this.isCurrent(station) && state === 'paused') { this.resume(); return; }
            if (this.isCurrent(station) && state === 'playing') return;
            current = station;
            retries = 0;
            manualPause = false;
            setState('loading');
            open(station, false);
        };
        this.toggle = function() {
            if (state === 'playing') this.pause();
            else if (state === 'paused' || state === 'error') this.resume();
        };
        this.pause  = function(){ manualPause = true; clearTimers(); audio.pause(); };
        this.resume = function(){
            manualPause = false;
            if (state === 'error') { retries = 0; open(current, false); }
            else play();
        };
        this.stop = function() {
            manualPause = true;
            clearTimers(); teardownStream(); releaseWake();
            audio.pause(); audio.src = '';
            current = null; retries = 0;
            setState('idle');
        };
    }

    var Engine = null; // created on first component mount

    // ════════════════════════════════════════════════
    //  COMPONENT
    // ════════════════════════════════════════════════
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
        var query   = '';
        var focused = null;     // station currently under focus (preview only)
        var unsub   = null;     // engine subscription

        if (!Engine) Engine = new AudioEngine();

        // ── Load ─────────────────────────────────
        this.create = function() {
            html.append(Lampa.Template.get('lrv_content', {}));
            scroll = new Lampa.Scroll({ mask: true, over: true });
            scroll.onEnd = function() { _this.next(); };
            html.find('.lrv-content__list').append(scroll.render(true));
            scroll.minus(html.find('.lrv-content__head'));

            this.renderSkeletons();

            var pending = 2;
            var done = function() { if (--pending <= 0) _this.onData(); };

            network['native'](RECORD_API, function(data) {
                if (data && data.result && data.result.stations) {
                    var stations = data.result.stations.slice().sort(function(a, b){ return (a.sort||0) - (b.sort||0); });
                    record = stations.map(function(s) {
                        var stream = s.stream_320 || s.stream_128 || (s.stream_hls ? s.stream_hls.replace('playlist.m3u8', '96/playlist.m3u8') : '');
                        var st = {
                            title:   cleanTitle(s.title),
                            tooltip: s.tooltip || 'Radio Record',
                            stream:  stream,
                            icon:    s.icon_gray || s.icon || '',
                            group:   'record'
                        };
                        st.uid = stationUid(st);
                        return st;
                    }).filter(function(s){ return s.stream; });
                }
                if (!record.length) {
                    record = RECORD_FALLBACK.map(function(s){ var st = Object.assign({}, s); st.uid = stationUid(st); return st; });
                }
                done();
            }, function(){
                record = RECORD_FALLBACK.map(function(s){ var st = Object.assign({}, s); st.uid = stationUid(st); return st; });
                done();
            });

            network['native'](API_LV, function(data) {
                if (Array.isArray(data)) {
                    latvian = data.filter(function(s){ return s.url_resolved || s.url; }).map(function(s) {
                        var st = {
                            title:   cleanTitle(s.name),
                            tooltip: (s.tags || '').split(',').slice(0,3).join(' • ') || s.country || '',
                            stream:  s.url_resolved || s.url,
                            icon:    s.favicon || '',
                            group:   'latvian'
                        };
                        st.uid = stationUid(st);
                        return st;
                    });
                    latvian = sortLatvian(latvian);
                }
                done();
            }, function(){ done(); });

            return this.render();
        };

        this.onData = function() {
            this.buildTabs();
            mode = Favorites.get().length ? 'fav' : (Recent.get().length ? 'recent' : 'all');
            this.applyFilter();

            // subscribe to engine -> keep now-playing bar + row badges in sync
            unsub = Engine.subscribe(function(station, state){ _this.syncEngine(station, state); });
            this.syncEngine(Engine.current(), Engine.state());

            this.activity.toggle();
            Lampa.Layer.update(html);
        };

        // ── Skeletons ────────────────────────────
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

        // ── Tabs ─────────────────────────────────
        this.tabDefs = function() {
            var defs = [];
            if (Favorites.get().length) defs.push({ id: 'fav', name: 'Избранное', count: Favorites.get().length });
            if (Recent.get().length)    defs.push({ id: 'recent', name: 'Недавние', count: Recent.get().length });
            defs.push({ id: 'all',     name: 'Все',     count: record.length + latvian.length });
            defs.push({ id: 'record',  name: 'Record',  count: record.length });
            defs.push({ id: 'latvian', name: 'Латвия',  count: latvian.length });
            return defs;
        };

        this.buildTabs = function() {
            var head = html.find('.lrv-content__head');
            head.empty();

            var search = $('<div class="simple-button simple-button--filter selector lrv-tab lrv-tab--search"><svg viewBox="0 0 24 24" width="1em" height="1em"><path fill="currentColor" d="M21 20l-5.6-5.6a7 7 0 1 0-1.4 1.4L20 21zM5 10a5 5 0 1 1 10 0 5 5 0 0 1-10 0z"/></svg></div>');
            search.on('hover:enter', function(){ _this.openSearch(); });
            head.append(search);

            this.tabDefs().forEach(function(d) {
                var badge = d.count != null ? '<span class="lrv-tab__badge">' + d.count + '</span>' : '';
                var btn = $('<div class="simple-button simple-button--filter selector lrv-tab" data-tab="' + d.id + '">' + d.name + badge + '</div>');
                btn.on('hover:enter', function() {
                    if (mode === d.id && !query) return;
                    mode = d.id; query = '';
                    _this.applyFilter();
                });
                head.append(btn);
            });
            html.find('.lrv-tab[data-tab="' + mode + '"]').addClass('active');
        };

        // ── Filter ───────────────────────────────
        this.sourceFor = function(m) {
            if (m === 'fav')     return Favorites.get();
            if (m === 'recent')  return Recent.get();
            if (m === 'record')  return record;
            if (m === 'latvian') return latvian;
            return record.concat(latvian);
        };

        this.applyFilter = function() {
            filtred = this.sourceFor(mode);
            if (query) {
                var q = query.toLowerCase();
                filtred = filtred.filter(function(s){
                    return (s.title || '').toLowerCase().indexOf(q) >= 0 ||
                           (s.tooltip || '').toLowerCase().indexOf(q) >= 0;
                });
            }
            html.find('.lrv-tab').removeClass('active');
            html.find('.lrv-tab[data-tab="' + mode + '"]').addClass('active');
            this.display();
        };

        this.display = function() {
            scroll.clear();
            scroll.reset();
            last = false;
            page = 0;
            if (filtred.length) {
                this.next();
                // preview first item without disturbing playback
                this.preview(filtred[0]);
            } else {
                var hint = query ? 'По запросу «' + query + '» ничего не найдено.'
                    : (mode === 'fav' ? 'Избранное пусто. Удерживайте OK на станции, чтобы добавить.' : 'Ничего не найдено.');
                scroll.append($('<div class="lrv-empty">' + hint + '</div>'));
                this.preview(null);
            }
            Lampa.Layer.visible(scroll.render(true));
        };

        this.next = function() {
            var views = 30;
            var start = page * views;
            var slice = filtred.slice(start, start + views);
            slice.forEach(function(s){ _this.append(s); });
            if (slice.length) page++;
            this.markPlaying();
            this.refreshFavorites();
            Lampa.Layer.visible(scroll.render(true));
        };

        // ── Preview (right panel) = FOCUSED station ──
        this.preview = function(station) {
            focused = station;
            var box   = html.find('.lrv-preview');
            var img   = box.find('.lrv-preview__img')[0];
            var imgBx = box.find('.lrv-preview__img-box');
            box.find('.lrv-preview__title').text(station ? station.title : '');
            box.find('.lrv-preview__tooltip').text(station ? (station.tooltip || '') : '');
            box.toggleClass('lrv-preview--empty', !station);
            if (station) loadArtwork(img, imgBx, station);
            else { $(imgBx).removeClass('loaded loaded-icon').removeAttr('data-letter'); img.removeAttribute('src'); }

            // is this previewed station the one playing?
            box.toggleClass('lrv-preview--playing', Engine.isCurrent(station));
        };

        // ── Now-Playing bar = ACTUALLY playing station ──
        this.syncEngine = function(station, state) {
            var bar = html.find('.lrv-nowbar');
            if (!station || state === 'idle') {
                bar.removeClass('show');
                _this.markPlaying();
                if (focused) html.find('.lrv-preview').toggleClass('lrv-preview--playing', false);
                return;
            }
            bar.addClass('show');
            bar.toggleClass('paused', state === 'paused');
            bar.toggleClass('loading', state === 'loading');

            bar.find('.lrv-nowbar__title').text(station.title);
            bar.find('.lrv-nowbar__track').text(station.tooltip || '').toggleClass('show', Boolean(station.tooltip));

            var img   = bar.find('.lrv-nowbar__img')[0];
            var imgBx = bar.find('.lrv-nowbar__img-box');
            if (bar.attr('data-uid') !== String(station.uid)) {
                bar.attr('data-uid', station.uid);
                loadArtwork(img, imgBx, station);
            }

            _this.markPlaying();
            // reflect playing state on preview if same station is focused
            html.find('.lrv-preview').toggleClass('lrv-preview--playing', Engine.isCurrent(focused));
        };

        // mark which row is playing/paused (independent of focus)
        this.markPlaying = function() {
            var cur = Engine.current();
            var st  = Engine.state();
            html.find('.lrv-item').removeClass('playing paused');
            if (cur && st !== 'idle') {
                var row = html.find('.lrv-item[data-uid="' + cur.uid + '"]');
                row.addClass('playing');
                row.toggleClass('paused', st === 'paused');
            }
        };

        // ── Row ──────────────────────────────────
        this.append = function(station) {
            var item   = Lampa.Template.get('lrv_item', {});
            item.attr('data-uid', station.uid);
            var imgBox = item.find('.lrv-item__cover-box');
            var img    = item.find('img')[0];
            item.find('.lrv-item__title').text(station.title);
            item.find('.lrv-item__tooltip').text(station.tooltip || '');
            loadArtwork(img, imgBox, station);

            item.toggleClass('favorite', Boolean(Favorites.find(station)));

            item.on('hover:focus', function() {
                last = item[0];
                scroll.update(item);
                _this.preview(station);   // preview only — never touches playback
            });
            item.on('hover:enter', function() {
                if (Engine.isCurrent(station)) Engine.toggle();   // play/pause toggle
                else Engine.play(station);                        // switch station
            });
            item.on('hover:long', function(){ _this.stationMenu(station, item); });

            if (!last) { last = item[0]; }
            if (Lampa.Controller.own(_this)) Lampa.Controller.collectionAppend(item);
            scroll.append(item);
        };

        // Re-sync heart state on every currently-rendered row against the store.
        // Called after any favorites change so hearts are correct in ALL tabs.
        this.refreshFavorites = function() {
            var favUids = {};
            Favorites.get().forEach(function(s){ favUids[s.uid] = true; });
            html.find('.lrv-item').each(function() {
                var uid = $(this).attr('data-uid');
                $(this).toggleClass('favorite', Boolean(favUids[uid]));
            });
        };

        // ── Context menu ─────────────────────────
        this.stationMenu = function(station, item) {
            var isFav = Boolean(Favorites.find(station));
            var items = [];
            if (Engine.isCurrent(station)) {
                items.push({ title: Engine.state() === 'playing' ? '⏸ Пауза' : '▶ Воспроизвести', action: 'toggle' });
                items.push({ title: '⏹ Остановить', action: 'stop' });
            } else {
                items.push({ title: '▶ Воспроизвести', action: 'play' });
            }
            items.push({ title: isFav ? '💔 Убрать из избранного' : '❤ В избранное', action: 'fav' });
            if (mode === 'fav') {
                items.push({ title: '⬆ Вверх', action: 'up' });
                items.push({ title: '⬇ Вниз',  action: 'down' });
            }
            Lampa.Select.show({
                title: station.title,
                items: items,
                onSelect: function(a) {
                    if (a.action === 'play')        Engine.play(station);
                    else if (a.action === 'toggle') Engine.toggle();
                    else if (a.action === 'stop')   Engine.stop();
                    else if (a.action === 'fav') {
                        var nowFav = Favorites.toggle(station);
                        Lampa.Noty.show(nowFav ? 'Добавлено в избранное' : 'Убрано из избранного');
                        _this.buildTabs();
                        if (mode === 'fav') _this.applyFilter();
                        else _this.refreshFavorites();
                    } else if (a.action === 'up' || a.action === 'down') {
                        if (Favorites.move(station, a.action === 'up' ? -1 : 1)) {
                            _this.applyFilter();
                            setTimeout(function() {
                                var el = html.find('.lrv-item[data-uid="' + station.uid + '"]')[0];
                                if (el) { last = el; Lampa.Controller.collectionFocus(el, html); scroll.update($(el)); }
                            }, 50);
                        }
                    }
                    Lampa.Controller.toggle('content');
                },
                onBack: function(){ Lampa.Controller.toggle('content'); }
            });
        };

        // ── Search ───────────────────────────────
        this.openSearch = function() {
            var apply = function(text) {
                query = (text || '').trim();
                if (mode === 'fav' || mode === 'recent') mode = 'all';
                _this.applyFilter();
            };
            try {
                Lampa.Input.edit({
                    free: true, nosave: true, value: query, title: 'Поиск станции',
                    onChange: function(text) { apply(text); },
                    onBack: function() { Lampa.Controller.toggle('content'); }
                }, function(text) { apply(text); Lampa.Controller.toggle('content'); });
            } catch (e) {
                // Fallback for environments without Lampa.Input.edit
                Lampa.Keyboard && Lampa.Keyboard.show ? Lampa.Keyboard.show({ layout: 'full', value: query }) : null;
                console.log('Search input unavailable:', e.message);
                Lampa.Noty.show('Поиск недоступен в этой версии Lampa');
                Lampa.Controller.toggle('content');
            }
        };

        // ── Navigation ───────────────────────────
        this.background = function(){ Lampa.Background.immediately(''); };

        this.start = function() {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) return;
            this.background();
            Lampa.Controller.add('content', {
                link: this,
                toggle: function() {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(last || false, html);
                },
                left:  function(){ if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function(){ if (Navigator.canmove('right')) Navigator.move('right'); },
                up:    function(){ if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down:  function(){ if (Navigator.canmove('down')) Navigator.move('down'); },
                back:  function(){ Lampa.Activity.backward(); }   // keep playing in background
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function(){};
        this.stop    = function(){};
        this.render  = function(){ return html; };
        this.destroy = function() {
            if (unsub) unsub();
            network.clear();
            if (scroll) scroll.destroy();
            html.remove();
            // NOTE: Engine is intentionally NOT stopped — radio keeps
            // playing when you leave the screen, like a real player.
        };
    }

    // ════════════════════════════════════════════════
    //  BOOT
    // ════════════════════════════════════════════════
    function startPlugin() {
        window[PLUGIN_ID] = true;
        migrateStored();
        Lampa.Lang.add({ lrv_title: { ru: 'Радио', en: 'Radio', uk: 'Радіо' } });

        var manifest = { type: 'audio', version: '1.4.0', name: Lampa.Lang.translate('lrv_title'), description: 'Radio: Record + Latvia', component: 'lrv' };
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
                        '<div class="lrv-content__side"><div class="lrv-preview lrv-preview--empty">' +
                            '<div class="lrv-preview__img-box"><img class="lrv-preview__img" /><div class="lrv-preview__ph">' + ICON + '</div></div>' +
                            '<div class="lrv-preview__badge">Сейчас играет</div>' +
                            '<div class="lrv-preview__title"></div>' +
                            '<div class="lrv-preview__tooltip"></div>' +
                        '</div></div>' +
                    '</div>' +
                '</div>' +
                // persistent now-playing bar
                '<div class="lrv-nowbar">' +
                    '<div class="lrv-nowbar__img-box"><img class="lrv-nowbar__img" /><div class="lrv-nowbar__ph">' + ICON + '</div></div>' +
                    '<div class="lrv-nowbar__info">' +
                        '<div class="lrv-nowbar__title"></div>' +
                        '<div class="lrv-nowbar__track"></div>' +
                    '</div>' +
                    '<div class="lrv-nowbar__status">' +
                        '<div class="lrv-nowbar__eq"><i></i><i></i><i></i><i></i></div>' +
                        '<div class="lrv-nowbar__spinner"></div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_item',
            '<div class="lrv-item selector layer--visible">' +
                '<div class="lrv-item__cover"><div class="lrv-item__cover-box"><img /><div class="lrv-item__ph">' + ICON + '</div></div></div>' +
                '<div class="lrv-item__body"><div class="lrv-item__title"></div><div class="lrv-item__tooltip"></div></div>' +
                '<div class="lrv-item__state">' +
                    '<div class="lrv-item__fav"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path class="lrv-heart" d="M12 21s-8.5-5.4-11-10.2C-.5 6.6 1.8 3 5.5 3 8 3 9.7 4.4 12 7c2.3-2.6 4-4 6.5-4C22.2 3 24.5 6.6 23 10.8 20.5 15.6 12 21 12 21z"/></svg></div>' +
                    '<div class="lrv-item__eq"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-1 7-4.6 7-8.8s-3-7.8-7-8.8zM3 9v6h4l5 5V4L7 9H3zm13 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z"/></svg></div>' +
                    '<div class="lrv-item__pause"><svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg></div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_style',
            '<style>' +
            '.lrv-content{padding:0 1.5em}' +
            '.lrv-content__head{display:flex;padding:1.2em 0;flex-wrap:wrap;align-items:center}' +
            '.lrv-tab{margin-right:.7em;margin-bottom:.5em;display:inline-flex;align-items:center}' +
            '.lrv-tab--search{padding-left:.9em;padding-right:.9em}' +
            '.lrv-tab.active{background:rgba(255,255,255,.2)}' +
            '.lrv-tab__badge{margin-left:.5em;font-size:.78em;opacity:.6;background:rgba(255,255,255,.14);border-radius:1em;padding:.05em .55em;min-width:1.4em;text-align:center}' +
            '.lrv-tab.focus .lrv-tab__badge{background:rgba(0,0,0,.12);opacity:.7}' +
            '.lrv-content__body{display:flex}' +
            '.lrv-content__list{width:58%;padding-bottom:5em}' +
            '.lrv-content__side{width:42%;padding:0 1em 0 3em}' +
            '@media screen and (max-width:700px){.lrv-content__list{width:100%}.lrv-content__side{display:none}}' +
            '.lrv-empty{padding:2em 1em;opacity:.55;font-size:1.15em;line-height:1.5}' +
            // row
            '.lrv-item{padding:.7em 1em;display:flex;align-items:center;line-height:1.35;border-radius:.8em;transition:background .15s}' +
            '.lrv-item__cover{width:3.2em;flex-shrink:0;margin-right:1.1em}' +
            '.lrv-item__cover-box{position:relative;padding-bottom:100%;background:rgba(255,255,255,.07);border-radius:.5em;overflow:hidden}' +
            '.lrv-item__cover-box img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:.5em;opacity:0;transition:opacity .25s}' +
            '.lrv-item__ph{position:absolute;left:28%;top:28%;width:44%;height:44%;opacity:.35;display:flex}.lrv-item__ph svg{width:100%;height:100%}' +
            '.lrv-item__cover-box.loaded img{opacity:1}.lrv-item__cover-box.loaded .lrv-item__ph{display:none}' +
            '.lrv-item__cover-box.loaded-icon .lrv-item__ph{display:none}' +
            '.lrv-item__cover-box[data-letter]:after{content:attr(data-letter);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.4em;color:#fff;background:var(--lrv-avatar,#444);border-radius:.5em}' +
            '.lrv-item__body{flex:1;min-width:0}' +
            '.lrv-item__title{font-weight:600;font-size:1.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-item__tooltip{opacity:.45;margin-top:.25em;font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-item__state{margin-left:.8em;flex-shrink:0;width:1.6em;display:flex;align-items:center;justify-content:center}' +
            '.lrv-item__pause{opacity:0;display:none}' +
            // heart shown on EVERY row: outline only (gray stroke, no fill)
            '.lrv-item__fav{display:flex;transition:transform .2s cubic-bezier(.34,1.56,.64,1)}' +
            '.lrv-item__fav svg{width:1.3em;height:1.3em;overflow:visible}' +
            '.lrv-item__fav .lrv-heart{fill:transparent;stroke:rgba(255,255,255,.45);stroke-width:1.8px;transition:fill .2s ease,stroke .2s ease}' +
            // focused row (white bg): darken outline so it stays visible
            '.lrv-item.focus .lrv-item__fav .lrv-heart{stroke:rgba(0,0,0,.4)}' +
            // favorite: red fill, keep light border + soft glow + pop on add
            '.lrv-item.favorite .lrv-item__fav .lrv-heart{fill:#ff4d6d;stroke:rgba(255,255,255,.85)}' +
            '.lrv-item.favorite.focus .lrv-item__fav .lrv-heart{stroke:rgba(0,0,0,.55)}' +
            '.lrv-item.favorite .lrv-item__fav svg{filter:drop-shadow(0 0 .3em rgba(255,77,109,.5))}' +
            '.lrv-item.favorite .lrv-item__fav{animation:lrvHeartPop .4s cubic-bezier(.34,1.56,.64,1)}' +
            '@keyframes lrvHeartPop{0%{transform:scale(.5)}55%{transform:scale(1.25)}100%{transform:scale(1)}}' +
            '.lrv-item__eq{display:none}' +
            '.lrv-item__pause svg{width:1.3em;height:1.3em}' +
            // playing row: show play glyph, hide heart; paused: show pause glyph
            '.lrv-item.playing .lrv-item__fav{display:none}' +
            '.lrv-item.playing .lrv-item__eq{display:flex;opacity:.9}' +
            '.lrv-item.playing.paused .lrv-item__eq{display:none}' +
            '.lrv-item.playing.paused .lrv-item__pause{display:flex;opacity:.85}' +
            '.lrv-item.playing .lrv-item__title{color:#fff}' +
            '.lrv-item.focus .lrv-item__title{color:inherit}' +
            '.lrv-item.focus{background:#fff;color:#000}' +
            '.lrv-item.focus .lrv-item__cover-box{background:rgba(0,0,0,.08)}' +
            '.lrv-item.focus.playing .lrv-item__title{color:#000}' +
            // skeletons
            '.lrv-skeleton{pointer-events:none}' +
            '.lrv-sk{background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.12) 37%,rgba(255,255,255,.05) 63%);background-size:400% 100%;animation:lrvShimmer 1.4s ease infinite;border-radius:.4em}' +
            '.lrv-item__cover-box.lrv-sk{padding-bottom:0;height:100%}.lrv-skeleton .lrv-item__cover{height:3.2em}' +
            '.lrv-sk--line{height:.95em;margin:.2em 0}.lrv-sk--sub{height:.7em;opacity:.7}' +
            '@keyframes lrvShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}' +
            // preview panel (focused station)
            '.lrv-preview{text-align:center;position:sticky;top:5em;transition:opacity .2s}' +
            '.lrv-preview--empty{opacity:.4}' +
            '.lrv-preview__img-box{position:relative;max-width:15em;margin:0 auto;padding-bottom:min(100%,15em);background:rgba(255,255,255,.06);border-radius:1.2em;overflow:hidden;box-shadow:0 1.2em 2.5em rgba(0,0,0,.35)}' +
            '.lrv-preview__img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:1.2em;opacity:0;transition:opacity .3s}' +
            '.lrv-preview__ph{position:absolute;left:30%;top:30%;width:40%;height:40%;opacity:.3;display:flex}.lrv-preview__ph svg{width:100%;height:100%}' +
            '.lrv-preview__img-box.loaded .lrv-preview__img{opacity:1}.lrv-preview__img-box.loaded .lrv-preview__ph{display:none}' +
            '.lrv-preview__img-box.loaded-icon .lrv-preview__ph{display:none}' +
            '.lrv-preview__img-box[data-letter]:after{content:attr(data-letter);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:5em;color:#fff;background:var(--lrv-avatar,#444);border-radius:1.2em}' +
            '.lrv-preview__badge{display:none;margin-top:1em;font-size:.85em;letter-spacing:.1em;text-transform:uppercase;opacity:.6}' +
            '.lrv-preview--playing .lrv-preview__badge{display:block}' +
            '.lrv-preview__title{font-weight:700;font-size:1.5em;margin-top:.6em}' +
            '.lrv-preview--playing .lrv-preview__title{margin-top:.3em}' +
            '.lrv-preview__tooltip{opacity:.5;font-size:1.1em;margin-top:.4em;line-height:1.4;padding:0 1em}' +
            // now-playing bar
            '.lrv-nowbar{position:fixed;left:0;right:0;bottom:1.2em;margin:0 auto;z-index:80;display:flex;align-items:center;width:-webkit-fit-content;width:fit-content;max-width:min(34em,90%);padding:.7em 1.4em;background:rgba(20,20,22,.94);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.1);border-radius:5em;box-shadow:0 1em 2.5em rgba(0,0,0,.5);-webkit-transform:translateY(160%);transform:translateY(160%);-webkit-transition:-webkit-transform .4s cubic-bezier(.2,.8,.2,1);transition:transform .4s cubic-bezier(.2,.8,.2,1)}' +
            '.lrv-nowbar.show{-webkit-transform:translateY(0);transform:translateY(0)}' +
            '.lrv-nowbar__img-box{position:relative;width:2.8em;height:2.8em;flex-shrink:0;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.08)}' +
            '.lrv-nowbar__img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s}' +
            '.lrv-nowbar__ph{position:absolute;left:28%;top:28%;width:44%;height:44%;opacity:.4;display:flex}.lrv-nowbar__ph svg{width:100%;height:100%}' +
            '.lrv-nowbar__img-box.loaded .lrv-nowbar__img{opacity:1}.lrv-nowbar__img-box.loaded .lrv-nowbar__ph{display:none}' +
            '.lrv-nowbar__img-box.loaded-icon .lrv-nowbar__ph{display:none}' +
            '.lrv-nowbar__img-box[data-letter]:after{content:attr(data-letter);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.4em;color:#fff;background:var(--lrv-avatar,#444)}' +
            '.lrv-nowbar__info{flex:1;min-width:0;margin:0 1.2em}' +
            '.lrv-nowbar__title{font-weight:600;font-size:1.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-nowbar__track{opacity:0;font-size:.92em;margin-top:.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-height:0;transition:opacity .3s}' +
            '.lrv-nowbar__track.show{opacity:.55;max-height:2em}' +
            '.lrv-nowbar__status{flex-shrink:0;width:1.8em;height:1.8em;display:flex;align-items:center;justify-content:center}' +
            '.lrv-nowbar__spinner{display:none;width:1.3em;height:1.3em;border:.16em solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:lrvSpin .8s linear infinite}' +
            '@keyframes lrvSpin{to{transform:rotate(360deg)}}' +
            // live equalizer = playing
            '.lrv-nowbar__eq{display:flex;align-items:flex-end;height:1.5em}' +
            '.lrv-nowbar__eq i{display:block;width:.22em;margin:0 .08em;background:#fff;height:.3em;border-radius:2px;transform-origin:bottom;animation:lrvNowEq .9s ease-in-out infinite}' +
            '.lrv-nowbar__eq i:nth-child(1){animation-delay:0s}' +
            '.lrv-nowbar__eq i:nth-child(2){animation-delay:.25s}' +
            '.lrv-nowbar__eq i:nth-child(3){animation-delay:.5s}' +
            '.lrv-nowbar__eq i:nth-child(4){animation-delay:.15s}' +
            '@keyframes lrvNowEq{0%,100%{height:.3em}25%{height:1.4em}50%{height:.6em}75%{height:1.1em}}' +
            // paused: freeze bars mid-height, dimmed
            '.lrv-nowbar.paused .lrv-nowbar__eq i{animation-play-state:paused;opacity:.4;height:.7em}' +
            // loading: hide bars, show spinner
            '.lrv-nowbar.loading .lrv-nowbar__eq{display:none}' +
            '.lrv-nowbar.loading .lrv-nowbar__spinner{display:block}' +
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
