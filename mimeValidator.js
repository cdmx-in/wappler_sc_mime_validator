const { detectBufferMime, detectFilenameMime } = require('mime-detect');
const { readFile } = require('fs/promises');

// Create helper functions in a private scope
const { hasMaliciousPDFContent, hasMaliciousSVGContent, isCSVBuffer } = (() => {
    // Private helper functions
    const hasMaliciousPDFContent = Object.freeze(function(buffer) {
        const text = buffer.toString('latin1');
        const patterns = Object.freeze([/\/JavaScript\b/, /\/JS\b/, /\/AA\b/]);
        return patterns.some(p => p.test(text));
    });

    const hasMaliciousSVGContent = Object.freeze(function(buffer) {
        const text = buffer.toString('utf8');
        const patterns = Object.freeze([
            /<script\b/i,
            /\b(on\w+)="[^"]*"/i,
            /\b(on\w+)='[^']*'/i,
            /javascript:/i,
            /data:text\/html/i,
            /<[^>]+xlink:href=['"]?javascript:/i,
        ]);
        return patterns.some(p => p.test(text));
    });

    const isCSVBuffer = Object.freeze(function(buffer) {
        const sample = buffer.toString('utf-8', 0, 2048); // read a small portion
        const lines = sample.split(/\r?\n/).filter(Boolean);

        if (lines.length >= 2) {
            const [firstLine, secondLine] = lines;
            if (firstLine.includes(',') && secondLine.includes(',')) {
                const cols1 = firstLine.split(',').length;
                const cols2 = secondLine.split(',').length;
                if (cols1 > 1 && cols1 === cols2) return true;
            }
        }
        return false;
    });

    // Return frozen object containing the helper functions
    return Object.freeze({
        hasMaliciousPDFContent,
        hasMaliciousSVGContent,
        isCSVBuffer
    });
})();

exports.mime_validator = async function (options) {
    // 1) parse inputs
    const acceptsStr = this.parseRequired(
        options.accepts,
        'string',
        'A comma separated list of accepted MIME types is required.'
    );
    const inputName = this.parseRequired(
        options.input_name,
        'string',
        'Input name is required.'
    );
    const detectPdfScripts = this.parseOptional(
        options.detectPdfScripts,
        'boolean',
        false
    );
    const detectSvgScripts = this.parseOptional(
        options.detectSvgScripts,
        'boolean',
        true
    );
    const mimeTypesThatAppearAsTextPlain = [
        'text/plain',
        'text/csv',
        'text/tab-separated-values',
        'application/json',
        'application/xml',
        'text/html',
        'text/markdown',
        'text/yaml',
        'application/javascript',
        'application/typescript',
        'text/css',
        'text/x-python',
        'text/x-java-source',
        'text/x-csrc',
        'text/x-c++src',
        'text/x-ruby',
        'application/sql',
    ];


    // 2) fetch file
    const file = this.req.files[inputName];
    if (!file) {
        return {
            is_valid: false,
            message: 'File not found.',
            code: 'ERR101',
            fileData: null,
        };
    }

    // 3) extract only the fields we want for output.fileData
    const { name, size, encoding, mimetype, md5, tempFilePath } = file;
    let output = {
        is_valid: false,
        message: '',
        code: 'ERR101',
        fileData: { name, size, encoding, mimetype, md5 },
    };

    // 4) read buffer asynchronously
    let fileBuffer;
    try {
        fileBuffer = await readFile(tempFilePath);
    } catch (err) {
        output.message = 'Unable to read file.';
        return output;
    }

    // 5) initial extension-based MIME
    const extMime = detectFilenameMime(name);
    const baseExt = extMime.split(';')[0].trim();

    // 6) prepare accept-list and wildcard matcher
    const accepted = acceptsStr.split(',').map(s => s.trim());
    const matchesWildcard = mime =>
        accepted.some(a => {
            if (a === '*/*' || a === mime) return true;
            const [t, st] = a.split('/');
            const [mt, mst] = mime.split('/');
            if (t === '*' || t === mt) {
                return st === '*' || mst === st;
            }
            return false;
        });

    // 7) early reject based on extension check
    if (!matchesWildcard(baseExt)) {
        output.message = 'File type not allowed (extension).';
        return output;
    }

    const isTextPlain = mime =>
        mimeTypesThatAppearAsTextPlain.some(m => m === mime);

    if (isTextPlain(baseExt)) {
        accepted.push('text/plain');
    }
    // 8) sniff buffer MIME (may include “; charset=…”)
    const bufferMimeRaw = await detectBufferMime(fileBuffer);
    const baseBuf = bufferMimeRaw.split(';')[0].trim();

    if (!matchesWildcard(baseBuf)) {
        output.message = 'File type not allowed (content).';
        return output;
    }

    // // 9) normalize the final MIME string only if bufferMimeRaw lacks parameters
    // const finalMime = bufferMimeRaw.includes(';')
    //     ? bufferMimeRaw
    //     : detectFilenameMime(name, bufferMimeRaw);

    // 10) deep script scans

    if (baseExt === 'text/csv' && !isCSVBuffer(fileBuffer)) {
        return {
            ...output,
            code: 'ERR101',
            message: 'File type not allowed (content).',
        };

    }

    if (
        detectPdfScripts &&
        baseBuf === 'application/pdf' &&
        hasMaliciousPDFContent(fileBuffer)
    ) {
        return {
            ...output,
            code: 'ERR102',
            message: 'Embedded JavaScript detected in PDF.',
        };
    }

    if (
        detectSvgScripts &&
        baseBuf === 'image/svg+xml' &&
        hasMaliciousSVGContent(fileBuffer)
    ) {
        return {
            ...output,
            code: 'ERR103',
            message: 'Potential XSS risk: Dangerous SVG content.',
        };
    }

    // 11) all checks passed
    return {
        ...output,
        is_valid: true,
        code: 0,
        // if you want to return the MIME you actually used, include finalMime here:
        // detectedMime: finalMime
    };
};

exports.mime_validator_multiple = async function (options) {
    // 1) parse inputs
    const acceptsStr = this.parseRequired(
        options.accepts,
        'string',
        'A comma separated list of accepted MIME types is required.'
    );
    const inputName = this.parseRequired(
        options.input_name,
        'string',
        'Input name is required.'
    );
    const detectPdfScripts = this.parseOptional(
        options.detectPdfScripts,
        'boolean',
        false
    );
    const detectSvgScripts = this.parseOptional(
        options.detectSvgScripts,
        'boolean',
        true
    );
    const mimeTypesThatAppearAsTextPlain = [
        'text/plain',
        'text/csv',
        'text/tab-separated-values',
        'application/json',
        'application/xml',
        'text/html',
        'text/markdown',
        'text/yaml',
        'application/javascript',
        'application/typescript',
        'text/css',
        'text/x-python',
        'text/x-java-source',
        'text/x-csrc',
        'text/x-c++src',
        'text/x-ruby',
        'application/sql',
    ];

    // 2) fetch files
    const files = this.req.files[inputName];
    if (!files) {
        return {
            is_valid: false,
            message: 'Files not found.',
            code: 'ERR101',
            filesData: null,
        };
    }

    // Ensure we have an array of files
    const fileArray = Array.isArray(files) ? files : [files];
    const results = [];

    // Process each file
    for (const file of fileArray) {
        const { name, size, encoding, mimetype, md5, tempFilePath } = file;
        let fileResult = {
            is_valid: false,
            message: '',
            code: 'ERR101',
            filesData: [{ name, size, encoding, mimetype, md5 }]
        };

        // Read buffer asynchronously
        let fileBuffer;
        try {
            fileBuffer = await readFile(tempFilePath);
        } catch (err) {
            fileResult.message = 'Unable to read file.';
            results.push(fileResult);
            continue;
        }

        // Initial extension-based MIME
        const extMime = detectFilenameMime(name);
        const baseExt = extMime.split(';')[0].trim();

        // Prepare accept-list and wildcard matcher
        const accepted = acceptsStr.split(',').map(s => s.trim());
        const matchesWildcard = mime =>
            accepted.some(a => {
                if (a === '*/*' || a === mime) return true;
                const [t, st] = a.split('/');
                const [mt, mst] = mime.split('/');
                if (t === '*' || t === mt) {
                    return st === '*' || mst === st;
                }
                return false;
            });

        // Early reject based on extension check
        if (!matchesWildcard(baseExt)) {
            fileResult.message = 'File type not allowed (extension).';
            results.push(fileResult);
            continue;
        }

        // Handle text/plain types
        if (mimeTypesThatAppearAsTextPlain.some(m => m === baseExt)) {
            accepted.push('text/plain');
        }

        // Sniff buffer MIME
        const bufferMimeRaw = await detectBufferMime(fileBuffer);
        const baseBuf = bufferMimeRaw.split(';')[0].trim();

        if (!matchesWildcard(baseBuf)) {
            fileResult.message = 'File type not allowed (content).';
            results.push(fileResult);
            continue;
        }

        // Check for CSV content
        if (baseExt === 'text/csv' && !isCSVBuffer(fileBuffer)) {
            fileResult.message = 'File type not allowed (content).';
            fileResult.code = 'ERR101';
            results.push(fileResult);
            continue;
        }

        // Check for malicious PDF content
        if (detectPdfScripts && baseBuf === 'application/pdf' && hasMaliciousPDFContent(fileBuffer)) {
            fileResult.message = 'Embedded JavaScript detected in PDF.';
            fileResult.code = 'ERR102';
            results.push(fileResult);
            continue;
        }

        // Check for malicious SVG content
        if (detectSvgScripts && baseBuf === 'image/svg+xml' && hasMaliciousSVGContent(fileBuffer)) {
            fileResult.message = 'Potential XSS risk: Dangerous SVG content.';
            fileResult.code = 'ERR103';
            results.push(fileResult);
            continue;
        }

        // All checks passed for this file
        fileResult.is_valid = true;
        fileResult.code = 0;
        results.push(fileResult);
    }

    // Return overall results
    return {
        is_valid: results.every(r => r.is_valid),
        message: results.some(r => !r.is_valid) ? 'Some files failed validation' : 'All files validated successfully',
        code: results.some(r => !r.is_valid) ? 'ERR101' : 0,
        filesData: results
    };
};