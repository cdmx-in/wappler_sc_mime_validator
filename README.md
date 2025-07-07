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
  - `Input Name` (required): The name of the file input field in the request.
  - `Detect PDF Scripts`: If `checked`, the extension checks for embedded JavaScript in PDF files.
  - `Detect SVG Scripts`: If `checked`, the extension checks for embedded JavaScript in SVG files.
  - `Output`: If`checked`, it returns the object described below.

#### Returns

An object containing the following properties:
- `is_valid`: A boolean indicating whether the file is valid.
- `message`: A message describing the validation result.
- `fileData`: The file data object.
- `code`: A code representing the validation status (`ERR101`, `ERR102`, or `0` for success).

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
  - `code`: Status code for that file
  - `filesData`: Array with a single file data object (name, size, encoding, mimetype, md5, truncated)
- `code`: A code representing the overall validation status (`ERR101`, `ERR102`, `ERR103`, or `0` for success)

#### Example Output
```json
{
  "is_valid": true,
  "message": "All files validated successfully",
  "code": 0,
  "filesData": [
    {
      "is_valid": true,
      "message": "File validation successful",
      "code": 0,
      "filesData": [
        {
          "name": "file1.pdf",
          "size": 12345,
          "encoding": "7bit",
          "mimetype": "application/pdf",
          "md5": "abc123...",
          "truncated": false
        }
      ]
    },
    {
      "is_valid": false,
      "message": "File type not allowed (content).",
      "code": "ERR101",
      "filesData": [
        {
          "name": "file2.exe",
          "size": 54321,
          "encoding": "7bit",
          "mimetype": "application/x-msdownload",
          "md5": "def456...",
          "truncated": false
        }
      ]
    }
  ]
}
```

### Error Codes

- `ERR101`: File type not allowed or file missing.
- `ERR102`: PDF file contains embedded JavaScript.
- `ERR103`: SVG file contains embedded JavaScript.

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


