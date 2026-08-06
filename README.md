# 🛡️ Wappler Server Connect — MIME Validator

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://opensource.org/licenses/MIT)
[![Wappler](https://img.shields.io/badge/Wappler-Server%20Connect-8A2BE2)](https://wappler.io)

> Validate uploaded files by what they **are**, not just what they're **named**.

Created and maintained by **Lavi Sidana**.

---

## 📖 Overview

This extension validates the MIME type of files uploaded via Wappler's Server Connect. It checks the file **extension** and the actual **content** (magic-byte sniffing via `file(1)`) against your accept list, rejects files whose content doesn't match their name, validates CSV structure, and optionally scans PDFs and SVGs for embedded scripts.

## ✨ Features

- ✅ **Accept-list validation** — comma-separated MIME types with wildcard support (`image/*`, `application/*`, `*/*`)
- 🔬 **Content sniffing** — the file's real MIME type is detected from its bytes, not trusted from the request
- 🎭 **Spoof detection** — content that doesn't match the file extension is rejected (`ERR104`), with smart tolerance for formats sniffing can't tell apart (plain-text families, ZIP-based documents like `docx`/`xlsx`/`odt`, legacy Office OLE files)
- 📊 **CSV structure check** — files named `.csv` must actually parse as CSV
- 📄 **PDF script scan** *(optional)* — detects embedded JavaScript actions
- 🖼️ **SVG script scan** *(on by default)* — detects `<script>`, event handlers, and `javascript:` URLs
- 📦 **Single & multiple uploads** — one action for each, with per-file results and SHA-256 hashes for batches

## 🔍 How validation flows

Each file passes through these gates in order — the first failure wins:

| # | Gate | Failure code |
|---|------|:---:|
| 1️⃣ | File present in the input field | `ERR101` |
| 2️⃣ | Temp file readable | `ERR102` |
| 3️⃣ | Extension MIME in accept list | `ERR103` |
| 4️⃣ | Content matches extension | `ERR104` |
| 5️⃣ | Content MIME in accept list | `ERR105` |
| 6️⃣ | `.csv` files have CSV structure | `ERR106` |
| 7️⃣ | PDF free of embedded JavaScript *(if enabled)* | `ERR107` |
| 8️⃣ | SVG free of dangerous content *(if enabled)* | `ERR108` |

## ⚙️ Actions

### 🗂️ Mime Validator (single file)

#### Parameters

| Parameter | Required | Default | Description |
|-----------|:---:|:---:|-------------|
| **Accepts** | ✅ | — | Comma-separated list of acceptable MIME types, e.g. `image/jpeg, image/png` |
| **Input Name** | ✅ | — | Name of the file input field in the request, e.g. `input_name[]` |
| **Detect PDF Scripts** | — | ☐ off | Scan PDFs for embedded JavaScript |
| **Detect SVG Scripts** | — | ☑ on | Scan SVGs for embedded JavaScript / XSS vectors |
| **Output** | — | ☐ off | Return the result object described below |

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `is_valid` | boolean | Whether the file passed all checks |
| `message` | string | Human-readable validation result |
| `error_code` | string | `ERR101`–`ERR108` (see [Error Codes](#-error-codes)); empty string when valid |
| `fileData` | object | `name`, `size`, `encoding`, `mimetype`, `md5` |

### 🗃️ Multiple Mime Validator

Validates a batch of uploads and returns a result for **each** file.

#### Parameters

Same as the single validator — **Input Name** should point to a multi-file input.

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `is_valid` | boolean | `true` only when **all** files are valid |
| `message` | string | Overall validation result |
| `error_code` | string | `ERR101` when no files uploaded, `ERR109` when any file failed, empty when all valid |
| `filesData` | array | Per-file results: `is_valid`, `message`, `error_code`, and `fileData` (`name`, `size`, `encoding`, `mimetype`, `md5`, `sha256`, `truncated`) |

#### 💡 Example output

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

## 🚨 Error Codes

| Code | Meaning |
|------|---------|
| `ERR101` | No file was uploaded in the given input field |
| `ERR102` | Unable to read the uploaded file |
| `ERR103` | The file extension resolves to a MIME type outside the accepted list |
| `ERR104` | The file content does not match its extension ¹ |
| `ERR105` | The detected file content MIME type is outside the accepted list |
| `ERR106` | The file has a CSV extension, but its content is not valid CSV data |
| `ERR107` | The PDF contains embedded JavaScript |
| `ERR108` | The SVG contains potentially dangerous content |
| `ERR109` | One or more files in the batch failed validation *(multiple validator only)* |

✅ On success, `error_code` is an empty string.

> ¹ Mismatches are tolerated within format families that content sniffing cannot tell apart: plain-text formats (sniffed as `text/plain`), ZIP-based documents such as `docx`/`xlsx`/`pptx`/`odt`/`epub` (sniffed as `application/zip`), and legacy Office documents such as `doc`/`xls`/`ppt` (sniffed as `application/x-ole-storage`/`CDFV2`).

## 🧪 Testing

The test suite uses Node's built-in test runner and real content sniffing — no extra dev dependencies:

```bash
npm test
```

## 🐳 Known Issues (Docker)

**Error:**
```
Error: /bin/sh: 1: file: not found
```

**Solution:** the extension relies on the `file` utility for content sniffing. Add it to your Dockerfile:

```dockerfile
RUN apt-get update && apt-get install -y file
```
