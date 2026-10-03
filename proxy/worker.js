/*
 *  Прокси для радиопотоков плагина «Радио для Lampa» (Cloudflare Worker).
 *
 *  Зачем: браузер отдаёт данные о звуке (для реакции заставки на музыку)
 *  только если сервер станции разрешает это заголовком CORS. Большинство
 *  станций его не присылают. Прокси забирает поток со станции и отдаёт его
 *  плагину уже с этим заголовком.
 *
 *  Запрос:  https://<ваш-воркер>.workers.dev/?url=<адрес потока>
 *
 *  Чтобы прокси нельзя было использовать для чего угодно, он пропускает
 *  только аудиопотоки и HLS-плейлисты. Ссылки внутри HLS-плейлистов
 *  переписываются, чтобы сегменты тоже шли через прокси.
 */

const AUDIO_TYPES = /^(audio\/|application\/ogg|video\/mp2t|application\/aacp)/i;
const AUDIO_EXT   = /\.(mp3|aac|aacp|ogg|oga|opus|m4a|ts|flac)(\?|$)/i;
const PLAYLIST    = /mpegurl/i;

function corsHeaders(extra) {
    const h = new Headers(extra || {});
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Range');
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
    return h;
}

function fail(status, text) {
    return new Response(text, { status, headers: corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) });
}

export default {
    async fetch(request) {
        if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
        if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'method not allowed');

        const self = new URL(request.url);
        const target = self.searchParams.get('url') || '';
        if (!/^https?:\/\//i.test(target)) return fail(400, 'url required');

        const headers = { 'User-Agent': 'Mozilla/5.0 (LampaRadio proxy)', 'Icy-MetaData': '0' };
        const range = request.headers.get('Range');
        if (range) headers.Range = range;

        let upstream;
        try {
            upstream = await fetch(target, { headers, redirect: 'follow' });
        } catch (e) {
            return fail(502, 'upstream unreachable');
        }
        if (!upstream.ok && upstream.status !== 206) return fail(upstream.status, 'upstream error');

        const type = (upstream.headers.get('Content-Type') || '').split(';')[0].trim();
        const finalUrl = upstream.url || target;
        const isPlaylist = PLAYLIST.test(type) || /\.m3u8(\?|$)/i.test(new URL(finalUrl).pathname);

        // HLS: все ссылки в плейлисте — абсолютные и через этот же прокси
        if (isPlaylist) {
            const base = self.origin + self.pathname.replace(/\/?$/, '/') + '?url=';
            const wrap = (u) => base + encodeURIComponent(new URL(u, finalUrl).href);
            const text = (await upstream.text()).split('\n').map((line) => {
                const l = line.trim();
                if (!l) return line;
                if (l.charAt(0) !== '#') return wrap(l);
                return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + wrap(u) + '"');
            }).join('\n');
            return new Response(text, {
                headers: corsHeaders({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' })
            });
        }

        // только звук: прочие типы не пропускаем
        const octet = /octet-stream/i.test(type) || !type;
        if (!AUDIO_TYPES.test(type) && !(octet && AUDIO_EXT.test(finalUrl))) return fail(415, 'not an audio stream');

        const out = corsHeaders({ 'Content-Type': type || 'audio/mpeg', 'Cache-Control': 'no-store' });
        ['Content-Length', 'Content-Range', 'Accept-Ranges'].forEach((h) => {
            const v = upstream.headers.get(h);
            if (v) out.set(h, v);
        });
        // поток идёт насквозь, без буферизации в воркере
        return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
    }
};
