const { detectBufferMime, detectFilenameMime } = require('mime-detect');
const { readFile } = require('fs/promises');
const { createReadStream } = require('fs');
const { createHash } = require('crypto');

// Create helper functions in a private scope
const { hasMaliciousPDFContent, hasMaliciousSVGContent, isCSVBuffer, getFileSHA256 } = (() => {
    // Private helper functions
    const hasMaliciousPDFContent = Object.freeze(function (buffer) {
        const text = buffer.toString('latin1');
        const patterns = Object.freeze([
            /\/JavaScript[\s<]/,   // real JavaScript action
            /\/JS[\s<]/,           // short form for JavaScript
            /\/AA[\s<]/            // additional action dictionary
        ]);
        return patterns.some(p => {
            const match = text.match(p);
            if (!match) return false;
            const context = text.slice(Math.max(0, match.index - 100), match.index + 100);
            return /obj|endobj/.test(context);
        });
    });

    const hasMaliciousSVGContent = Object.freeze(function (buffer) {
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

    const isCSVBuffer = Object.freeze(function (buffer) {
        const sample = buffer.toString('utf-8', 0, 2048); // read a small portion
        const lines = sample.split(/\r?\n/).filter(Boolean);

        if (lines.length >= 2) {
            const [firstLine, secondLine] = lines;
            if (firstLine.includes(',') && secondLine.includes(',')) {
                const cols1 = splitCSVLine(firstLine).length;
                const cols2 = splitCSVLine(secondLine).length;
                if (cols1 > 1 && cols1 === cols2) return true;
            }
        }
        return false;
    });

    const splitCSVLine = function (line) {
        const fields = [];
        let field = '';
        let inQuotes = false;
        for (let char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                fields.push(field);
                field = '';
            } else {
                field += char;
            }
        }
        fields.push(field);
        return fields;
    }

    const getFileSHA256 = Object.freeze(function (filePath, chunkSize = 1024 * 1024) {
        return new Promise((resolve, reject) => {
            try {
                const hash = createHash('sha256');
                const stream = createReadStream(filePath, { highWaterMark: chunkSize });
                stream.on('data', chunk => hash.update(chunk));
                stream.on('end', () => resolve(hash.digest('hex')));
                stream.on('error', reject);
            } catch (error) {
                reject(error);
            }
        });
    })

    // Return frozen object containing the helper functions
    return Object.freeze({
        hasMaliciousPDFContent,
        hasMaliciousSVGContent,
        isCSVBuffer,
        getFileSHA256
    });
})();

// MIME types whose content commonly sniffs as text/plain (or as one another),
// treated as interchangeable when comparing extension MIME vs. content MIME.
const mimeTypesThatAppearAsTextPlain = Object.freeze([
    'text/plain',
    'text/csv',
    'application/csv', // some `file` versions report CSV content as this
    'text/tab-separated-values',
    'application/json',
    'application/xml',
    'text/xml', // `file` reports XML/extension-less SVG content as this
    'text/html',
    'text/markdown',
    'text/yaml',
    'application/javascript',
    'text/javascript',
    'application/typescript',
    'text/css',
    'text/x-python',
    'text/x-java-source',
    'text/x-csrc',
    'text/x-c++src',
    'text/x-ruby',
    'application/sql',
]);
const isTextPlain = mime => mimeTypesThatAppearAsTextPlain.includes(mime);

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
    // 2) fetch file
    const file = this.req.files[inputName];
    if (!file) {
        // ERR101: The requested upload field does not contain a file.
        return {
            is_valid: false,
            message: `No file was uploaded in the "${inputName}" field.`,
            error_code: 'ERR101',
            fileData: null,
        };
    }

    // 3) extract only the fields we want for output.fileData
    const { name, size, encoding, mimetype, md5, tempFilePath } = file;
    let output = {
        is_valid: false,
        error_code: '',
        message: '',
        fileData: { name, size, encoding, mimetype, md5 },
    };

    // 4) read buffer asynchronously
    let fileBuffer;
    try {
        fileBuffer = await readFile(tempFilePath);
    } catch (err) {
        // ERR102: The uploaded file exists, but its temporary file cannot be read.
        output.error_code = 'ERR102';
        output.message = `Unable to read the uploaded file "${name}".`;
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
        // ERR103: The filename extension resolves to a MIME type outside the accept list.
        output.error_code = 'ERR103';
        output.message = `File type "${baseExt}" is not allowed by the accepted MIME types.`;
        return output;
    }

    if (isTextPlain(baseExt)) {
        // Text-alike content commonly sniffs as text/plain; CSV also as application/csv
        accepted.push('text/plain');
        if (baseExt === 'text/csv') accepted.push('application/csv');
    }
    // 8) sniff buffer MIME (may include “; charset=…”)
    const bufferMimeRaw = await detectBufferMime(fileBuffer);
    const baseBuf = bufferMimeRaw.split(';')[0].trim();

    // Content and extension MIME must agree, except among text-plain-alike types
    const isMimeMismatch = baseBuf !== baseExt && !(isTextPlain(baseExt) && isTextPlain(baseBuf));

    if (isMimeMismatch) {
        // ERR104: The file content MIME type does not match the MIME type inferred from its name.
        output.error_code = 'ERR104';
        output.message = `File content is detected as "${baseBuf}", but the filename indicates "${baseExt}".`;
        return output;
    }

    if (!matchesWildcard(baseBuf)) {
        // ERR105: The detected content MIME type is outside the accept list.
        output.error_code = 'ERR105';
        output.message = `Detected file type "${baseBuf}" is not allowed by the accepted MIME types.`;
        return output;
    }

    // // 9) normalize the final MIME string only if bufferMimeRaw lacks parameters
    // const finalMime = bufferMimeRaw.includes(';')
    //     ? bufferMimeRaw
    //     : detectFilenameMime(name, bufferMimeRaw);

    // 10) deep script scans

    if (baseExt === 'text/csv' && !isCSVBuffer(fileBuffer)) {
        // ERR106: The file has a CSV extension, but its contents do not have a valid CSV structure.
        return {
            ...output,
            error_code: 'ERR106',
            message: 'The file has a CSV extension, but its content is not valid CSV data.',
        };

    }

    if (
        detectPdfScripts &&
        baseBuf === 'application/pdf' &&
        hasMaliciousPDFContent(fileBuffer)
    ) {
        // ERR107: PDF script scanning found an embedded JavaScript action.
        return {
            ...output,
            error_code: 'ERR107',
            message: 'Embedded JavaScript detected in PDF.',
        };
    }

    if (
        detectSvgScripts &&
        baseBuf === 'image/svg+xml' &&
        hasMaliciousSVGContent(fileBuffer)
    ) {
        // ERR108: SVG script scanning found markup or a URL that may execute script.
        return {
            ...output,
            error_code: 'ERR108',
            message: 'Potential XSS risk: Dangerous SVG content.',
        };
    }

    // 11) all checks passed — error_code is always a string, empty when valid
    return {
        ...output,
        is_valid: true,
        error_code: '',
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
    // 2) fetch files
    const files = this.req.files[inputName];
    if (!files) {
        // ERR101: The requested upload field does not contain any files.
        return {
            is_valid: false,
            error_code: 'ERR101',
            message: `No files were uploaded in the "${inputName}" field.`,
            filesData: null,
        };
    }

    // Ensure we have an array of files
    const fileArray = Array.isArray(files) ? files : [files];
    const results = [];

    // Process each file
    for (const file of fileArray) {
        const { name, size, encoding, mimetype, md5, tempFilePath } = file;
        // Empty on failure — the readFile below reports the ERR102 for unreadable files
        const sha256 = await getFileSHA256(tempFilePath).catch(() => '');
        let fileResult = {
            is_valid: false,
            message: '',
            error_code: '',
            fileData: { name, size, encoding, mimetype, md5, sha256 }
        };

        // Read buffer asynchronously
        let fileBuffer;
        try {
            fileBuffer = await readFile(tempFilePath);
        } catch (err) {
            // ERR102: The uploaded file exists, but its temporary file cannot be read.
            fileResult.error_code = 'ERR102';
            fileResult.message = `Unable to read the uploaded file "${name}".`;
            results.push(fileResult);
            continue;
        }

        // Initial extension-based MIME
        const extMime = detectFilenameMime(name);
        const baseExt = extMime.split(';')[0].trim();

        // Prepare accept-list and wildcard matcher inside the loop to avoid leakage mutations
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
            // ERR103: The filename extension resolves to a MIME type outside the accept list.
            fileResult.error_code = 'ERR103';
            fileResult.message = `File type "${baseExt}" is not allowed by the accepted MIME types.`;
            results.push(fileResult);
            continue;
        }

        // Text-alike content commonly sniffs as text/plain; CSV also as application/csv
        if (isTextPlain(baseExt)) {
            accepted.push('text/plain');
            if (baseExt === 'text/csv') accepted.push('application/csv');
        }

        // Sniff buffer MIME
        const bufferMimeRaw = await detectBufferMime(fileBuffer);
        const baseBuf = bufferMimeRaw.split(';')[0].trim();

        // Content and extension MIME must agree, except among text-plain-alike types
        const isMimeMismatch = baseBuf !== baseExt && !(isTextPlain(baseExt) && isTextPlain(baseBuf));

        if (isMimeMismatch) {
            // ERR104: The file content MIME type does not match the MIME type inferred from its name.
            fileResult.error_code = 'ERR104';
            fileResult.message = `File content is detected as "${baseBuf}", but the filename indicates "${baseExt}".`;
            results.push(fileResult);
            continue;
        }

        if (!matchesWildcard(baseBuf)) {
            // ERR105: The detected content MIME type is outside the accept list.
            fileResult.error_code = 'ERR105';
            fileResult.message = `Detected file type "${baseBuf}" is not allowed by the accepted MIME types.`;
            results.push(fileResult);
            continue;
        }

        // Check for CSV content
        if (baseExt === 'text/csv' && !isCSVBuffer(fileBuffer)) {
            // ERR106: The file has a CSV extension, but its contents do not have a valid CSV structure.
            fileResult.error_code = 'ERR106';
            fileResult.message = 'The file has a CSV extension, but its content is not valid CSV data.';
            results.push(fileResult);
            continue;
        }

        // Check for malicious PDF content
        if (detectPdfScripts && baseBuf === 'application/pdf' && hasMaliciousPDFContent(fileBuffer)) {
            // ERR107: PDF script scanning found an embedded JavaScript action.
            fileResult.error_code = 'ERR107';
            fileResult.message = 'Embedded JavaScript detected in PDF.';
            results.push(fileResult);
            continue;
        }

        // Check for malicious SVG content
        if (detectSvgScripts && baseBuf === 'image/svg+xml' && hasMaliciousSVGContent(fileBuffer)) {
            // ERR108: SVG script scanning found markup or a URL that may execute script.
            fileResult.error_code = 'ERR108';
            fileResult.message = 'Potential XSS risk: Dangerous SVG content.';
            results.push(fileResult);
            continue;
        }

        // All checks passed for this file — error_code is always a string, empty when valid
        fileResult.is_valid = true;
        fileResult.error_code = '';
        results.push(fileResult);
    }

    // Return overall results
    const allValid = results.every(r => r.is_valid);
    return {
        is_valid: allValid,
        message: allValid ? 'All files validated successfully' : 'Some files failed validation',
        // ERR109: One or more files in the batch failed validation.
        error_code: allValid ? '' : 'ERR109',
        filesData: results
    };
};
