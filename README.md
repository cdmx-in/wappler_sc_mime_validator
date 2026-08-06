# Wappler Server Connect: MIME Validator

## Created and maintained by Lavi Sidana

## Overview

This `Mime Validator` functionality validates the MIME type of a file uploaded via Wappler's Server Connect. It checks whether the uploaded file matches one or more acceptable MIME types, ensures the file is valid by checking its buffer MIME, and provides additional validation for PDF files, detecting embedded JavaScript if requested.

## Features

- Validates MIME types against a list of accepted types (comma-separated).
- Supports wildcard MIME types (e.g., `image/*`, `application/*`, `*/*`).
- Verifies file buffer MIME type against the file extension.
- Optionally checks PDF files for embedded JavaScript.
- **Supports both single and multiple file uploads.**

## Functionality

### `Mime Validator`

Validates the uploaded file's MIME type and ensures the file is safe for use.

#### Parameters
  - `Accepts` (required): A comma-separated list of acceptable MIME types. Example: `"image/jpeg, image/png"`.
  - `Input Name` (required): The name of the file input field in the request.it should be a string e.g `input_name[]`
  - `Detect PDF Scripts`: If `checked`, the extension checks for embedded JavaScript in PDF files.
  - `Detect SVG Scripts`: If `checked`, the extension checks for embedded JavaScript in SVG files.
  - `Output`: If`checked`, it returns the object described below.

#### Returns

An object containing the following properties:
- `is_valid`: A boolean indicating whether the file is valid.
- `message`: A message describing the validation result.
- `fileData`: The file data object.
- `error_code`: An error code (`ERR101`–`ERR108`, see [Error Codes](#error-codes)); empty string when the file is valid.

### `Multiple Mime Validator`

Validates the MIME type and content of multiple uploaded files, returning validation results for each file.

#### Parameters
  - `Accepts` (required): A comma-separated list of acceptable MIME types. Example: `"image/jpeg, image/png"`.
  - `Input Name` (required): The name of the file input field in the request (should accept multiple files).
  - `Detect PDF Scripts`: If `checked`, the extension checks for embedded JavaScript in PDF files.
  - `Detect SVG Scripts`: If `checked`, the extension checks for embedded JavaScript in SVG files.
  - `Output`: If`checked`, it returns the object described below.

#### Returns

An object containing the following properties:
- `is_valid`: A boolean indicating whether all files are valid.
- `message`: A message describing the overall validation result.
- `filesData`: An array of objects, each representing the validation result for a file. Each object contains:
  - `is_valid`: Boolean for that file
  - `message`: Validation message for that file
  - `error_code`: Error code for that file (`ERR101`–`ERR108`); empty string when valid
  - `fileData`: File data object (name, size, encoding, mimetype, md5, sha256, truncated)
- `error_code`: The overall status: `ERR101` when no files were uploaded, `ERR109` when any file failed, empty string when all files are valid

#### Example Output
```json
{
  "is_valid": false,
  "message": "Some files failed validation",
  "error_code": "ERR109",
  "filesData": [
    {
      "is_valid": true,
      "message": "",
      "error_code": "",
      "fileData": {
        "name": "file1.pdf",
        "size": 12345,
        "encoding": "7bit",
        "mimetype": "application/pdf",
        "md5": "abc123...",
        "sha256": "28505cfe...",
        "truncated": false
      }
    },
    {
      "is_valid": false,
      "message": "File type \"application/x-msdos-program\" is not allowed by the accepted MIME types.",
      "error_code": "ERR103",
      "fileData": {
        "name": "file2.exe",
        "size": 54321,
        "encoding": "7bit",
        "mimetype": "application/x-msdownload",
        "md5": "def456...",
        "sha256": "28505cfe...",
        "truncated": false
      }
    }
  ]
}
```

### Error Codes

- `ERR101`: No file was uploaded in the given input field.
- `ERR102`: Unable to read the uploaded file.
- `ERR103`: The file extension resolves to a MIME type outside the accepted list.
- `ERR104`: The file content does not match its extension. Mismatches are tolerated within format families that content sniffing cannot tell apart: plain-text formats (sniffed as `text/plain`), ZIP-based documents such as docx/xlsx/pptx/odt/epub (sniffed as `application/zip`), and legacy Office documents such as doc/xls/ppt (sniffed as `application/x-ole-storage`/`CDFV2`).
- `ERR105`: The detected file content MIME type is outside the accepted list.
- `ERR106`: The file has a CSV extension, but its content is not valid CSV data.
- `ERR107`: The PDF contains embedded JavaScript.
- `ERR108`: The SVG contains potentially dangerous content.
- `ERR109`: One or more files in the batch failed validation (multiple validator only).

On success, `error_code` is an empty string.

---

## Known Issues (Docker)

**Error:**
```
Error: /bin/sh: 1: file: not found
```

**Solution:**
Add the following to your Dockerfile to install the required `file` utility:

```
RUN apt-get update && apt-get install -y file
```


