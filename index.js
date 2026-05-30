(function () {
    'use strict';

    var PLUGIN_ID = 'lampa_radio_lv';

    var RECORD_STATIONS = [
        {
            title:   'Radio Record',
            tooltip: 'record',
            stream:  'https://radiorecord.hostingradio.ru/rr96.aacp',
            bg_image_mobile: 'https://www.radiorecord.ru/upload/iblock/b32/b3222ec60c4988da93f95e53ba6d2b37.png'
        },
        {
            title:   'Record Deep',
            tooltip: 'deep',
            stream:  'https://radiorecord.hostingradio.ru/deep96.aacp',
            bg_image_mobile: 'https://www.radiorecord.ru/upload/styles/7/image.jpg'
        },
        {
            title:   'Record Trap',
            tooltip: 'trap',
            stream:  'https://radiorecord.hostingradio.ru/trap96.aacp',
            bg_image_mobile: 'https://www.radiorecord.ru/upload/styles/17/image.jpg'
        }
    ];

    var API_LV = 'https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/LV?hidebroken=true&order=votes&limit=40';

    // ── Player ───────────────────────────────────
    function Player(station) {
        var html  = Lampa.Template.js('lrv_player');
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
            for (var i = 0; i < 15; i++) {
                var d = document.createElement('div');
                box.appendChild(d);
            }
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
            var cover = Lampa.Template.js('lrv_cover');
            cover.find('.lrv-cover__title').text(station.title || '');
            cover.find('.lrv-cover__tooltip').text(station.tooltip || '');
            var imgBox = cover.find('.lrv-cover__img-box');
            var img    = imgBox.find('img')[0];
            img.onload  = function() { imgBox.addClass('loaded'); };
            img.onerror = function() { img.src = './img/icons/menu/movie.svg'; imgBox.addClass('loaded-icon'); };
            img.src = station.bg_image_mobile || '';
            html.find('.lrv-player__cover').append(cover);
            html.find('.lrv-player__close').on('click', function() { window.history.back(); });
            document.body.appendChild(html[0]);
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
        var filtred = [];
        var page    = 0;
        var html    = document.createElement('div');
        var allStations = [];

        this.create = function() {
            this.activity.loader(true);
            // Start with Record stations, then load LV
            allStations = RECORD_STATIONS.slice();
            network['native'](API_LV, function(data) {
                if (Array.isArray(data)) {
                    data.filter(function(s){ return s.url_resolved || s.url; })
                        .forEach(function(s) {
                            allStations.push({
                                title:           s.name || 'Unknown',
                                tooltip:         s.tags || s.country || '',
                                stream:          s.url_resolved || s.url,
                                bg_image_mobile: s.favicon || ''
                            });
                        });
                }
                filtred = allStations.slice();
                _this.build();
            }, function() {
                filtred = allStations.slice();
                _this.build();
            });
            return this.render();
        };

        this.build = function() {
            this.activity.loader(false);
            var tmpl = Lampa.Template.js('lrv_content');
            html.appendChild(tmpl[0]);
            scroll = new Lampa.Scroll({ mask: true, over: true });
            scroll.onEnd = function() { page++; _this.next(); };
            $(html).find('.lrv-content__list').append(scroll.render(true));
            scroll.minus($(html).find('.lrv-content__head'));
            this.next();
            this.activity.toggle();
            Lampa.Layer.update($(html));
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
            Lampa.Background.change(station.bg_image_mobile || '');
            Lampa.Controller.add('content', {
                invisible: true,
                toggle: function() { Lampa.Controller.clear(); },
                back: function() {
                    p.destroy();
                    _this.activity.toggle();
                },
                up:   function() { var i = filtred.indexOf(played) - 1; if (i >= 0) { p.destroy(); _this.play(filtred[i]); } },
                down: function() { var i = filtred.indexOf(played) + 1; if (i < filtred.length) { p.destroy(); _this.play(filtred[i]); } }
            });
            Lampa.Controller.toggle('content');
        };

        this.append = function(station) {
            var item   = Lampa.Template.js('lrv_item');
            var imgBox = item.find('.lrv-item__cover-box');
            var img    = item.find('img')[0];
            item.find('.lrv-item__title').text(station.title);
            item.find('.lrv-item__tooltip').text(station.tooltip || station.stream || '');
            img.onload  = function() { imgBox.addClass('loaded'); };
            img.onerror = function() { img.src = './img/icons/menu/movie.svg'; imgBox.addClass('loaded-icon'); };
            img.src = station.bg_image_mobile || '';

            item.on('hover:focus', function() {
                last = item[0];
                scroll.update(item);
                Lampa.Background.change(station.bg_image_mobile || '');
            });
            item.on('hover:enter', function() { _this.play(station); });
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
                invisible: true,
                toggle: function() {
                    Lampa.Controller.collectionSet($(html));
                    Lampa.Controller.collectionFocus(last, $(html));
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
        this.render  = function() { return $(html); };
        this.destroy = function() {
            network.clear();
            if (scroll) scroll.destroy();
            $(html).remove();
        };
    }

    // ── Start ────────────────────────────────────
    function startPlugin() {
        window[PLUGIN_ID] = true;

        Lampa.Lang.add({
            lrv_title: { ru: 'Радио LV', en: 'Radio LV', uk: 'Радіо LV' }
        });

        var manifest = {
            type:        'audio',
            version:     '1.0.0',
            name:        Lampa.Lang.translate('lrv_title'),
            description: 'Latvian radio + Radio Record',
            component:   'lrv'
        };
        Lampa.Manifest.plugins = manifest;

        // Templates
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
            '</div>'
        );

        Lampa.Template.add('lrv_player',
            '<div class="lrv-player">' +
                '<div class="lrv-player__cover"></div>' +
                '<div class="lrv-player__wave"></div>' +
                '<div class="lrv-player__close">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 329.269 329">' +
                        '<path d="M194.8 164.77 323.013 36.555c8.343-8.34 8.343-21.825 0-30.164-8.34-8.34-21.825-8.34-30.164 0L164.633 134.605 36.422 6.391c-8.344-8.34-21.824-8.34-30.164 0-8.344 8.34-8.344 21.824 0 30.164l128.21 128.215L6.259 292.984c-8.344 8.34-8.344 21.825 0 30.164a21.266 21.266 0 0 0 15.082 6.25c5.46 0 10.922-2.09 15.082-6.25l128.21-128.214 128.216 128.214a21.273 21.273 0 0 0 15.082 6.25c5.46 0 10.922-2.09 15.082-6.25 8.343-8.34 8.343-21.824 0-30.164zm0 0" fill="currentColor"/>' +
                    '</svg>' +
                '</div>' +
            '</div>'
        );

        Lampa.Template.add('lrv_style',
            '<style>' +
            '.lrv-content{padding:0 1.5em}' +
            '.lrv-content__head{padding:1em 0}' +
            '.lrv-item{padding:1em;display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;line-height:1.4}' +
            '.lrv-item__cover{width:4em;flex-shrink:0;margin-right:1.5em}' +
            '.lrv-item__cover-box{position:relative;padding-bottom:100%;background:rgba(255,255,255,.1);border-radius:.6em}' +
            '.lrv-item__cover-box img{position:absolute;top:0;left:0;width:100%;height:100%;border-radius:.6em;opacity:0}' +
            '.lrv-item__cover-box.loaded{background:transparent}' +
            '.lrv-item__cover-box.loaded img{opacity:1}' +
            '.lrv-item__cover-box.loaded-icon img{left:20%;top:20%;width:60%;height:60%;opacity:.2}' +
            '.lrv-item__title{font-weight:700;font-size:1.2em}' +
            '.lrv-item__tooltip{opacity:.5;margin-top:.4em;font-size:1em}' +
            '.lrv-item.focus{background:#fff;color:#000;border-radius:.8em}' +
            '.lrv-player{position:fixed;z-index:100;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column}' +
            '.lrv-player__cover{width:20em}' +
            '.lrv-cover__img-box{position:relative;padding-bottom:100%;background:rgba(0,0,0,.3);border-radius:1em}' +
            '.lrv-cover__img-box img{position:absolute;top:0;left:0;width:100%;height:100%;border-radius:1em;opacity:0}' +
            '.lrv-cover__img-box.loaded img{opacity:1}' +
            '.lrv-cover__img-box.loaded{background:transparent}' +
            '.lrv-cover__img-box.loaded-icon img{left:20%;top:20%;width:60%;height:60%;opacity:.2}' +
            '.lrv-cover__title{font-weight:700;font-size:1.5em;margin-top:1em;text-align:center}' +
            '.lrv-cover__tooltip{opacity:.5;font-size:1.2em;margin-top:.3em;text-align:center}' +
            '.lrv-player__wave{display:flex;align-items:center;justify-content:center;margin-top:2em}' +
            '.lrv-player__wave>div{width:2px;background:#fff;margin:0 .3em;height:1em;opacity:0}' +
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
