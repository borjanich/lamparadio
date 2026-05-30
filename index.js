(function () {
    'use strict';

    var PLUGIN_ID = 'lampa_radio_lv';

    var RECORD_API = 'https://www.radiorecord.ru/api/stations/';
    var API_LV     = 'https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/LV?hidebroken=true&order=votes&limit=60';

    // ── Favorites store ──────────────────────────
    var Favorites = {
        get: function() {
            var all = Lampa.Storage.get('lrv_favorites', '[]');
            all.sort(function(a, b) { return (b.added || 0) - (a.added || 0); });
            return all;
        },
        find: function(st) {
            return this.get().find(function(a) { return a.uid === st.uid; });
        },
        add: function(st) {
            var list = this.get();
            if (!this.find(st)) {
                st.added = Date.now();
                list.push(st);
                Lampa.Storage.set('lrv_favorites', list);
            }
        },
        remove: function(st) {
            var list = this.get().filter(function(a) { return a.uid !== st.uid; });
            Lampa.Storage.set('lrv_favorites', list);
        },
        toggle: function(st) {
            if (this.find(st)) this.remove(st); else this.add(st);
            return Boolean(this.find(st));
        }
    };

    // Stable id for a station (so favorites survive reloads)
    function stationUid(st) {
        return Lampa.Utils.hash(st.stream || st.title || '');
    }

    // ── Player ───────────────────────────────────
    function Player(station) {
        var html  = Lampa.Template.get('lrv_player', {});
        var audio = new Audio();
        var url   = station.stream || station.stream_320 || station.stream_128 || '';
        var hls;

        if (!url && station.stream_hls) {
            url = station.stream_hls.replace('playlist.m3u8', '96/playlist.m3u8');
        }

        audio.addEventListener('playing', function () { changeWave('play'); });
        audio.addEventListener('waiting', function () { changeWave('loading'); });

        function createWave() {
            var box = html.find('.lrv-player__wave')[0];
            for (var i = 0; i < 15; i++) box.appendChild(document.createElement('div'));
            changeWave('loading');
        }

        function changeWave(cls) {
            var lines = html.find('.lrv-player__wave')[0].querySelectorAll('div');
            for (var i = 0; i < lines.length; i++) {
                lines[i].className = cls;
                lines[i].style.animationDuration = (cls === 'loading' ? 400 : 200 + Math.random() * 200) + 'ms';
                lines[i].style.animationDelay    = (cls === 'loading' ? Math.round(400 / lines.length * i) : 0) + 'ms';
            }
        }

        function load() { audio.src = url; audio.load(); start(); }

        function start() {
            var p;
            try { p = audio.play(); } catch(e) {}
            if (p) p.then(function(){ changeWave('play'); }).catch(function(e){ console.log('Radio play error:', e.message); });
        }

        function stop() {
            if (hls) { hls.destroy(); hls = null; }
            audio.src = '';
        }

        function prepare() {
            if (audio.canPlayType('application/vnd.apple.mpegurl') || url.indexOf('.aacp') >= 0 || station.stream) {
                load();
            } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                try {
                    hls = new Hls();
                    hls.attachMedia(audio);
                    hls.loadSource(url);
                    hls.on(Hls.Events.MANIFEST_LOADED, start);
                    hls.on(Hls.Events.ERROR, function(e, d) { if (d.fatal) Lampa.Noty.show('Ошибка потока'); });
                } catch(e) { load(); }
            } else {
                load();
            }
        }

        this.create = function() {
            var cover  = Lampa.Template.get('lrv_cover', {});
            cover.find('.lrv-cover__title').text(station.title || '');
            cover.find('.lrv-cover__tooltip').text(station.tooltip || '');
            var imgBox = cover.find('.lrv-cover__img-box');
            var img    = imgBox.find('img')[0];
            img.onload  = function() { imgBox.addClass('loaded'); };
            img.onerror = function() { imgBox.addClass('loaded-icon'); };
            if (station.icon) img.src = station.icon;
            else imgBox.addClass('loaded-icon');
            html.find('.lrv-player__cover').append(cover);
            html.find('.lrv-player__close').on('click', function() { window.history.back(); });
            $('body').append(html);
            createWave();
            prepare();
        };

        this.destroy = function() { stop(); html.remove(); };
    }

    // ── Component ────────────────────────────────
    function Component() {
        var _this   = this;
        var network = new Lampa.Reguest();
        var scroll, last, played;
        var html    = $('<div></div>');
        var filtred = [];
        var page    = 0;
        var record  = [];
        var latvian = [];
        var mode    = 'all';

        this.create = function() {
            this.activity.loader(true);
            var pending = 2;
            var done = function() { if (--pending <= 0) _this.ready(); };

            // Radio Record
            network['native'](RECORD_API, function(data) {
                if (data && data.result && data.result.stations) {
                    record = data.result.stations.map(function(s) {
                        var st = {
                            title:   s.title,
                            tooltip: s.tooltip || '',
                            stream:  s.stream_320 || s.stream_128 || s.stream || '',
                            icon:    s.icon_fill || s.icon_gray || s.new_icon || '',
                            group:   'record'
                        };
                        st.uid = stationUid(st);
                        return st;
                    });
                }
                done();
            }, function() { done(); });

            // Latvian
            network['native'](API_LV, function(data) {
                if (Array.isArray(data)) {
                    latvian = data.filter(function(s){ return s.url_resolved || s.url; })
                        .map(function(s) {
                            var st = {
                                title:   s.name || 'Unknown',
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
            }, function() { done(); });

            return this.render();
        };

        this.ready = function() {
            this.activity.loader(false);
            html.append(Lampa.Template.get('lrv_content', {}));
            scroll = new Lampa.Scroll({ mask: true, over: true });
            scroll.onEnd = function() { page++; _this.next(); };
            html.find('.lrv-content__list').append(scroll.render(true));
            scroll.minus(html.find('.lrv-content__head'));

            this.buildButtons();

            // open favorites first if any exist, else all
            mode = Favorites.get().length ? 'fav' : 'all';
            this.applyFilter();
            this.activity.toggle();
            Lampa.Layer.update(html);
        };

        this.buildButtons = function() {
            var head = html.find('.lrv-content__head');
            var defs = [
                { id: 'fav',     name: 'Избранное' },
                { id: 'all',     name: 'Все' },
                { id: 'record',  name: 'Record' },
                { id: 'latvian', name: 'Латвия' }
            ];
            defs.forEach(function(d) {
                var btn = $('<div class="simple-button simple-button--filter selector lrv-tab" data-tab="' + d.id + '">' + d.name + '</div>');
                btn.on('hover:enter', function() {
                    mode = d.id;
                    head.find('.lrv-tab').removeClass('active');
                    btn.addClass('active');
                    _this.applyFilter();
                    Lampa.Controller.toggle('content');
                });
                head.append(btn);
            });
        };

        this.applyFilter = function() {
            if (mode === 'fav')          filtred = Favorites.get();
            else if (mode === 'record')  filtred = record;
            else if (mode === 'latvian') filtred = latvian;
            else                         filtred = record.concat(latvian);

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
            } else {
                var empty = $('<div class="lrv-empty">Список пуст. Добавьте станции в избранное удержанием OK.</div>');
                scroll.append(empty);
            }
            Lampa.Layer.visible(scroll.render(true));
        };

        this.next = function() {
            var views = 20;
            var start = page * views;
            filtred.slice(start, start + views).forEach(function(s){ _this.append(s); });
            Lampa.Layer.visible(scroll.render(true));
        };

        this.play = function(station) {
            played = station;
            var p = new Player(station);
            p.create();
            Lampa.Controller.add('content', {
                invisible: true,
                toggle: function() { Lampa.Controller.clear(); },
                back: function() { p.destroy(); _this.activity.toggle(); _this.start(); },
                up:   function() { var i = filtred.indexOf(played) - 1; if (i >= 0) { p.destroy(); _this.play(filtred[i]); } },
                down: function() { var i = filtred.indexOf(played) + 1; if (i < filtred.length) { p.destroy(); _this.play(filtred[i]); } }
            });
            Lampa.Controller.toggle('content');
        };

        this.append = function(station) {
            var item   = Lampa.Template.get('lrv_item', {});
            var imgBox = item.find('.lrv-item__cover-box');
            var img    = item.find('img')[0];
            item.find('.lrv-item__title').text(station.title);
            item.find('.lrv-item__tooltip').text(station.tooltip || station.stream || '');
            img.onload  = function() { imgBox.addClass('loaded'); };
            img.onerror = function() { imgBox.addClass('loaded-icon'); };
            if (station.icon) img.src = station.icon;
            else imgBox.addClass('loaded-icon');

            item.toggleClass('favorite', Boolean(Favorites.find(station)));

            item.on('hover:focus', function() {
                last = item[0];
                scroll.update(item);
            });
            item.on('hover:enter', function() { _this.play(station); });
            item.on('hover:long', function() {
                var isFav = Favorites.toggle(station);
                item.toggleClass('favorite', isFav);
                Lampa.Noty.show(isFav ? 'Добавлено в избранное' : 'Убрано из избранного');
            });

            if (!last) last = item[0];
            if (Lampa.Controller.own(_this)) Lampa.Controller.collectionAppend(item);
            scroll.append(item);
        };

        this.background = function() { Lampa.Background.immediately(''); };

        this.start = function() {
            if (Lampa.Activity.active() && Lampa.Activity.active().activity !== this.activity) return;
            this.background();
            Lampa.Controller.add('content', {
                link: this,
                toggle: function() {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(last, html);
                },
                left:  function() { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function() { Navigator.move('right'); },
                up:    function() { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down:  function() { Navigator.move('down'); },
                back:  function() { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function() {};
        this.stop    = function() {};
        this.render  = function() { return html; };
        this.destroy = function() {
            network.clear();
            if (scroll) scroll.destroy();
            html.remove();
        };
    }

    // ── Start ────────────────────────────────────
    function startPlugin() {
        window[PLUGIN_ID] = true;

        Lampa.Lang.add({ lrv_title: { ru: 'Радио LV', en: 'Radio LV', uk: 'Радіо LV' } });

        var manifest = {
            type: 'audio', version: '1.1.0',
            name: Lampa.Lang.translate('lrv_title'),
            description: 'Latvian radio + Radio Record',
            component: 'lrv'
        };
        Lampa.Manifest.plugins = manifest;

        Lampa.Template.add('lrv_content',
            '<div class="lrv-content">' +
                '<div class="lrv-content__head"></div>' +
                '<div class="lrv-content__list"></div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_cover',
            '<div class="lrv-cover">' +
                '<div class="lrv-cover__img-box"><img /></div>' +
                '<div class="lrv-cover__title"></div>' +
                '<div class="lrv-cover__tooltip"></div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_item',
            '<div class="lrv-item selector layer--visible">' +
                '<div class="lrv-item__cover"><div class="lrv-item__cover-box"><img /></div></div>' +
                '<div class="lrv-item__body">' +
                    '<div class="lrv-item__title"></div>' +
                    '<div class="lrv-item__tooltip"></div>' +
                '</div>' +
                '<div class="lrv-item__fav">' +
                    '<svg viewBox="0 0 477 477" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M438 58c-24-26-59-41-95-41-36 0-70 15-95 41l-9 9-8-9C181 5 98 2 45 51c-2 2-4 4-6 6-52 56-52 143 0 199l187 198c6 6 17 7 24 0l187-198c52-56 52-143 0-199zm-24 176L238 418 63 234c-39-43-39-109 0-152 36-39 97-41 136-5 1 1 3 3 5 5l20 21c6 6 17 6 24 0l20-21c36-39 97-41 136-5 1 1 3 3 5 5 39 42 39 108 0 151z"/></svg>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_player',
            '<div class="lrv-player">' +
                '<div class="lrv-player__cover"></div>' +
                '<div class="lrv-player__wave"></div>' +
                '<div class="lrv-player__close">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 329 329"><path d="M194 164 323 36c8-8 8-21 0-30-8-8-21-8-30 0L164 134 36 6c-8-8-21-8-30 0-8 8-8 21 0 30l128 128L6 292c-8 8-8 21 0 30a21 21 0 0 0 30 0l128-128 128 128a21 21 0 0 0 30 0c8-8 8-21 0-30z" fill="currentColor"/></svg>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_style',
            '<style>' +
            '.lrv-content{padding:0 1.5em}' +
            '.lrv-content__head{display:-webkit-box;display:flex;padding:1.2em 0;flex-wrap:wrap}' +
            '.lrv-tab{margin-right:1em;margin-bottom:.5em}' +
            '.lrv-tab.active{background:rgba(255,255,255,.15)}' +
            '.lrv-empty{padding:2em;opacity:.6;font-size:1.2em}' +
            '.lrv-item{padding:.8em 1em;display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;line-height:1.4;border-radius:.8em}' +
            '.lrv-item__cover{width:3.4em;flex-shrink:0;margin-right:1.2em}' +
            '.lrv-item__cover-box{position:relative;padding-bottom:100%;background:rgba(255,255,255,.08);border-radius:.5em;overflow:hidden}' +
            '.lrv-item__cover-box img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:.5em;opacity:0;transition:opacity .2s}' +
            '.lrv-item__cover-box.loaded{background:transparent}' +
            '.lrv-item__cover-box.loaded img{opacity:1}' +
            '.lrv-item__cover-box.loaded-icon{background:rgba(255,255,255,.08)}' +
            '.lrv-item__cover-box.loaded-icon:after{content:"";position:absolute;left:25%;top:25%;width:50%;height:50%;background:rgba(255,255,255,.3);-webkit-mask:url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 31"><rect x="17.6" width="3" height="16.3" rx="1.5" transform="rotate(63.5 17.6 0)"/><circle cx="13" cy="19" r="6"/><path fill-rule="evenodd" d="M0 11a4 4 0 0 1 4-4h30a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4zm21 8a8 8 0 1 1-16 0 8 8 0 0 1 16 0m9.5-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"/></svg>\') center/contain no-repeat;mask:url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 31"><rect x="17.6" width="3" height="16.3" rx="1.5" transform="rotate(63.5 17.6 0)"/><circle cx="13" cy="19" r="6"/><path fill-rule="evenodd" d="M0 11a4 4 0 0 1 4-4h30a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4zm21 8a8 8 0 1 1-16 0 8 8 0 0 1 16 0m9.5-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"/></svg>\') center/contain no-repeat}' +
            '.lrv-item__body{flex:1;min-width:0}' +
            '.lrv-item__title{font-weight:600;font-size:1.15em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-item__tooltip{opacity:.5;margin-top:.3em;font-size:.95em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.lrv-item__fav{margin-left:1em;flex-shrink:0;opacity:0}' +
            '.lrv-item__fav svg{width:1.3em;height:1.3em}' +
            '.lrv-item.favorite .lrv-item__fav{opacity:.9}' +
            '.lrv-item.focus{background:#fff;color:#000}' +
            '.lrv-player{position:fixed;z-index:100;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column}' +
            '.lrv-player__cover{width:18em}' +
            '.lrv-cover__img-box{position:relative;padding-bottom:100%;background:rgba(0,0,0,.3);border-radius:1em;overflow:hidden}' +
            '.lrv-cover__img-box img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:1em;opacity:0}' +
            '.lrv-cover__img-box.loaded img{opacity:1}' +
            '.lrv-cover__img-box.loaded{background:transparent}' +
            '.lrv-cover__img-box.loaded-icon{background:rgba(255,255,255,.08)}' +
            '.lrv-cover__title{font-weight:700;font-size:1.6em;margin-top:1em;text-align:center}' +
            '.lrv-cover__tooltip{opacity:.5;font-size:1.2em;margin-top:.3em;text-align:center}' +
            '.lrv-player__wave{display:flex;align-items:center;justify-content:center;margin-top:2em}' +
            '.lrv-player__wave>div{width:3px;background:#fff;margin:0 .25em;height:1em;opacity:0;border-radius:2px}' +
            '.lrv-player__wave>div.loading{animation:lrvWaveLoad 400ms ease infinite}' +
            '.lrv-player__wave>div.play{animation:lrvWavePlay 50ms linear infinite alternate}' +
            '.lrv-player__close{position:fixed;top:1.5em;right:50%;margin-right:-2em;border-radius:100%;padding:1em;display:none;background:rgba(255,255,255,.1)}' +
            '.lrv-player__close svg{width:1.5em;height:1.5em}' +
            'body.true--mobile .lrv-player__close{display:block}' +
            '@keyframes lrvWaveLoad{0%{transform:scaleY(.3);opacity:1}10%{transform:scaleY(1.5);opacity:1}20%{transform:scaleY(.3);opacity:1}100%{transform:scaleY(.3);opacity:1}}' +
            '@keyframes lrvWavePlay{0%{transform:scaleY(.3);opacity:.3}100%{transform:scaleY(2);opacity:1}}' +
            '</style>'
        );

        Lampa.Component.add('lrv', Component);

        function add() {
            var btn = $(
                '<li class="menu__item selector">' +
                    '<div class="menu__ico">' +
                        '<svg width="38" height="31" viewBox="0 0 38 31" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<rect x="17.613" width="3" height="16.3327" rx="1.5" transform="rotate(63.4707 17.613 0)" fill="currentColor"/>' +
                            '<circle cx="13" cy="19" r="6" fill="currentColor"/>' +
                            '<path fill-rule="evenodd" clip-rule="evenodd" d="M0 11C0 8.79086 1.79083 7 4 7H34C36.2091 7 38 8.79086 38 11V27C38 29.2091 36.2092 31 34 31H4C1.79083 31 0 29.2091 0 27V11ZM21 19C21 23.4183 17.4183 27 13 27C8.58173 27 5 23.4183 5 19C5 14.5817 8.58173 11 13 11C17.4183 11 21 14.5817 21 19ZM30.5 18C31.8807 18 33 16.8807 33 15.5C33 14.1193 31.8807 13 30.5 13C29.1193 13 28 14.1193 28 15.5C28 16.8807 29.1193 18 30.5 18Z" fill="currentColor"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="menu__text">' + manifest.name + '</div>' +
                '</li>'
            );
            btn.on('hover:enter', function() {
                Lampa.Activity.push({ url: '', title: manifest.name, component: 'lrv', page: 1 });
            });
            $('.menu .menu__list').eq(0).append(btn);
            $('body').append(Lampa.Template.get('lrv_style', {}, true));
        }

        if (window.appready) add();
        else Lampa.Listener.follow('app', function(e) { if (e.type === 'ready') add(); });
    }

    if (!window[PLUGIN_ID]) startPlugin();

})();
