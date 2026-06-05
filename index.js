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
    // Normalize a station title for identity matching: lowercase, strip a
    // trailing " lv"/".lv"/" latvia" marker, collapse spaces, drop punctuation.
    // So "TOP radio lv" and "TOP Radio" resolve to the same station.
    function normTitle(name) {
        var s = (name || '').toLowerCase();
        // strip diacritics so "latviešu" == "latviesu"
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch(e) {}
        s = s
            .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ')      // remove (128k), [LV], {hq} tags
            .replace(/\b\d{2,3}\s?(kbps|kbit|kb|k|bit)\b/g, ' ') // bitrate words
            .replace(/\.(lv|com|fm|net|eu|ru)\b/g, ' ')       // domain suffixes
            .replace(/\b(lv|latvia|latvija|online|live|stream|radio station|hd|hq|aac|mp3)\b/g, ' ') // noise words
            .replace(/[^a-z0-9\u0400-\u04ff ]+/g, ' ')        // keep latin/cyrillic/digits/space only
            .replace(/\s+/g, ' ')
            .trim();
        return s;
    }
    function stationUid(st) {
        // Normalized-title + group is stable across stream-URL changes and
        // minor name variants, so favorites/recents/dedup stay consistent.
        var key = normTitle(st.title) + '|' + (st.group || '');
        return Lampa.Utils.hash(key || st.stream || '');
    }
    function cleanTitle(name) { return (name || '').replace(/\s+/g, ' ').trim(); }

    // Remove duplicate stations (same uid). radio-browser often lists the
    // same station several times (different bitrate/stream rows); since uid
    // is title-based they collapse to one. Keeps the first occurrence, and
    // prefers a copy that actually has an icon if the first lacks one.
    function dedupByUid(list) {
        var seen = {};
        var out = [];
        list.forEach(function(st) {
            var ex = seen[st.uid];
            if (!ex) { seen[st.uid] = st; out.push(st); }
            else if (!ex.icon && st.icon) { ex.icon = st.icon; } // enrich kept copy
        });
        return out;
    }

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
            var list = Store.list(key).map(function(s) {
                s.uid = stationUid(s);
                return s;
            });
            // collapse duplicates that the title-based uid may have created
            var seen = {}, out = [];
            list.forEach(function(s){ if (!seen[s.uid]) { seen[s.uid] = 1; out.push(s); } });
            if (out.length !== Store.list(key).length || JSON.stringify(out) !== JSON.stringify(Store.list(key))) {
                Store.save(key, out);
            }
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

        // Web Audio analyser for real bass-reactive visuals (best-effort)
        var audioCtx = null, analyser = null, srcNode = null, freqData = null;
        var analyserReady = false, analyserTried = false, analyserBlocked = false;

        audio.preload = 'none';
        audio.volume  = volume;
        audio.crossOrigin = 'anonymous';

        function setupAnalyser() {
            if (analyserTried) return;     // one shot — element source can attach once
            analyserTried = true;
            try {
                var Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) { analyserBlocked = true; return; }
                audioCtx = new Ctx();
                srcNode  = audioCtx.createMediaElementSource(audio);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.75;
                srcNode.connect(analyser);
                analyser.connect(audioCtx.destination);   // keep audio audible
                freqData = new Uint8Array(analyser.frequencyBinCount);
                analyserReady = true;
            } catch (e) {
                // CORS-tainted stream or unsupported -> graceful fallback
                analyserBlocked = true;
                analyserReady = false;
                console.log('Bass analyser unavailable:', e.message);
            }
        }

        // Returns a 0..1 bass intensity, or -1 if analysis isn't available.
        this.bassLevel = function() {
            if (!analyserReady || !analyser) return -1;
            try {
                if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
                analyser.getByteFrequencyData(freqData);
                // average the lowest ~6 bins (sub-bass / bass band)
                var n = Math.min(6, freqData.length), sum = 0;
                for (var i = 0; i < n; i++) sum += freqData[i];
                return (sum / n) / 255;
            } catch (e) { return -1; }
        };
        this.analyserBlocked = function(){ return analyserBlocked; };

        function clampVol(v){ v = parseFloat(v); if (isNaN(v)) v = 1; return Math.max(0, Math.min(1, v)); }

        audio.addEventListener('playing', function(){
            retries = 0;
            clearTimeout(loadTimer);
            startStallWatch();
            fadeIn();
            setState('playing');
            acquireWake();
            setupAnalyser();
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
                    record = dedupByUid(record);
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
                    latvian = sortLatvian(dedupByUid(latvian));
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
            unsub = Engine.subscribe(function(station, state){
                _this.syncEngine(station, state);
                // playback changes count as activity (covers OK-only usage),
                // but never close the saver here — in-saver switching relies on it
                if (idleTimer !== null) _this.resetIdle(_this.saverActive());
            });
            this.syncEngine(Engine.current(), Engine.state());

            this.resetIdle();   // start the idle/screensaver timer
            this.bindLongOk();  // long-press OK launches the screensaver

            this.activity.toggle();
            Lampa.Layer.update(html);
        };

        // Hold OK/Enter ~2.5s to launch the screensaver (bonus to the menu item).
        this.bindLongOk = function() {
            var downAt = 0, fired = false;
            this._okDown = function(e) {
                var code = e.keyCode || e.which;
                if (code !== 13) return;                 // Enter / OK only
                if (_this.saverActive()) return;
                if (Lampa.Activity.active() && Lampa.Activity.active().activity !== _this.activity) return;
                if (!Engine.current() || Engine.state() === 'idle') return; // only while playing
                if (!downAt) { downAt = Date.now(); fired = false; }
                else if (!fired && Date.now() - downAt > 2500) {
                    fired = true;
                    _this.showSaver();
                }
            };
            this._okUp = function(e) {
                var code = e.keyCode || e.which;
                if (code === 13) { downAt = 0; fired = false; }
            };
            document.addEventListener('keydown', this._okDown);
            document.addEventListener('keyup', this._okUp);
        };
        this.unbindLongOk = function() {
            if (this._okDown) document.removeEventListener('keydown', this._okDown);
            if (this._okUp)   document.removeEventListener('keyup', this._okUp);
        };

        // ── Ambient screensaver (idle + playing) ──────────────
        var IDLE_MS = 30 * 1000;   // 30 seconds
        var idleTimer = null;
        var saverOn = false;

        this.resetIdle = function(keepSaver) {
            if (saverOn && !keepSaver) this.hideSaver();
            clearTimeout(idleTimer);
            idleTimer = setTimeout(function(){ _this.showSaver(); }, IDLE_MS);
        };
        this.stopIdle = function() { clearTimeout(idleTimer); idleTimer = null; };

        // The list the saver navigates: current tab's stations, falling back
        // to the full set so prev/next always has somewhere to go.
        this.saverList = function() {
            var list = (filtred && filtred.length) ? filtred : this.sourceFor(mode);
            if (!list || !list.length) list = record.concat(latvian);
            return list;
        };

        this.renderSaver = function() {
            var st = Engine.current();
            if (!st) return;
            var list = this.saverList();
            var idx = -1;
            for (var i = 0; i < list.length; i++) { if (list[i].uid === st.uid) { idx = i; break; } }

            var box = html.find('.lrv-saver');
            box.find('.lrv-saver__title').text(st.title || '');
            box.find('.lrv-saver__sub').text(st.tooltip || '');
            var artBx = box.find('.lrv-saver__art');
            artBx.removeClass('loaded loaded-icon').removeAttr('data-letter').css('background-color', '');
            loadArtwork(box.find('.lrv-saver__img')[0], artBx[0], st);

            function fillNeighbor(node, station) {
                var $n = $(node);
                if (!station) { $n.css('visibility', 'hidden'); return; }
                $n.css('visibility', 'visible');
                $n.find('.lrv-saver__nname').text(station.title || '');
                var bx = $n.find('.lrv-saver__nart');
                bx.removeClass('loaded loaded-icon').removeAttr('data-letter').css('background-color', '');
                loadArtwork($n.find('img')[0], bx[0], station);
            }

            var hasMany = idx >= 0 && list.length > 1;
            // prev side: n1 = closest (idx-1), n2, n3 further back
            for (var p = 1; p <= 3; p++) {
                var prevNode = box.find('.lrv-saver__side--prev .lrv-saver__n' + p)[0];
                fillNeighbor(prevNode, hasMany && list.length > p ? list[(idx - p + list.length) % list.length] : null);
                var nextNode = box.find('.lrv-saver__side--next .lrv-saver__n' + p)[0];
                fillNeighbor(nextNode, hasMany && list.length > p ? list[(idx + p) % list.length] : null);
            }
        };

        // Switch station while staying in the saver. dir = -1 prev, +1 next.
        this.saverSwitch = function(dir) {
            var list = this.saverList();
            if (!list.length) return;
            var cur = Engine.current();
            var idx = -1;
            for (var i = 0; i < list.length; i++) { if (cur && list[i].uid === cur.uid) { idx = i; break; } }
            var nextIdx = idx < 0 ? 0 : (idx + dir + list.length) % list.length;
            var nextSt = list[nextIdx];
            if (!nextSt) return;
            // brief slide hint, then play + re-render
            var box = html.find('.lrv-saver');
            box.addClass(dir > 0 ? 'lrv-saver--slidenext' : 'lrv-saver--slideprev');
            Engine.play(nextSt);
            setTimeout(function() {
                box.removeClass('lrv-saver--slidenext lrv-saver--slideprev');
                _this.renderSaver();
            }, 180);
        };

        this.showSaver = function() {
            var st = Engine.current();
            if (!st || Engine.state() === 'idle') { this.resetIdle(); return; }
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) return;
            this.renderSaver();
            html.find('.lrv-saver').addClass('show');
            saverOn = true;
            this.startBass();
        };

        this.hideSaver = function() {
            saverOn = false;
            html.find('.lrv-saver').removeClass('show');
            this.stopBass();
        };

        this.saverActive = function(){ return saverOn; };

        // ── Bass-reactive: blue subwoofer glow around the cover ──
        // Soft radial halo blooms big & bright on the beat (like a sub cone),
        // plus a sharp "thump" ring on the cover for kicks. No clipping.
        var bassRAF = null;
        this.startBass = function() {
            var art   = html.find('.lrv-saver__art')[0];
            var glow  = html.find('.lrv-saver__glow')[0];
            if (!art) return;
            var analyserOff = Engine.analyserBlocked && Engine.analyserBlocked();
            if (analyserOff) $(art).addClass('lrv-saver__art--breath');
            else $(art).removeClass('lrv-saver__art--breath');

            var cone = 0, idle = 0, lastFrame = 0;
            var tick = function(ts) {
                if (!saverOn) return;
                bassRAF = requestAnimationFrame(tick);
                if (ts - lastFrame < 33) return;             // ~30fps cap
                lastFrame = ts;

                var b = Engine.bassLevel ? Engine.bassLevel() : -1;
                var level;
                if (b < 0) {
                    idle += 0.05;
                    level = 0.22 + Math.sin(idle) * 0.18;     // synthetic breathing
                    $(art).addClass('lrv-saver__art--breath');
                } else {
                    $(art).removeClass('lrv-saver__art--breath');
                    var target = b * b;                       // emphasize hits
                    if (target > cone) cone = target;         // instant attack
                    else cone += (target - cone) * 0.34;      // quick release
                    level = cone;
                    // cover pumps, with a bright blue thump-halo on kicks
                    art.style.transform = 'scale(' + (1 + cone * 0.14).toFixed(3) + ')';
                    art.style.boxShadow = '0 1.2em 3em rgba(0,0,0,.55), 0 0 ' + (cone * 4).toFixed(2) + 'em ' + (cone * 1.2).toFixed(2) + 'em rgba(255,255,255,' + (cone * 0.6).toFixed(3) + ')';
                }
                // the subwoofer halo: blooms large and bright with the beat
                if (glow) {
                    glow.style.transform = 'translate(-50%,-50%) scale(' + (1 + level * 1.8).toFixed(3) + ')';
                    glow.style.opacity = Math.min(1, 0.16 + level * 0.9).toFixed(3);
                }
            };
            bassRAF = requestAnimationFrame(tick);
        };
        this.stopBass = function() {
            if (bassRAF) { cancelAnimationFrame(bassRAF); bassRAF = null; }
            var art = html.find('.lrv-saver__art')[0];
            var glow = html.find('.lrv-saver__glow')[0];
            if (art) { art.style.transform = ''; art.style.boxShadow = ''; }
            if (glow) { glow.style.transform = 'translate(-50%,-50%) scale(1)'; glow.style.opacity = ''; glow.style.filter = ''; }
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
                    if (mode === d.id && !query) { _this.focusList(); return; }
                    mode = d.id; query = '';
                    _this.applyFilter();
                    _this.focusList();
                });
                head.append(btn);
            });
            html.find('.lrv-tab[data-tab="' + mode + '"]').addClass('active');
        };

        // ── Filter ───────────────────────────────
        this.sourceFor = function(m) {
            if (m === 'fav')     return dedupByUid(Favorites.get());
            if (m === 'recent')  return dedupByUid(Recent.get());
            if (m === 'record')  return record;
            if (m === 'latvian') return latvian;
            return dedupByUid(record.concat(latvian));
        };

        this.applyFilter = function(keepUid) {
            // if the current mode's tab no longer exists (e.g. favorites emptied,
            // recents not yet populated), fall back to a sensible default
            if (mode === 'fav' && !Favorites.get().length) mode = Recent.get().length ? 'recent' : 'all';
            if (mode === 'recent' && !Recent.get().length) mode = 'all';

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
            this.display(keepUid);
        };

        this.display = function(keepUid) {
            scroll.clear();
            scroll.reset();
            last = false;
            page = 0;
            if (filtred.length) {
                this.next();
                this.preview(filtred[0]);
                // restore focus: to a specific station if asked, else first row
                var target = null;
                if (keepUid) target = html.find('.lrv-item[data-uid="' + keepUid + '"]')[0];
                if (!target) target = html.find('.lrv-item')[0];
                if (target) { last = target; }
            } else {
                var hint = query ? 'По запросу «' + query + '» ничего не найдено.'
                    : (mode === 'fav' ? 'Избранное пусто. Удерживайте OK на станции в любой вкладке, чтобы добавить.' : 'Ничего не найдено.');
                scroll.append($('<div class="lrv-empty">' + hint + '</div>'));
                this.preview(null);
                last = false;
            }
            Lampa.Layer.visible(scroll.render(true));
        };

        // Re-assert controller focus onto the current list target (or tabs if
        // the list is empty), so focus is never lost after a rebuild.
        this.restoreFocus = function() {
            var target = (last && $(last).hasClass('lrv-item')) ? last : html.find('.lrv-item')[0];
            if (target) {
                last = target;
                Lampa.Controller.collectionSet(html);
                Lampa.Controller.collectionFocus(target, html);
            } else {
                // empty list (e.g. removed last favorite) -> focus the tabs row
                var tab = html.find('.lrv-tab.active')[0] || html.find('.lrv-tab')[0];
                if (tab) {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(tab, html);
                }
            }
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
            // load art for the first rows only (cheap); rest loads on focus
            if (page === 1) this.loadInitialArt();
        };

        // ── Preview (right panel) = FOCUSED station ──
        // No more side panel — just remember which station is focused.
        this.preview = function(station) {
            focused = station;
        };

        // ── Now-Playing bar = ACTUALLY playing station ──
        this.syncEngine = function(station, state) {
            _this.markPlaying();
        };

        // mark which row is playing/loading/paused (independent of focus)
        this.markPlaying = function() {
            var cur = Engine.current();
            var st  = Engine.state();
            html.find('.lrv-item').removeClass('playing paused loading');
            if (cur && st !== 'idle') {
                var row = html.find('.lrv-item[data-uid="' + cur.uid + '"]');
                row.addClass('playing');
                row.toggleClass('paused', st === 'paused');
                row.toggleClass('loading', st === 'loading');
            }
        };

        // ── Row ──────────────────────────────────
        this.append = function(station) {
            // hard guard: never render the same uid twice in the current list
            if (html.find('.lrv-item[data-uid="' + station.uid + '"]').length) return;

            var item   = Lampa.Template.get('lrv_item', {});
            item.attr('data-uid', station.uid);
            item.find('.lrv-item__title').text(station.title);
            item.find('.lrv-item__tooltip').text(station.tooltip || '');

            // Defer artwork: store station on the node, load when near view.
            // Keeps fast (held-key) scrolling smooth — no network churn per row.
            item[0]._station = station;
            item[0]._artLoaded = false;

            item.toggleClass('favorite', Boolean(Favorites.find(station)));

            item.on('hover:focus', function() {
                last = item[0];
                scroll.update(item);
                _this.loadRowArt(item[0]);     // ensure focused row art is loaded
                _this.loadNearby(item[0]);     // and a few neighbors ahead
                focused = station;             // remember focused station
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

        // Load artwork for a single row node (once).
        this.loadRowArt = function(node) {
            if (!node || node._artLoaded || !node._station) return;
            node._artLoaded = true;
            var $n = $(node);
            loadArtwork($n.find('img')[0], $n.find('.lrv-item__cover-box')[0], node._station);
        };

        // Load art for the focused row's neighbors (look-ahead window) so
        // images are ready by the time the user scrolls to them.
        this.loadNearby = function(node) {
            if (!node) return;
            var items = html.find('.lrv-item').toArray();
            var idx = items.indexOf(node);
            if (idx < 0) return;
            for (var i = Math.max(0, idx - 2); i <= Math.min(items.length - 1, idx + 6); i++) {
                _this.loadRowArt(items[i]);
            }
        };

        // Load art for the first N rows after a (re)render so the initial
        // screenful shows logos immediately without waiting for focus.
        this.loadInitialArt = function() {
            var items = html.find('.lrv-item').toArray();
            for (var i = 0; i < Math.min(items.length, 10); i++) _this.loadRowArt(items[i]);
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
            // In the favorites tab, prioritize reordering (fewest clicks):
            // move up/down first, "remove from favorites" pushed to the bottom.
            if (mode === 'fav') {
                items.push({ title: '⬆ Вверх', action: 'up' });
                items.push({ title: '⬇ Вниз',  action: 'down' });
                if (!Engine.isCurrent(station)) items.push({ title: '▶ Воспроизвести', action: 'play' });
                items.push({ title: '💔 Убрать из избранного', action: 'fav' });
            } else {
                if (!Engine.isCurrent(station)) items.push({ title: '▶ Воспроизвести', action: 'play' });
                items.push({ title: isFav ? '💔 Убрать из избранного' : '❤️ В избранное', action: 'fav' });
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
                        if (mode === 'fav') {
                            // removing from the fav tab rebuilds the list; keep
                            // focus near where we were (next item or tabs)
                            var rows = html.find('.lrv-item').toArray();
                            var curIdx = rows.indexOf(item[0]);
                            _this.applyFilter();
                            var newRows = html.find('.lrv-item').toArray();
                            var focusTarget = newRows[Math.min(curIdx, newRows.length - 1)] || null;
                            last = focusTarget || false;
                            _this.restoreFocus();
                            Lampa.Controller.toggle('content');
                            return;
                        } else {
                            _this.refreshFavorites();
                        }
                    } else if (a.action === 'up' || a.action === 'down') {
                        if (Favorites.move(station, a.action === 'up' ? -1 : 1)) {
                            _this.applyFilter();
                            var el = html.find('.lrv-item[data-uid="' + station.uid + '"]')[0];
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

        // Where is focus right now? (list row / a tab)
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
        this.focusSearch = function() {
            var s = html.find('.lrv-tab--search')[0] || html.find('.lrv-tab')[0];
            if (s) Lampa.Controller.collectionFocus(s, html);
        };

        // True only if moving up/down from the focused row lands on another
        // list row (prevents the list from jumping to the tabs row above).
        this.canMoveWithinList = function(dir) {
            var rows = html.find('.lrv-item').toArray();
            if (!rows.length) return false;
            var cur = html.find('.lrv-item.focus')[0] || last;
            var idx = rows.indexOf(cur);
            if (idx < 0) return false;
            return dir === 'up' ? idx > 0 : idx < rows.length - 1;
        };

        this.start = function() {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) return;
            this.background();

            // Any key resets the idle timer. If the screensaver is showing, the
            // key only dismisses it (consumed) and does NOT also act on the UI.
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
                    if (z === 'tab') { return; }   // tabs are topmost — don't escape to Lampa head
                    // in the list: gentle stepping scrolls; holding UP ~1.5s jumps
                    // to the search tab; a single press at the very top row also
                    // goes to the tabs.
                    var now = Date.now();
                    if (now - _this._lastUp < 260) {          // auto-repeat (held)
                        if (!_this._upHoldStart) _this._upHoldStart = _this._lastUp;
                        if (now - _this._upHoldStart > 1500) {
                            _this._upHoldStart = 0; _this._lastUp = 0;
                            _this.focusSearch();
                            return;
                        }
                    } else {
                        _this._upHoldStart = 0;                // separate taps reset
                    }
                    _this._lastUp = now;
                    if (_this.canMoveWithinList('up')) Navigator.move('up');
                    else _this.focusTabs();                    // at top row -> tabs
                }),
                down: gate(function() {
                    var z = _this.zone();
                    if (z === 'tab') { _this.focusList(); return; }   // tabs -> back into list
                    if (_this.canMoveWithinList('down')) { Navigator.move('down'); return; }
                    // at last loaded row: load more, then step down if it grew
                    var before = html.find('.lrv-item').length;
                    if (filtred.length > before) {
                        _this.next();
                        if (html.find('.lrv-item').length > before) Navigator.move('down');
                    }
                }),
                enter: function() {
                    // In the saver, OK pauses/resumes the PLAYING station and
                    // stays in the saver (does NOT exit). Other keys exit.
                    if (_this.saverActive()) {
                        _this.resetIdle(true);          // keep saver open, restart timer
                        if (Engine.current()) Engine.toggle();
                        return;
                    }
                    _this.resetIdle();
                    // normal behavior: fire the focused element's own handler
                    var f = html.find('.focus')[0];
                    if (f) $(f).trigger('hover:enter');
                },
                back: function() {
                    if (_this.saverActive()) { _this.resetIdle(); return; } // wake, don't exit
                    _this.stopIdle();
                    Lampa.Activity.backward();   // keep playing in background
                }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function(){};
        this.stop    = function(){};
        this.render  = function(){ return html; };
        this.destroy = function() {
            if (unsub) unsub();
            this.stopIdle();
            this.hideSaver();
            this.unbindLongOk();
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
                    '</div>' +
                '</div>' +
                // ambient screensaver (shown after idle while playing)
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
            '.lrv-tab--search{padding-left:.9em;padding-right:.9em}' +
            '.lrv-tab.active{background:rgba(255,255,255,.2)}' +
            '.lrv-tab__badge{margin-left:.5em;font-size:.78em;opacity:.6;background:rgba(255,255,255,.14);border-radius:1em;padding:.05em .55em;min-width:1.4em;text-align:center}' +
            '.lrv-tab.focus .lrv-tab__badge{background:rgba(0,0,0,.12);opacity:.7}' +
            '.lrv-content__body{display:flex;justify-content:center}' +
            '.lrv-content__list{width:100%;max-width:46em;padding-bottom:5em}' +
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
            '.lrv-item__eq{display:none;align-items:flex-end;height:1.2em;gap:.12em}' +
            '.lrv-item__eq i{display:block;width:.2em;background:#4caf50;border-radius:2px;height:.3em;transform-origin:bottom;animation:lrvRowEq .9s ease-in-out infinite}' +
            '.lrv-item__eq i:nth-child(2){animation-delay:.18s}' +
            '.lrv-item__eq i:nth-child(3){animation-delay:.42s}' +
            '.lrv-item__eq i:nth-child(4){animation-delay:.28s}' +
            '@keyframes lrvRowEq{0%,100%{height:.25em}30%{height:1.2em}55%{height:.55em}80%{height:1em}}' +
            '.lrv-item__pause{opacity:0;display:none}.lrv-item__pause svg{width:1.3em;height:1.3em;color:#4caf50}' +
            '.lrv-item__spin{display:none;width:1.1em;height:1.1em;border:.15em solid rgba(255,255,255,.2);border-top-color:#4caf50;border-radius:50%;animation:lrvSpin .8s linear infinite}' +
            // playing row: live equalizer, hide heart; loading: spinner; paused: pause glyph
            '.lrv-item.playing .lrv-item__fav{display:none}' +
            '.lrv-item.playing .lrv-item__eq{display:flex}' +
            '.lrv-item.playing.loading .lrv-item__eq{display:none}' +
            '.lrv-item.playing.loading .lrv-item__spin{display:block}' +
            '.lrv-item.playing.paused .lrv-item__eq{display:none}' +
            '.lrv-item.playing.paused .lrv-item__pause{display:flex;opacity:.9}' +
            // playing row highlight: subtle tint + green left accent stripe
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
            // skeletons
            '.lrv-skeleton{pointer-events:none}' +
            '.lrv-sk{background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.12) 37%,rgba(255,255,255,.05) 63%);background-size:400% 100%;animation:lrvShimmer 1.4s ease infinite;border-radius:.4em}' +
            '.lrv-item__cover-box.lrv-sk{padding-bottom:0;height:100%}.lrv-skeleton .lrv-item__cover{height:3.2em}' +
            '.lrv-sk--line{height:.95em;margin:.2em 0}.lrv-sk--sub{height:.7em;opacity:.7}' +
            '@keyframes lrvShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}' +
            '@keyframes lrvSpin{to{transform:rotate(360deg)}}' +
            // ambient screensaver — opaque themed background
            '.lrv-saver{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--main-color-bg,#15151a);opacity:0;visibility:hidden;transition:opacity 1s ease,visibility 1s;pointer-events:none}' +
            '.lrv-saver__canvas{display:none}' +
            '.lrv-saver__stage,.lrv-saver__title,.lrv-saver__sub,.lrv-saver__hint{position:relative;z-index:2}' +
            // glowing neon ring removed — back to subwoofer glow

            '.lrv-saver.show{opacity:1;visibility:visible}' +
            '.lrv-saver__stage{display:flex;align-items:center;justify-content:center;width:100%;max-width:100%}' +
            // center artwork with subtle bass pulse
            '.lrv-saver__center{display:flex;flex-direction:column;align-items:center;flex-shrink:0;z-index:2;margin:0 1em}' +
            // an oversized well gives the bass pulse room without clipping
            '.lrv-saver__well{position:relative;width:20em;height:20em;display:flex;align-items:center;justify-content:center}' +
            // soft radial glow behind the cover — driven by bass like a subwoofer
            '.lrv-saver__glow{position:absolute;left:50%;top:50%;width:12.5em;height:12.5em;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.6) 0%,rgba(255,255,255,.24) 32%,rgba(255,255,255,.07) 55%,rgba(255,255,255,0) 72%);opacity:0;will-change:transform,opacity;pointer-events:none;filter:blur(.6em)}' +
            '.lrv-saver__art{position:relative;width:13em;height:13em;border-radius:1.4em;overflow:hidden;background:rgba(255,255,255,.05);box-shadow:0 1.2em 3em rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.14);will-change:transform;z-index:1}' +
            '.lrv-saver__art--breath{animation:lrvBreath 2.4s ease-in-out infinite}' +
            '@keyframes lrvBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}' +
            '.lrv-saver__img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .6s}' +
            '.lrv-saver__art.loaded .lrv-saver__img{opacity:1}' +
            '.lrv-saver__ph{position:absolute;left:32%;top:32%;width:36%;height:36%;opacity:.25;display:flex}.lrv-saver__ph svg{width:100%;height:100%}' +
            '.lrv-saver__art.loaded .lrv-saver__ph{display:none}' +
            '.lrv-saver__art[data-letter]:after{content:attr(data-letter);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:6em;color:#fff;background:var(--lrv-avatar,#333)}' +
            // subtle pulse handled by JS bass analyser; CSS breath is fallback
            // side neighbors (prev/next): 3 each, graduated size + fade,
            // farthest one (n3) partly clipped for a modern peek effect
            '.lrv-saver__side{display:flex;align-items:center;width:18em;overflow:hidden}' +
            '.lrv-saver__side--prev{justify-content:flex-end;flex-direction:row}' +
            '.lrv-saver__side--next{justify-content:flex-start;flex-direction:row}' +
            '.lrv-saver__neighbor{display:flex;flex-direction:column;align-items:center;flex-shrink:0;transition:opacity .3s}' +
            '.lrv-saver__n1{margin:0 .7em}.lrv-saver__n2{margin:0 .4em}.lrv-saver__n3{margin:0 .2em}' +
            '.lrv-saver__n1 .lrv-saver__nart{width:6.5em;height:6.5em}.lrv-saver__n1{opacity:.55}' +
            '.lrv-saver__n2 .lrv-saver__nart{width:5em;height:5em}.lrv-saver__n2{opacity:.32}' +
            '.lrv-saver__n3 .lrv-saver__nart{width:4em;height:4em}.lrv-saver__n3{opacity:.16}' +
            '.lrv-saver__nart{position:relative;border-radius:.9em;overflow:hidden;background:rgba(255,255,255,.05)}' +
            '.lrv-saver__nart img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .4s}' +
            '.lrv-saver__nart.loaded img{opacity:1}' +
            '.lrv-saver__nph{position:absolute;left:32%;top:32%;width:36%;height:36%;opacity:.3;display:flex}.lrv-saver__nph svg{width:100%;height:100%}' +
            '.lrv-saver__nart.loaded .lrv-saver__nph{display:none}' +
            '.lrv-saver__nart[data-letter]:after{content:attr(data-letter);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.8em;color:#fff;background:var(--lrv-avatar,#333)}' +
            '.lrv-saver__nname{margin-top:.35em;font-size:.85em;opacity:.8;text-align:center;max-width:8em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-saver__arrow{font-size:2.2em;line-height:1;margin:0 .3em;flex-shrink:0;color:#fff;opacity:.55}' +
            // graceful edge fade so n3 melts into the background
            '.lrv-saver__side--prev{-webkit-mask:linear-gradient(90deg,transparent 0,rgba(0,0,0,.4) 20%,#000 60%);mask:linear-gradient(90deg,transparent 0,rgba(0,0,0,.4) 20%,#000 60%)}' +
            '.lrv-saver__side--next{-webkit-mask:linear-gradient(270deg,transparent 0,rgba(0,0,0,.4) 20%,#000 60%);mask:linear-gradient(270deg,transparent 0,rgba(0,0,0,.4) 20%,#000 60%)}' +
            // slide feedback when switching
            '.lrv-saver--slidenext .lrv-saver__center{animation:lrvSlideN .18s ease}' +
            '.lrv-saver--slideprev .lrv-saver__center{animation:lrvSlideP .18s ease}' +
            '@keyframes lrvSlideN{0%{transform:translateX(0);opacity:1}50%{transform:translateX(-1.5em);opacity:.4}100%{transform:translateX(0);opacity:1}}' +
            '@keyframes lrvSlideP{0%{transform:translateX(0);opacity:1}50%{transform:translateX(1.5em);opacity:.4}100%{transform:translateX(0);opacity:1}}' +
            '.lrv-saver__title{margin-top:.2em;font-size:2.2em;font-weight:700;text-align:center;padding:0 1em;color:#fff}' +
            '.lrv-saver__sub{margin-top:.4em;font-size:1.2em;opacity:.5;text-align:center;padding:0 1.5em}' +
            '.lrv-saver__hint{position:absolute;bottom:2.5em;font-size:1em;opacity:.3;letter-spacing:.05em}' +
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
