(function () {
    'use strict';

    var PLUGIN_ID = 'lampa_radio_lv';

    var RECORD_API = 'https://www.radiorecord.ru/api/stations/';
    var RECORD_NOW = 'https://www.radiorecord.ru/api/station/now/?id=';
    var API_LV     = 'https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/LV?hidebroken=true&order=votes&limit=80';

    var FAV_KEY    = 'lrv_favorites';
    var RECENT_KEY = 'lrv_recent';
    var LAST_KEY   = 'lrv_last';
    var RECENT_MAX = 12;

    // ── Storage helpers ──────────────────────────
    var Store = {
        list: function(key) { return Lampa.Storage.get(key, '[]'); },
        save: function(key, v) { Lampa.Storage.set(key, v); }
    };

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

    function stripState(st) {
        return { title: st.title, tooltip: st.tooltip, stream: st.stream, icon: st.icon, group: st.group, uid: st.uid, record_id: st.record_id };
    }
    function stationUid(st) { return Lampa.Utils.hash(st.stream || st.title || ''); }
    function cleanTitle(name) { return (name || '').replace(/\s+/g, ' ').trim(); }

    // ── Player ───────────────────────────────────
    function Player(station, waveBox, onMeta) {
        var audio = new Audio();
        var url   = station.stream || '';
        var hls;
        var metaTimer;

        audio.addEventListener('playing', function(){ changeWave('play'); });
        audio.addEventListener('waiting', function(){ changeWave('loading'); });

        function createWave() {
            waveBox.empty();
            for (var i = 0; i < 18; i++) waveBox.append(document.createElement('div'));
            changeWave('loading');
        }
        function changeWave(cls) {
            var lines = waveBox[0].querySelectorAll('div');
            for (var i = 0; i < lines.length; i++) {
                lines[i].className = cls;
                lines[i].style.animationDuration = (cls === 'loading' ? 500 : 180 + Math.random() * 260) + 'ms';
                lines[i].style.animationDelay    = (cls === 'loading' ? Math.round(500 / lines.length * i) : 0) + 'ms';
            }
        }
        function load() { audio.src = url; audio.load(); start(); }
        function start() {
            var p;
            try { p = audio.play(); } catch(e) {}
            if (p) p.then(function(){ changeWave('play'); }).catch(function(e){ console.log('Radio play error:', e.message); });
        }
        function stop() { if (hls) { hls.destroy(); hls = null; } audio.pause(); audio.src = ''; clearInterval(metaTimer); }
        function prepare() {
            if (audio.canPlayType('application/vnd.apple.mpegurl') || (url && url.indexOf('.aacp') >= 0) || station.group === 'record') load();
            else if (typeof Hls !== 'undefined' && Hls.isSupported() && url && url.indexOf('.m3u8') >= 0) {
                try {
                    hls = new Hls();
                    hls.attachMedia(audio);
                    hls.loadSource(url);
                    hls.on(Hls.Events.MANIFEST_LOADED, start);
                    hls.on(Hls.Events.ERROR, function(e, d){ if (d.fatal) Lampa.Noty.show('Ошибка потока'); });
                } catch(e) { load(); }
            } else load();
        }

        // Now-playing metadata (Record only — has a public API)
        function pollMeta() {
            if (station.group !== 'record' || !station.record_id || !onMeta) return;
            var net = new Lampa.Reguest();
            var tick = function() {
                net['native'](RECORD_NOW + station.record_id, function(data) {
                    var track = '';
                    if (data && data.result) {
                        if (data.result.track && data.result.track.song) {
                            track = (data.result.track.artist ? data.result.track.artist + ' — ' : '') + data.result.track.song;
                        } else if (data.result.song) track = data.result.song;
                    }
                    onMeta(track);
                }, function(){});
            };
            tick();
            metaTimer = setInterval(tick, 15000);
        }

        this.toggle = function() {
            if (audio.paused) { prepare(); return true; }
            audio.pause(); return false;
        };
        this.create = function() { createWave(); prepare(); pollMeta(); };
        this.destroy = function() { stop(); };
    }

    // ── Component ────────────────────────────────
    function Component() {
        var _this   = this;
        var network = new Lampa.Reguest();
        var scroll, last, played, player;
        var html    = $('<div></div>');
        var filtred = [];
        var record  = [];
        var latvian = [];
        var genres  = {};         // record genres -> [stations]
        var mode    = 'all';
        var page    = 0;
        var loaded  = false;
        var query   = '';

        // ── Loading ──────────────────────────────
        this.create = function() {
            this.activity.loader(false); // we render skeletons ourselves
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
                    record = data.result.stations.map(function(s) {
                        var st = {
                            title:     cleanTitle(s.title),
                            tooltip:   s.tooltip || '',
                            stream:    s.stream_320 || s.stream_128 || s.stream || '',
                            icon:      s.icon_fill || s.new_icon || s.icon_gray || '',
                            group:     'record',
                            record_id: s.id,
                            genres:    (function() {
                                var g = s.genre || s.genres || [];
                                if (!Array.isArray(g)) g = [g];
                                return g.map(function(x){ return (x && (x.name || x.title)) || x; })
                                        .filter(function(x){ return typeof x === 'string' && x.length; });
                            })()
                        };
                        st.uid = stationUid(st);
                        return st;
                    });
                    // build genre map
                    record.forEach(function(st) {
                        (st.genres && st.genres.length ? st.genres : ['Разное']).forEach(function(g) {
                            (genres[g] = genres[g] || []).push(st);
                        });
                    });
                }
                done();
            }, function(){ done(); });

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
                }
                done();
            }, function(){ done(); });

            return this.render();
        };

        this.onData = function() {
            loaded = true;
            this.buildTabs();
            mode = Favorites.get().length ? 'fav' : (Recent.get().length ? 'recent' : 'all');
            this.applyFilter();
            this.activity.toggle();
            Lampa.Layer.update(html);

            // resume last station silently into the cover (not autoplay)
            var lastSt = Lampa.Storage.get(LAST_KEY, null);
            if (lastSt && lastSt.uid) this.setCover(lastSt);
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

        // ── Tabs with count badges ───────────────
        this.tabDefs = function() {
            var defs = [];
            if (Favorites.get().length) defs.push({ id: 'fav', name: 'Избранное', count: Favorites.get().length });
            if (Recent.get().length)    defs.push({ id: 'recent', name: 'Недавние', count: Recent.get().length });
            defs.push({ id: 'all',     name: 'Все',     count: record.length + latvian.length });
            defs.push({ id: 'record',  name: 'Record',  count: record.length });
            defs.push({ id: 'latvian', name: 'Латвия',  count: latvian.length });
            // genres as extra tabs
            Object.keys(genres).sort().forEach(function(g) {
                defs.push({ id: 'genre:' + g, name: g, count: genres[g].length, genre: true });
            });
            return defs;
        };

        this.buildTabs = function() {
            var head = html.find('.lrv-content__head');
            head.empty();

            // search button first
            var search = $('<div class="simple-button simple-button--filter selector lrv-tab lrv-tab--search"><svg viewBox="0 0 24 24" width="1em" height="1em"><path fill="currentColor" d="M21 20l-5.6-5.6a7 7 0 1 0-1.4 1.4L20 21zM5 10a5 5 0 1 1 10 0 5 5 0 0 1-10 0z"/></svg></div>');
            search.on('hover:enter', function(){ _this.openSearch(); });
            head.append(search);

            this.tabDefs().forEach(function(d) {
                var badge = d.count != null ? '<span class="lrv-tab__badge">' + d.count + '</span>' : '';
                var btn = $('<div class="simple-button simple-button--filter selector lrv-tab' + (d.genre ? ' lrv-tab--genre' : '') + '" data-tab="' + d.id + '">' + d.name + badge + '</div>');
                btn.on('hover:enter', function() {
                    mode = d.id; query = '';
                    _this.applyFilter();
                    Lampa.Controller.toggle('content');
                });
                head.append(btn);
            });
        };

        // ── Filtering ────────────────────────────
        this.sourceFor = function(m) {
            if (m === 'fav')     return Favorites.get();
            if (m === 'recent')  return Recent.get();
            if (m === 'record')  return record;
            if (m === 'latvian') return latvian;
            if (m.indexOf('genre:') === 0) return genres[m.slice(6)] || [];
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
            if (filtred.length) this.next();
            else {
                var hint = query ? 'По запросу «' + query + '» ничего не найдено.'
                    : (mode === 'fav' ? 'Избранное пусто. Удерживайте OK на станции, чтобы добавить.' : 'Ничего не найдено.');
                scroll.append($('<div class="lrv-empty">' + hint + '</div>'));
                _this.setCover(null);
            }
            Lampa.Layer.visible(scroll.render(true));
        };

        this.next = function() {
            var views = 30;
            var start = page * views;
            var slice = filtred.slice(start, start + views);
            slice.forEach(function(s){ _this.append(s); });
            if (slice.length) page++;
            // keep playing/last station highlighted after re-render
            if (played) html.find('.lrv-item[data-uid="' + played.uid + '"]').addClass('playing');
            Lampa.Layer.visible(scroll.render(true));
        };

        // ── Right-side cover ─────────────────────
        this.setCover = function(station) {
            var box   = html.find('.lrv-cover');
            var img   = box.find('.lrv-cover__img')[0];
            var imgBx = box.find('.lrv-cover__img-box');
            box.find('.lrv-cover__title').text(station ? station.title : '');
            box.find('.lrv-cover__tooltip').text(station ? (station.tooltip || '') : '');
            box.find('.lrv-cover__now').text('').removeClass('show');
            imgBx.removeClass('loaded loaded-icon');
            if (station && station.icon) {
                img.onload  = function(){ imgBx.addClass('loaded'); };
                img.onerror = function(){ imgBx.addClass('loaded-icon'); };
                img.src = station.icon;
            } else { imgBx.addClass('loaded-icon'); img.removeAttribute('src'); }
        };

        this.showNow = function(track) {
            var now = html.find('.lrv-cover__now');
            if (track) now.text(track).addClass('show');
            else now.text('').removeClass('show');
        };

        // ── Playback ─────────────────────────────
        this.play = function(station) {
            played = station;
            Recent.push(station);
            Lampa.Storage.set(LAST_KEY, stripState(station));
            if (player) player.destroy();
            player = new Player(station, html.find('.lrv-player__wave'), function(track){ _this.showNow(track); });
            player.create();
            html.find('.lrv-cover').addClass('playing');
            this.setCover(station);
            html.find('.lrv-item').removeClass('playing');
            html.find('.lrv-item[data-uid="' + station.uid + '"]').addClass('playing');
            // refresh tabs so the Недавние badge appears/updates after first play
            var hadRecent = html.find('.lrv-tab[data-tab="recent"]').length > 0;
            if (!hadRecent) this.buildTabs();
        };

        this.append = function(station) {
            var item   = Lampa.Template.get('lrv_item', {});
            item.attr('data-uid', station.uid);
            var imgBox = item.find('.lrv-item__cover-box');
            var img    = item.find('img')[0];
            item.find('.lrv-item__title').text(station.title);
            item.find('.lrv-item__tooltip').text(station.tooltip || '');

            img.onload  = function(){ imgBox.addClass('loaded'); };
            img.onerror = function(){ imgBox.addClass('loaded-icon'); };
            if (station.icon) img.src = station.icon;
            else imgBox.addClass('loaded-icon');

            item.toggleClass('favorite', Boolean(Favorites.find(station)));
            if (played && played.uid === station.uid) item.addClass('playing');

            item.on('hover:focus', function() {
                last = item[0];
                scroll.update(item);
                if (!player || !played || played.uid !== station.uid) _this.setCover(station);
            });
            item.on('hover:enter', function() {
                if (player && played && played.uid === station.uid) {
                    var pl = player.toggle();
                    item.toggleClass('playing', pl);
                    html.find('.lrv-cover').toggleClass('playing', pl);
                } else _this.play(station);
            });
            item.on('hover:long', function(){ _this.stationMenu(station, item); });

            if (!last) { last = item[0]; if (!player) _this.setCover(station); }
            if (Lampa.Controller.own(_this)) Lampa.Controller.collectionAppend(item);
            scroll.append(item);
        };

        // ── Context menu ─────────────────────────
        this.stationMenu = function(station, item) {
            var isFav = Boolean(Favorites.find(station));
            var items = [{ title: isFav ? '💔 Убрать из избранного' : '❤ В избранное', action: 'fav' }];
            if (mode === 'fav') {
                items.push({ title: '⬆ Переместить вверх', action: 'up' });
                items.push({ title: '⬇ Переместить вниз',  action: 'down' });
            }
            if (player && played && played.uid === station.uid) {
                items.push({ title: '⏹ Остановить', action: 'stop' });
            }
            Lampa.Select.show({
                title: station.title,
                items: items,
                onSelect: function(a) {
                    if (a.action === 'fav') {
                        var nowFav = Favorites.toggle(station);
                        Lampa.Noty.show(nowFav ? 'Добавлено в избранное' : 'Убрано из избранного');
                        _this.buildTabs();
                        if (mode === 'fav') _this.applyFilter();
                        else item.toggleClass('favorite', nowFav);
                    } else if (a.action === 'up' || a.action === 'down') {
                        if (Favorites.move(station, a.action === 'up' ? -1 : 1)) {
                            _this.applyFilter();
                            setTimeout(function() {
                                var el = html.find('.lrv-item[data-uid="' + station.uid + '"]')[0];
                                if (el) { last = el; Lampa.Controller.collectionFocus(el, html); scroll.update($(el)); }
                            }, 50);
                        }
                    } else if (a.action === 'stop') {
                        if (player) { player.destroy(); player = null; }
                        played = null;
                        html.find('.lrv-item').removeClass('playing');
                        html.find('.lrv-cover').removeClass('playing');
                        _this.showNow('');
                    }
                    Lampa.Controller.toggle('content');
                },
                onBack: function(){ Lampa.Controller.toggle('content'); }
            });
        };

        // ── Search ───────────────────────────────
        this.openSearch = function() {
            Lampa.Input.edit({
                free: true,
                nosave: true,
                value: query,
                title: 'Поиск станции',
                onChange: function(text) {
                    query = (text || '').trim();
                    if (mode.indexOf('genre:') === 0 || mode === 'fav' || mode === 'recent') mode = 'all';
                    _this.applyFilter();
                },
                onBack: function() { Lampa.Controller.toggle('content'); }
            }, function(text) {
                query = (text || '').trim();
                _this.applyFilter();
                Lampa.Controller.toggle('content');
            });
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
                    Lampa.Controller.collectionFocus(last, html);
                },
                left:  function(){ if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function(){ if (Navigator.canmove('right')) Navigator.move('right'); },
                up:    function(){ if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down:  function(){ if (Navigator.canmove('down')) Navigator.move('down'); },
                // long-up: jump to first station
                back:  function() {
                    if (player) { player.destroy(); player = null; html.find('.lrv-cover').removeClass('playing'); }
                    Lampa.Activity.backward();
                }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function(){};
        this.stop    = function(){};
        this.render  = function(){ return html; };
        this.destroy = function() {
            network.clear();
            if (player) player.destroy();
            if (scroll) scroll.destroy();
            html.remove();
        };
    }

    // ── Boot ─────────────────────────────────────
    function startPlugin() {
        window[PLUGIN_ID] = true;
        Lampa.Lang.add({ lrv_title: { ru: 'Радио', en: 'Radio', uk: 'Радіо' } });

        var manifest = { type: 'audio', version: '1.3.0', name: Lampa.Lang.translate('lrv_title'), description: 'Radio: Record + Latvia', component: 'lrv' };
        Lampa.Manifest.plugins = manifest;

        var ICON =
            '<svg viewBox="0 0 38 31" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="17.6" width="3" height="16.3" rx="1.5" transform="rotate(63.5 17.6 0)" fill="currentColor"/>' +
            '<circle cx="13" cy="19" r="6" fill="currentColor"/>' +
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M0 11a4 4 0 0 1 4-4h30a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4zm21 8a8 8 0 1 1-16 0 8 8 0 0 1 16 0m9.5-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" fill="currentColor"/></svg>';

        Lampa.Template.add('lrv_content',
            '<div class="lrv-content">' +
                '<div class="lrv-content__head"></div>' +
                '<div class="lrv-content__body">' +
                    '<div class="lrv-content__list"></div>' +
                    '<div class="lrv-content__side"><div class="lrv-cover">' +
                        '<div class="lrv-cover__img-box"><img class="lrv-cover__img" /><div class="lrv-cover__placeholder">' + ICON + '</div></div>' +
                        '<div class="lrv-cover__title"></div>' +
                        '<div class="lrv-cover__tooltip"></div>' +
                        '<div class="lrv-cover__now"></div>' +
                        '<div class="lrv-player__wave"></div>' +
                    '</div></div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_item',
            '<div class="lrv-item selector layer--visible">' +
                '<div class="lrv-item__cover"><div class="lrv-item__cover-box"><img /><div class="lrv-item__placeholder">' + ICON + '</div></div></div>' +
                '<div class="lrv-item__body"><div class="lrv-item__title"></div><div class="lrv-item__tooltip"></div></div>' +
                '<div class="lrv-item__state">' +
                    '<div class="lrv-item__fav"><svg viewBox="0 0 477 477" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M438 58c-24-26-59-41-95-41-36 0-70 15-95 41l-9 9-8-9C181 5 98 2 45 51c-2 2-4 4-6 6-52 56-52 143 0 199l187 198c6 6 17 7 24 0l187-198c52-56 52-143 0-199zm-24 176L238 418 63 234c-39-43-39-109 0-152 36-39 97-41 136-5 1 1 3 3 5 5l20 21c6 6 17 6 24 0l20-21c36-39 97-41 136-5 1 1 3 3 5 5 39 42 39 108 0 151z"/></svg></div>' +
                    '<div class="lrv-item__eq"><i></i><i></i><i></i></div>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_style',
            '<style>' +
            '.lrv-content{padding:0 1.5em}' +
            '.lrv-content__head{display:flex;padding:1.2em 0;flex-wrap:wrap;align-items:center}' +
            '.lrv-tab{margin-right:.7em;margin-bottom:.5em;display:inline-flex;align-items:center}' +
            '.lrv-tab--search{padding-left:.9em;padding-right:.9em}' +
            '.lrv-tab--genre{font-size:.92em;opacity:.92}' +
            '.lrv-tab.active{background:rgba(255,255,255,.2)}' +
            '.lrv-tab__badge{margin-left:.5em;font-size:.78em;opacity:.6;background:rgba(255,255,255,.14);border-radius:1em;padding:.05em .55em;min-width:1.4em;text-align:center}' +
            '.lrv-tab.focus .lrv-tab__badge{background:rgba(0,0,0,.12);opacity:.7}' +
            '.lrv-content__body{display:flex}' +
            '.lrv-content__list{width:58%}' +
            '.lrv-content__side{width:42%;padding:0 1em 0 3em}' +
            '@media screen and (max-width:700px){.lrv-content__list{width:100%}.lrv-content__side{display:none}}' +
            '.lrv-empty{padding:2em 1em;opacity:.55;font-size:1.15em;line-height:1.5}' +
            // item
            '.lrv-item{padding:.7em 1em;display:flex;align-items:center;line-height:1.35;border-radius:.8em;transition:background .15s}' +
            '.lrv-item__cover{width:3.2em;flex-shrink:0;margin-right:1.1em}' +
            '.lrv-item__cover-box{position:relative;padding-bottom:100%;background:rgba(255,255,255,.07);border-radius:.5em;overflow:hidden}' +
            '.lrv-item__cover-box img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:.5em;opacity:0;transition:opacity .25s}' +
            '.lrv-item__placeholder{position:absolute;left:28%;top:28%;width:44%;height:44%;opacity:.35;display:flex}' +
            '.lrv-item__placeholder svg{width:100%;height:100%}' +
            '.lrv-item__cover-box.loaded img{opacity:1}' +
            '.lrv-item__cover-box.loaded .lrv-item__placeholder{display:none}' +
            '.lrv-item__body{flex:1;min-width:0}' +
            '.lrv-item__title{font-weight:600;font-size:1.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-item__tooltip{opacity:.45;margin-top:.25em;font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-item__state{margin-left:.8em;flex-shrink:0;width:1.5em;display:flex;align-items:center;justify-content:center}' +
            '.lrv-item__fav{opacity:0;display:flex}.lrv-item__fav svg{width:1.2em;height:1.2em}' +
            '.lrv-item.favorite .lrv-item__fav{opacity:.85}' +
            '.lrv-item__eq{display:none;align-items:flex-end;height:1.1em}' +
            '.lrv-item__eq i{display:block;width:.18em;margin:0 .07em;background:currentColor;height:.4em;animation:lrvEqRow .6s ease infinite}' +
            '.lrv-item__eq i:nth-child(2){animation-delay:.2s}.lrv-item__eq i:nth-child(3){animation-delay:.4s}' +
            '.lrv-item.playing .lrv-item__fav{display:none}.lrv-item.playing .lrv-item__eq{display:flex}' +
            '@keyframes lrvEqRow{0%,100%{height:.3em}50%{height:1.1em}}' +
            '.lrv-item.focus{background:#fff;color:#000}' +
            '.lrv-item.focus .lrv-item__cover-box{background:rgba(0,0,0,.08)}' +
            // skeletons
            '.lrv-skeleton{pointer-events:none}' +
            '.lrv-sk{background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.12) 37%,rgba(255,255,255,.05) 63%);background-size:400% 100%;animation:lrvShimmer 1.4s ease infinite;border-radius:.4em}' +
            '.lrv-item__cover-box.lrv-sk{padding-bottom:0;height:100%}' +
            '.lrv-skeleton .lrv-item__cover{height:3.2em}' +
            '.lrv-sk--line{height:.95em;margin:.2em 0}.lrv-sk--sub{height:.7em;opacity:.7}' +
            '@keyframes lrvShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}' +
            // cover
            '.lrv-cover{text-align:center;position:sticky;top:5em}' +
            '.lrv-cover__img-box{position:relative;max-width:16em;margin:0 auto;padding-bottom:min(100%,16em);background:rgba(255,255,255,.06);border-radius:1.2em;overflow:hidden;box-shadow:0 1.2em 2.5em rgba(0,0,0,.35)}' +
            '.lrv-cover__img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:1.2em;opacity:0;transition:opacity .3s}' +
            '.lrv-cover__placeholder{position:absolute;left:30%;top:30%;width:40%;height:40%;opacity:.3;display:flex}.lrv-cover__placeholder svg{width:100%;height:100%}' +
            '.lrv-cover__img-box.loaded .lrv-cover__img{opacity:1}.lrv-cover__img-box.loaded .lrv-cover__placeholder{display:none}' +
            '.lrv-cover__title{font-weight:700;font-size:1.5em;margin-top:1.2em}' +
            '.lrv-cover__tooltip{opacity:.5;font-size:1.1em;margin-top:.4em;line-height:1.4;padding:0 1em}' +
            '.lrv-cover__now{opacity:0;font-size:1.05em;margin-top:.8em;padding:.5em 1em;color:#fff;background:rgba(255,255,255,.08);border-radius:.6em;display:inline-block;max-width:90%;transition:opacity .3s;line-height:1.4}' +
            '.lrv-cover__now.show{opacity:1}' +
            '.lrv-cover__now:before{content:"♪ ";opacity:.6}' +
            '.lrv-player__wave{display:none;align-items:flex-end;justify-content:center;height:2.2em;margin-top:1.3em}' +
            '.lrv-cover.playing .lrv-player__wave{display:flex}' +
            '.lrv-player__wave>div{width:3px;background:currentColor;margin:0 .18em;height:.4em;opacity:.85;border-radius:2px}' +
            '.lrv-player__wave>div.loading{animation:lrvWaveLoad 500ms ease infinite}' +
            '.lrv-player__wave>div.play{animation:lrvWavePlay 60ms linear infinite alternate}' +
            '@keyframes lrvWaveLoad{0%{height:.3em}50%{height:1.6em}100%{height:.3em}}' +
            '@keyframes lrvWavePlay{0%{height:.3em}100%{height:2em}}' +
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
