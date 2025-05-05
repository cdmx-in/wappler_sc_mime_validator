const { detectBufferMime, detectFilenameMime } = require('mime-detect');
const { readFileSync } = require('fs');

exports.mime_validator = async function (options) {
    let accepts = this.parseRequired(options.accepts, 'string', 'A comma seperated list of accepted mime\'s is required.');

    let output = { "is_valid": false, "message": "", "fileData": null, "code": "ERR101" };

    const inputName = this.parseRequired(options.input_name, 'string', 'Input name is required.');
    const detectPdfScripts = this.parseOptional(options.detectPdfScripts, 'boolean', false);
    const detectSvgScripts = this.parseOptional(options.detectSvgScripts, 'boolean', true);

    const file = this.req.files[inputName];
    output.fileData = file;
    delete output.fileData.data;
    delete output.fileData.mv;
    delete output.fileData.tempFilePath;

    if (!file) {
        output.message = 'File not found.';
        return output;

    }

    let fileMime = detectFilenameMime(file.name);
    let acceptedMime = accepts.split(',').map(item => item.trim());

    let isValidFileMime = acceptedMime.some(mime => {
        // If mime is a wildcard for a type (e.g., application/*, image/*, */*), check for a match
        if (mime === "*/*" || fileMime === mime) {
            return true;
        }

        // Match with wildcard (e.g., application/* matches application/pdf)
        const [type, subtype] = mime.split('/');
        const [fileType, fileSubtype] = fileMime.split('/');

        if (type === "*" || fileType === type) {
            return subtype === "*" || fileSubtype === subtype;
        }

        return false;
    });

    if (!isValidFileMime) {
        output.message = 'File type not allowed.';
        return output;
    }

    const fileBuffer = readFileSync(file.tempFilePath);


    let bufferMime = await detectBufferMime(fileBuffer);
    let formattedFileMime = detectFilenameMime(file.name, bufferMime);

    if (formattedFileMime !== bufferMime) {
        output.message = 'File type not allowed.';
        return output;
    }

    if (fileMime === "application/pdf" && detectPdfScripts) {
        if (hasEmbeddedJavaScript(buffer)) {
            output.code = "ERR102";
            output.message = 'Embedded JavaScript detected.';
            return output;
        }
    }
    if (fileMime === "image/svg+xml" && detectSvgScripts) {
        if (hasMaliciousSVGContent(fileBuffer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           )) {
            output.code = "ERR103";
            output.message = 'Potential XSS risk: Dangerous content found in SVG.';
            return output;
        }
    }

    output.is_valid = true;
    output.code = 0;
    return output;
}


function hasEmbeddedJavaScript(buffer) {
    const text = buffer.toString('latin1'); // PDF is mostly binary but readable
    const patterns = [/\/JavaScript\b/, /\/JS\b/, /\/AA\b/]; // common triggers
    return patterns.some((pattern) => pattern.test(text));
}

function hasMaliciousSVGContent(buffer) {
    const text = buffer.toString('utf8'); // SVG is plain text (XML)
    const patterns = [
        /<script\b/i,                     // Inline <script> tag
        /on\w+="[^"]*"/i,                 // Event handlers like onclick, onload, etc.
        /on\w+='[^']*'/i,                 // Same, with single quotes
        /javascript:/i,                  // javascript: URLs
        /data:text\/html/i,              // Potential data URIs with HTML
        /<[^>]+xlink:href=['"]?javascript:/i // xlink with javascript
    ];
    return patterns.some((pattern) => pattern.test(text));
}
