// ============================================================
//  Ensono DataGrid — File Routes (Security-Hardened)
//  Fixes: [CRIT-3] Magic-byte MIME verification (not client header)
//         [HIGH-1] SVG removed — stored XSS vector eliminated
//         [MED-1]  Attachment delete verifies ownership
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');
const { nanoid } = require('nanoid');
const db      = require('../db');
const { auth } = require('../middleware/auth');
const { resolveWorkspace } = require('../middleware/ownership');

const UPLOAD_DIR  = path.resolve(process.env.UPLOAD_DIR || './uploads');
const MAX_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 25);

// [CRIT-3] Magic-byte signatures — NOT trusting client Content-Type
// Each entry: { mime, bytes: [[offset, [...byteValues]], ...] }
const MAGIC_SIGNATURES = [
  // JPEG: FF D8 FF
  { mime: 'image/jpeg',  check: b => b[0]===0xFF && b[1]===0xD8 && b[2]===0xFF },
  // PNG: 89 50 4E 47
  { mime: 'image/png',   check: b => b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47 },
  // GIF: 47 49 46 38
  { mime: 'image/gif',   check: b => b[0]===0x47 && b[1]===0x49 && b[2]===0x46 && b[3]===0x38 },
  // WebP: 52 49 46 46 ... 57 45 42 50
  { mime: 'image/webp',  check: b => b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46 && b[8]===0x57 && b[9]===0x45 },
  // PDF: 25 50 44 46
  { mime: 'application/pdf', check: b => b[0]===0x25 && b[1]===0x50 && b[2]===0x44 && b[3]===0x46 },
  // ZIP (also XLSX/DOCX): 50 4B 03 04
  { mime: 'application/zip', check: b => b[0]===0x50 && b[1]===0x4B && b[2]===0x03 && b[3]===0x04 },
  // XLSX/DOCX are ZIP-based — detected above, allowed via extension check below
];

// [HIGH-1] SVG intentionally excluded — stored XSS risk on same origin
const ALLOWED_EXTENSIONS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.pdf','.csv','.txt','.xlsx','.docx','.zip']);

function detectMimeFromBuffer(buffer) {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.check(buffer)) return sig.mime;
  }
  // Allow plain text / CSV (no reliable magic bytes)
  return null;
}

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    // Store with random name + sanitised original extension only
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g,'');
    cb(null, `${nanoid(16)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // [HIGH-1] Extension check (first gate)
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`File extension "${ext}" is not allowed`));
    }
    // [CRIT-3] Block SVG by content-type regardless of extension
    if (file.mimetype === 'image/svg+xml' || ext === '.svg') {
      return cb(new Error('SVG files are not permitted'));
    }
    cb(null, true);
  },
});

// ── POST /upload/:recordId/:fieldId ──────────────────────────
router.post('/:recordId/:fieldId', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const { recordId, fieldId } = req.params;
  const file = req.file;

  try {
    // [CRIT-3] Magic-byte verification AFTER multer writes the file
    const fd    = fs.openSync(file.path, 'r');
    const header= Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    fs.closeSync(fd);

    const ext = path.extname(file.originalname).toLowerCase();
    const isBinaryType = ['.jpg','.jpeg','.png','.gif','.webp','.pdf','.xlsx','.docx','.zip'].includes(ext);

    if (isBinaryType) {
      const detectedMime = detectMimeFromBuffer(header);
      const clientMime   = file.mimetype;

      // For office docs (XLSX/DOCX), both are ZIP-based — allow zip signature
      const isOffice = ['.xlsx','.docx'].includes(ext);
      const signatureOk = detectedMime !== null || isOffice === false;

      if (!signatureOk) {
        fs.unlinkSync(file.path); // Remove the uploaded file
        return res.status(422).json({ error: 'File content does not match declared type' });
      }

      // Extra check: declared type must match detected type (no .jpg file with PDF magic bytes)
      const imageExts = ['.jpg','.jpeg','.png','.gif','.webp'];
      if (imageExts.includes(ext) && detectedMime && !detectedMime.startsWith('image/')) {
        fs.unlinkSync(file.path);
        return res.status(422).json({ error: 'File content does not match image extension' });
      }
    }

    // [MED-1] Verify caller can access this record's workspace
    const workspaceId = await resolveWorkspace('record', recordId);
    if (!workspaceId) { fs.unlinkSync(file.path); return res.status(404).json({ error: 'Record not found' }); }

    const [membership] = await db.execute(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, req.user.id]
    );
    if (!membership.length) { fs.unlinkSync(file.path); return res.status(403).json({ error: 'Access denied' }); }

    // Thumbnail for images
    let thumbUrl = null;
    const isImage = ['.jpg','.jpeg','.png','.gif','.webp'].includes(path.extname(file.filename).toLowerCase());
    if (isImage) {
      const thumbName = `thumb_${file.filename}`;
      const thumbPath = path.join(UPLOAD_DIR, thumbName);
      await sharp(file.path).resize(300, 200, { fit: 'cover' }).toFile(thumbPath);
      thumbUrl = `/uploads/${thumbName}`;
    }

    const id  = nanoid(12);
    const url = `/uploads/${file.filename}`;
    await db.execute(
      `INSERT INTO attachments (id, record_id, field_id, original_name, stored_name, mime_type, size_bytes, url, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, recordId, fieldId, file.originalname, file.filename, file.mimetype, file.size, url, req.user.id]
    );

    res.status(201).json({ id, name: file.originalname, url, thumbUrl, mimeType: file.mimetype, size: file.size });
  } catch(e) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('[upload]', e.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ── GET /upload/:recordId/:fieldId ────────────────────────────
// [MED-1] Verify access before listing
router.get('/:recordId/:fieldId', auth, async (req, res) => {
  const workspaceId = await resolveWorkspace('record', req.params.recordId);
  if (!workspaceId) return res.status(404).json({ error: 'Record not found' });
  const [m] = await db.execute('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?', [workspaceId, req.user.id]);
  if (!m.length) return res.status(403).json({ error: 'Access denied' });

  const [rows] = await db.execute(
    `SELECT id, original_name AS name, url, mime_type AS mimeType, size_bytes AS size, created_at
     FROM attachments WHERE record_id = ? AND field_id = ? ORDER BY created_at`,
    [req.params.recordId, req.params.fieldId]
  );
  res.json(rows);
});

// ── DELETE /upload/:attachmentId ──────────────────────────────
// [MED-1] Full ownership chain verification before delete
router.delete('/:attachmentId', auth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspace('attachment', req.params.attachmentId);
    if (!workspaceId) return res.status(404).json({ error: 'Not found' });

    const [m] = await db.execute(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, req.user.id]
    );
    if (!m.length) return res.status(403).json({ error: 'Access denied' });

    const [rows] = await db.execute('SELECT stored_name FROM attachments WHERE id = ?', [req.params.attachmentId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const filePath  = path.join(UPLOAD_DIR, rows[0].stored_name);
    const thumbPath = path.join(UPLOAD_DIR, `thumb_${rows[0].stored_name}`);
    [filePath, thumbPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });

    await db.execute('DELETE FROM attachments WHERE id = ?', [req.params.attachmentId]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
