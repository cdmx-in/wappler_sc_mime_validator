# Wappler Server Connect: MIME Validator

## Created and maintained by Lavi Sidana

## Overview

This `Mime Validator` functionality validates the MIME type of a file uploaded via Wappler's Server Connect. It checks whether the uploaded file matches one or more acceptable MIME types, ensures the file is valid by checking its buffer MIME, and provides additional validation for PDF files, detecting embedded JavaScript if requested.

## Features

- Validates MIME types against a list of accepted types (comma-separated).
- Supports wildcard MIME types (e.g., `image/*`, `application/*`, `*/*`).
- Verifies file buffer MIME type against the file extension.
- Optionally checks PDF files for embedded JavaScript.

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
- `fileData`: The file data object (if valid).
- `code`: A code representing the validation status (`ERR101`, `ERR102`, or `0` for success).

### Error Codes

- `ERR101`: File type not allowed or file missing.
- `ERR102`: PDF file contains embedded JavaScript.
- `ERR103`: SVG file contains embedded JavaScript.


