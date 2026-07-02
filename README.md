# Certificate Metadata Checker

A static browser website that compares uploaded PDF metadata with the metadata
pattern shared by the 41 reference certificates in `/Users/li/Downloads/real`.

The files are processed locally in the browser. They are not sent to a server.

## Match rules

The creation and modification dates are deliberately ignored. A file matches
when all of these metadata markers pass:

- `Creator`: `pdf-lib (https://github.com/Hopding/pdf-lib)`
- `Producer`: `pdf-lib (https://github.com/Hopding/pdf-lib)`
- `CategoryCode`: `1.6`
- `IssueCode`: `4`
- `VerifyCode`: `1.1`
- `VersionCode`: `1`
- `CertID`: a 48-byte Base64 ID followed by `:0`
- `Other`: JSON containing `DDLanguage: Chinese`, `DDRelease: v2`, and a
  32-byte Base64 hash

This is a format comparison, not cryptographic or issuing-authority
verification. PDF metadata can be copied or edited.

## Run locally

The PDF worker requires an HTTP server; do not open `index.html` directly.

```bash
cd /Users/li/Documents/checkweb
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Put it online

This is a static site, so it can be deployed to GitHub Pages, Netlify, Cloudflare
Pages, or another static host. Upload these files:

- `index.html`
- `styles.css`
- `app.js`
- `vendor/`

No server, database, or runtime CDN connection is required. PDF.js 5.4.624 and
ExcelJS 4.4.0 are pinned under `vendor/`; their license files are included.
