/*
 * Static server for the standalone 3D viewer.
 * Serves the `public` folder so /viewer/ and /models/ resolve exactly like
 * the Vite dev/preview servers. No dependencies required.
 *
 *   node serve-viewer.js
 *   http://127.0.0.1:8015/viewer/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8015;

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
    '.hdr': 'image/vnd.radiance',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ktx2': 'image/ktx2',
    '.wasm': 'application/wasm',
    '.xz': 'application/x-xz',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch (e) {
        res.writeHead(400); res.end('Bad request'); return;
    }
    if (urlPath === '/') urlPath = '/viewer/';
    if (urlPath.endsWith('/')) urlPath += 'index.html';

    const filePath = path.resolve(ROOT, '.' + urlPath);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found: ' + urlPath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const isCode = ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.css';
        const headers = {
            'Content-Type': types[ext] || 'application/octet-stream',
            'Accept-Ranges': 'bytes',
            'Cache-Control': isCode ? 'no-cache' : 'public, max-age=604800, immutable',
            'Access-Control-Allow-Origin': '*'
        };
        const range = req.headers.range;
        if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (m) {
                let start = m[1] ? parseInt(m[1], 10) : 0;
                let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
                if (start >= stat.size || start > end) {
                    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
                    res.end();
                    return;
                }
                if (end >= stat.size) end = stat.size - 1;
                headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
                headers['Content-Length'] = end - start + 1;
                res.writeHead(206, headers);
                fs.createReadStream(filePath, { start, end }).pipe(res);
                return;
            }
        }
        headers['Content-Length'] = stat.size;
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('Serving ' + ROOT);
    console.log('Local: http://127.0.0.1:' + PORT + '/viewer/');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log('LAN:   http://' + net.address + ':' + PORT + '/viewer/');
            }
        }
    }
});
