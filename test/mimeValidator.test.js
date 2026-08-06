const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm, stat } = require('fs/promises');
const { createHash } = require('crypto');
const { tmpdir } = require('os');
const path = require('path');

const { mime_validator, mime_validator_multiple } = require('../server_connect/mimeValidator');

// Minimal mock of Wappler's Server Connect `this` context
const ctx = files => ({
    parseRequired: v => v,
    parseOptional: (v, _type, def) => (v === undefined ? def : v),
    req: { files },
});

// Build the file object express-fileupload would put on req.files
const upload = async (name, filePath) => {
    const size = filePath.includes('nonexistent') ? 0 : (await stat(filePath)).size;
    return { name, size, encoding: '7bit', mimetype: 'application/octet-stream', md5: 'x', tempFilePath: filePath };
};

const FIXTURES = {
    'valid.csv': 'name,age,city\nalice,30,nyc\nbob,25,sf\n',
    'quoted.csv': '"last, first",age\n"doe, jane",40\n"roe, rick",41\n',
    'prose.csv': 'just some plain prose\nwith no commas at all\n',
    'page.csv': '<!DOCTYPE html>\n<html><body><h1>hi</h1></body></html>\n',
    'clean.pdf': '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n',
    'evil.pdf': '%PDF-1.4\n1 0 obj\n<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>\nendobj\ntrailer\n%%EOF\n',
    'clean.svg': '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n',
    'evil.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
    'pixel.png': Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from([0x00, 0x00, 0x00, 0x0d]),
        Buffer.from('IHDR'),
        Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89]),
    ]),
    'tool.exe': Buffer.from('MZ\x90\x00binary stub'),
    'fake.pdf': Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]), // binary junk with a .pdf name
};

let dir;
const fx = name => path.join(dir, name);

before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mime-validator-test-'));
    await Promise.all(Object.entries(FIXTURES).map(([name, content]) => writeFile(fx(name), content)));
});

after(() => rm(dir, { recursive: true, force: true }));

describe('mime_validator (single)', () => {
    const run = async (fileOrNull, options) =>
        mime_validator.call(ctx({ upload: fileOrNull }), { input_name: 'upload', ...options });

    test('ERR101 when the input field has no file', async () => {
        const res = await run(null, { accepts: '*/*' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR101');
        assert.equal(res.fileData, null);
    });

    test('ERR102 when the temp file cannot be read', async () => {
        const res = await run(await upload('a.txt', '/nonexistent/tempfile'), { accepts: '*/*' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR102');
    });

    test('ERR103 when the extension MIME is not in the accept list', async () => {
        const res = await run(await upload('tool.exe', fx('tool.exe')), { accepts: 'image/*' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR103');
    });

    test('ERR104 when content does not match the extension', async () => {
        const res = await run(await upload('fake.pdf', fx('fake.pdf')), { accepts: 'application/pdf' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR104');
        assert.match(res.message, /detected as/);
    });

    test('ERR104 mismatch fires even with accepts */*', async () => {
        const res = await run(await upload('fake.pdf', fx('fake.pdf')), { accepts: '*/*' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR104');
    });

    test('ERR105 when text-alike content type is outside the accept list (HTML named .csv)', async () => {
        const res = await run(await upload('page.csv', fx('page.csv')), { accepts: 'text/csv' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR105');
    });

    test('ERR106 when a .csv file has no CSV structure', async () => {
        const res = await run(await upload('prose.csv', fx('prose.csv')), { accepts: 'text/csv' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR106');
    });

    test('ERR107 for PDF with embedded JavaScript when detectPdfScripts is on', async () => {
        const res = await run(await upload('evil.pdf', fx('evil.pdf')), { accepts: 'application/pdf', detectPdfScripts: true });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR107');
    });

    test('PDF with embedded JavaScript passes when detectPdfScripts is off (default)', async () => {
        const res = await run(await upload('evil.pdf', fx('evil.pdf')), { accepts: 'application/pdf' });
        assert.equal(res.is_valid, true);
        assert.equal(res.error_code, '');
    });

    test('ERR108 for SVG with script when detectSvgScripts is on (default)', async () => {
        const res = await run(await upload('evil.svg', fx('evil.svg')), { accepts: 'image/svg+xml' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR108');
    });

    test('SVG with script passes when detectSvgScripts is explicitly off', async () => {
        const res = await run(await upload('evil.svg', fx('evil.svg')), { accepts: 'image/svg+xml', detectSvgScripts: false });
        assert.equal(res.is_valid, true);
        assert.equal(res.error_code, '');
    });

    for (const [file, accepts] of [
        ['valid.csv', 'text/csv'],
        ['quoted.csv', 'text/csv'],
        ['clean.pdf', 'application/pdf'],
        ['clean.svg', 'image/svg+xml'],
        ['pixel.png', 'image/*'],
        ['pixel.png', '*/*'],
    ]) {
        test(`valid: ${file} with accepts "${accepts}"`, async () => {
            const res = await run(await upload(file, fx(file)), { accepts });
            assert.equal(res.error_code, '');
            assert.equal(res.is_valid, true);
        });
    }

    test('error_code is always a string and fileData keeps its shape', async () => {
        const file = await upload('pixel.png', fx('pixel.png'));
        for (const options of [{ accepts: 'image/*' }, { accepts: 'text/csv' }]) {
            const res = await run(file, options);
            assert.equal(typeof res.error_code, 'string');
            assert.deepEqual(Object.keys(res.fileData), ['name', 'size', 'encoding', 'mimetype', 'md5']);
        }
    });
});

describe('mime_validator_multiple', () => {
    const run = async (filesOrNull, options) =>
        mime_validator_multiple.call(ctx({ uploads: filesOrNull }), { input_name: 'uploads', ...options });

    test('ERR101 when the input field has no files', async () => {
        const res = await run(null, { accepts: '*/*' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR101');
        assert.equal(res.filesData, null);
    });

    test('all valid files: aggregate and per-file error_code are empty strings', async () => {
        const files = [await upload('valid.csv', fx('valid.csv')), await upload('pixel.png', fx('pixel.png'))];
        const res = await run(files, { accepts: 'text/csv, image/png' });
        assert.equal(res.is_valid, true);
        assert.equal(res.error_code, '');
        assert.equal(res.message, 'All files validated successfully');
        assert.equal(res.filesData.length, 2);
        for (const r of res.filesData) {
            assert.equal(r.is_valid, true);
            assert.equal(r.error_code, '');
        }
    });

    test('mixed batch: aggregate ERR109 with per-file codes in order', async () => {
        const files = [
            await upload('pixel.png', fx('pixel.png')),
            await upload('tool.exe', fx('tool.exe')),
            await upload('prose.csv', fx('prose.csv')),
        ];
        const res = await run(files, { accepts: 'image/png, text/csv' });
        assert.equal(res.is_valid, false);
        assert.equal(res.error_code, 'ERR109');
        assert.equal(res.message, 'Some files failed validation');
        assert.deepEqual(res.filesData.map(r => r.error_code), ['', 'ERR103', 'ERR106']);
    });

    test('a single (non-array) file object is handled', async () => {
        const res = await run(await upload('pixel.png', fx('pixel.png')), { accepts: 'image/*' });
        assert.equal(res.is_valid, true);
        assert.equal(res.filesData.length, 1);
    });

    test('sha256 is computed for each file', async () => {
        const res = await run([await upload('valid.csv', fx('valid.csv'))], { accepts: 'text/csv' });
        const expected = createHash('sha256').update(FIXTURES['valid.csv']).digest('hex');
        assert.equal(res.filesData[0].fileData.sha256, expected);
    });

    test('unreadable temp file yields per-file ERR102 instead of crashing the batch', async () => {
        const files = [await upload('gone.bin', '/nonexistent/tempfile'), await upload('pixel.png', fx('pixel.png'))];
        const res = await run(files, { accepts: '*/*' });
        assert.equal(res.error_code, 'ERR109');
        assert.equal(res.filesData[0].error_code, 'ERR102');
        assert.equal(res.filesData[0].fileData.sha256, '');
        assert.equal(res.filesData[1].is_valid, true);
    });
});
