(function () {
    'use strict';

    var PLUGIN_ID   = 'latvian_radio';
    var PLUGIN_NAME = 'Радио LV';

    var RECORD_STATIONS = [
        {
            title: 'Radio Record',
            url:   'https://radiorecord.hostingradio.ru/rr96.aacp',
            icon:  'https://www.radiorecord.ru/upload/iblock/b32/b3222ec60c4988da93f95e53ba6d2b37.png'
        },
        {
            title: 'Record Deep',
            url:   'https://radiorecord.hostingradio.ru/deep96.aacp',
            icon:  'https://www.radiorecord.ru/upload/styles/7/image.jpg'
        },
        {
            title: 'Record Trap',
            url:   'https://radiorecord.hostingradio.ru/trap96.aacp',
            icon:  'https://www.radiorecord.ru/upload/styles/17/image.jpg'
        }
    ];

    var API_LV = 'https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/LV?hidebroken=true&order=votes&limit=40';

    // ── Templates ────────────────────────────────
    Lampa.Template.add('lr_item',
        '<div class="selector lr-item">' +
            '<div class="lr-item__imgbox"><img class="lr-item__img" /></div>' +
            '<div class="lr-item__name">{name}</div>' +
        '</div>'
    );

    Lampa.Template.add('lr_player',
        '<div class="selector lr-player stop hide">' +
            '<div class="lr-player__name">Radio</div>' +
            '<div class="lr-player__button"><i></i><i></i><i></i><i></i></div>' +
        '</div>'
    );

    Lampa.Template.add('lr_style',
        '<style>' +
        '.lr-item{margin-left:1em;margin-bottom:1em;width:12.5%;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
        '.lr-item__imgbox{background:#2a2a2a;padding-bottom:83%;position:relative;-webkit-border-radius:.4em;-moz-border-radius:.4em;border-radius:.4em;overflow:hidden}' +
        '.lr-item__img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;padding:.6em;-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box}' +
        '.lr-item__name{font-size:1em;margin-top:.6em;white-space:nowrap;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis}' +
        '.lr-item.focus .lr-item__imgbox:after{content:"";display:block;position:absolute;left:-.4em;top:-.4em;right:-.4em;bottom:-.4em;border:.26em solid #fff;-webkit-border-radius:.8em;-moz-border-radius:.8em;border-radius:.8em}' +
        '@-webkit-keyframes lr-spin{to{-webkit-transform:rotate(360deg);transform:rotate(360deg)}}' +
        '@keyframes lr-spin{to{-webkit-transform:rotate(360deg);-moz-transform:rotate(360deg);transform:rotate(360deg)}}' +
        '@-webkit-keyframes lr-eq{0%{height:.1em}100%{height:1em}}' +
        '@keyframes lr-eq{0%{height:.1em}100%{height:1em}}' +
        '.lr-player{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-border-radius:.3em;-moz-border-radius:.3em;border-radius:.3em;padding:.2em .8em;background:#3e3e3e}' +
        '.lr-player.hide{display:none}' +
        '.lr-player__name{margin-right:1em;white-space:nowrap;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;max-width:8em}' +
        '.lr-player__button{position:relative;width:1.5em;height:1.5em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-moz-box-pack:center;-ms-flex-pack:center;justify-content:center;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
        '.lr-player__button i{display:block;width:.2em;background:#fff;margin:0 .1em;-webkit-animation:lr-eq 0ms -800ms linear infinite alternate;animation:lr-eq 0ms -800ms linear infinite alternate;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
        '.lr-player__button i:nth-child(1){-webkit-animation-duration:474ms;animation-duration:474ms}' +
        '.lr-player__button i:nth-child(2){-webkit-animation-duration:433ms;animation-duration:433ms}' +
        '.lr-player__button i:nth-child(3){-webkit-animation-duration:407ms;animation-duration:407ms}' +
        '.lr-player__button i:nth-child(4){-webkit-animation-duration:458ms;animation-duration:458ms}' +
        '.lr-player.stop .lr-player__button{-webkit-border-radius:100%;-moz-border-radius:100%;border-radius:100%;border:.2em solid #fff}' +
        '.lr-player.stop .lr-player__button i{display:none}' +
        '.lr-player.stop .lr-player__button:after{content:"";width:.5em;height:.5em;background:#fff}' +
        '.lr-player.loading .lr-player__button:before{content:"";display:block;border-top:.2em solid #fff;border-left:.2em solid transparent;border-right:.2em solid transparent;border-bottom:.2em solid transparent;-webkit-animation:lr-spin 1s linear infinite;animation:lr-spin 1s linear infinite;width:.9em;height:.9em;-webkit-border-radius:100%;-moz-border-radius:100%;border-radius:100%;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
        '.lr-player.loading .lr-player__button i{display:none}' +
        '.lr-player.focus{background:#fff;color:#000}' +
        '.lr-player.focus .lr-player__button{border-color:#000}' +
        '.lr-player.focus .lr-player__button i,.lr-player.focus .lr-player__button:after{background:#000}' +
        '.lr-player.focus .lr-player__button:before{border-top-color:#000}' +
        '@media screen and (max-width:580px){.lr-item{width:20%}}' +
        '@media screen and (max-width:385px){.lr-item{width:25%}.lr-item__name,.lr-player__name{display:none}}' +
        '</style>'
    );

    // ── Player ───────────────────────────────────
    function player() {
        var html    = Lampa.Template.get('lr_player', {});
        var audio   = new Audio();
        var url     = '';
        var played  = false;
        var hls;

        audio.addEventListener('play', function () {
            played = true;
            html.toggleClass('loading', false);
        });

        function prepare() {
            if (audio.canPlayType('audio/vnd.apple.mpegurl') || url.indexOf('.aacp') > 0) {
                load();
            } else if (typeof Hls !== 'undefined' && Hls.isSupported() && url.indexOf('.m3u8') > 0) {
                try {
                    hls = new Hls();
                    hls.attachMedia(audio);
                    hls.loadSource(url);
                    hls.on(Hls.Events.ERROR, function (event, data) {
                        if (data.fatal) Lampa.Noty.show('HLS ошибка потока');
                    });
                    hls.on(Hls.Events.MANIFEST_LOADED, function () { start(); });
                } catch (e) {
                    load();
                }
            } else {
                load();
            }
        }

        function load() {
            audio.src = url;
            audio.load();
            start();
        }

        function start() {
            var p;
            try { p = audio.play(); } catch (e) {}
            if (p !== undefined) {
                p.then(function () {}).catch(function (e) {
                    console.log('Radio', 'play error:', e.message);
                });
            }
        }

        function play() {
            html.toggleClass('loading', true);
            html.toggleClass('stop', false);
            prepare();
        }

        function stop() {
            played = false;
            html.toggleClass('stop', true);
            html.toggleClass('loading', false);
            if (hls) { hls.destroy(); hls = false; }
            audio.src = '';
        }

        html.on('hover:enter', function () {
            if (played) stop();
            else if (url) play();
        });

        this.create = function () {
            $('.head__actions .open--search').before(html);
        };

        this.play = function (data) {
            stop();
            url = data.url;
            html.find('.lr-player__name').text(data.title);
            html.toggleClass('hide', false);
            play();
        };
    }

    // ── Item ─────────────────────────────────────
    function item(data) {
        var el  = Lampa.Template.get('lr_item', { name: data.title });
        var img = el.find('img')[0];

        img.onerror = function () { img.src = './img/img_broken.svg'; };
        img.src = data.icon || './img/img_broken.svg';

        this.render  = function () { return el; };
        this.destroy = function () {
            img.onerror = function () {};
            img.onload  = function () {};
            img.src = '';
            el.remove();
        };
    }

    // ── Component ────────────────────────────────
    function component() {
        var network = new Lampa.Reguest();
        var scroll  = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var items   = [];
        var html    = $('<div></div>');
        var body    = $('<div class="category-full"></div>');
        var last;

        this.create = function () {
            var _this = this;
            this.activity.loader(true);

            // Immediately show Record stations
            _this.append(RECORD_STATIONS);

            // Fetch Latvian stations
            network['native'](API_LV, function (data) {
                if (Array.isArray(data) && data.length) {
                    var stations = data
                        .filter(function (s) { return s.url_resolved || s.url; })
                        .map(function (s) {
                            return {
                                title: s.name || 'Unknown',
                                url:   s.url_resolved || s.url,
                                icon:  s.favicon || ''
                            };
                        });
                    _this.append(stations);
                }
                scroll.minus();
                scroll.append(body);
                html.append(scroll.render());
                _this.activity.loader(false);
                _this.activity.toggle();
            }, function () {
                var empty = new Lampa.Empty();
                html.append(empty.render());
                _this.start = empty.start;
                _this.activity.loader(false);
                _this.activity.toggle();
            });

            return this.render();
        };

        this.append = function (stations) {
            stations.forEach(function (station) {
                var it = new item(station);
                it.render()
                    .on('hover:focus', function () {
                        last = it.render()[0];
                        scroll.update(items[items.indexOf(it)].render(), true);
                    })
                    .on('hover:enter', function () {
                        window.lr_player.play(station);
                    });
                body.append(it.render());
                items.push(it);
            });
        };

        this.back = function () { Lampa.Activity.backward(); };

        this.background = function () {
            Lampa.Background.immediately('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAZCAYAAABD2GxlAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAHASURBVHgBlZaLrsMgDENXxAf3/9XHFdXNZLm2YZHQymPk4CS0277v9+ffrut62nEcn/M8nzb69cxj6le1+75f/RqrZ9fatm3F9wwMR7yhawilNke4Gis/7j9srQbdaVFBnkcQ1WrfgmIIBcTrvgqqsKiTzvpOQbUnAykVW4VVqZXyyDllYFSKx9QaVrO7nGJIB63g+FAq/xhcHWBYdwCsmAtvFZUKE0MlVZWCT4idOlyhTp3K35R/6Nzlq0uBnsKWlEzgSh1VGJxv6rmpXMO7EK+XWUPnDFRWqitQFeY2UyZVryuWlI8ulLgGf19FooAUwC9gCWLcwzWPb7Wa60qdlZxjx6ooUuUqVQsK+y1VoAJyBeJAVsLJeYmg/RIXdG2kPhwYPBUQQyYF0XC8lwP3MTCrYAXB88556peCbUUZV7WccwkUQfCZC4PXdA5hKhSVhythZqjZM0J39w5m8BRadKAcrsIpNZsLIYdOqcZ9hExhZ1MH+QL+ciFzXzmYhZr/M6yUUwp2dp5U4naZDwAF5JRSefdScJZ3SkU0nl8xpaAy+7ml1EqvMXSs1HRrZ9bc3eZUSXmGa/mdyjbmqyX7A9RaYQa9IRJ0AAAAAElFTkSuQmCC');
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            this.background();
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () { Navigator.move('right'); },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };

        this.pause   = function () {};
        this.stop    = function () {};
        this.render  = function () { return html; };
        this.destroy = function () {
            network.clear();
            Lampa.Arrays.destroy(items);
            scroll.destroy();
            html.remove();
            items = null;
            network = null;
        };
    }

    // ── Boot ─────────────────────────────────────
    function startPlugin() {
        window[PLUGIN_ID] = true;

        Lampa.Component.add(PLUGIN_ID, component);
        window.lr_player = new player();

        Lampa.Listener.follow('app', function (e) {
            if (e.type !== 'ready') return;

            $('body').append(Lampa.Template.get('lr_style', {}, true));
            window.lr_player.create();

            var btn = $(
                '<li class="menu__item selector" data-action="' + PLUGIN_ID + '">' +
                    '<div class="menu__ico">' +
                        '<svg width="38" height="31" viewBox="0 0 38 31" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<rect x="17.613" width="3" height="16.3327" rx="1.5" transform="rotate(63.4707 17.613 0)" fill="white"/>' +
                            '<circle cx="13" cy="19" r="6" fill="white"/>' +
                            '<path fill-rule="evenodd" clip-rule="evenodd" d="M0 11C0 8.79086 1.79083 7 4 7H34C36.2091 7 38 8.79086 38 11V27C38 29.2091 36.2092 31 34 31H4C1.79083 31 0 29.2091 0 27V11ZM21 19C21 23.4183 17.4183 27 13 27C8.58173 27 5 23.4183 5 19C5 14.5817 8.58173 11 13 11C17.4183 11 21 14.5817 21 19ZM30.5 18C31.8807 18 33 16.8807 33 15.5C33 14.1193 31.8807 13 30.5 13C29.1193 13 28 14.1193 28 15.5C28 16.8807 29.1193 18 30.5 18Z" fill="white"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="menu__text">' + PLUGIN_NAME + '</div>' +
                '</li>'
            );

            btn.on('hover:enter', function () {
                Lampa.Activity.push({
                    url:       '',
                    title:     PLUGIN_NAME,
                    component: PLUGIN_ID,
                    page:      1
                });
            });

            $('.menu .menu__list').eq(0).append(btn);
        });
    }

    if (!window[PLUGIN_ID]) startPlugin();

})();
