const { detectBufferMime, detectFilenameMime } = require('mime-detect');
const { readFileSync } = require('fs');

exports.mime_validator = async function (options) {
    let accepts = this.parseRequired(options.accepts, 'string', 'A comma seperated list of accepted mime\'s is required.');

    let output = { "is_valid": false, "message": "", "fileData": null, "code": "ERR101" };

    const inputName = this.parseRequired(options.input_name, 'string', 'Input name is required.');
    const detectPdfScripts = this.parseOptional(options.detectPdfScripts, 'boolean', false);

    const file = this.req.files[inputName];
    output.fileData = file;
    delete output.fileData.data;

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

    if (fileMime !== bufferMime) {
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

    output.is_valid = true;
    output.code = 0;
    return output;
}


function hasEmbeddedJavaScript(buffer) {
    const text = buffer.toString('latin1'); // PDF is mostly binary but readable
    const patterns = [/\/JavaScript\b/, /\/JS\b/, /\/AA\b/]; // common triggers
    return patterns.some((pattern) => pattern.test(text));
}
