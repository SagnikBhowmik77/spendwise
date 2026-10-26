import * as exporter from '../services/export.service.js';

const attachment = (res, type, filename) => {
  res.set({
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
};

export async function csv(req, res) {
  attachment(res, 'text/csv; charset=utf-8', exporter.exportFilename('csv'));
  await exporter.writeCsv(req.space._id, req.valid.query, res);
}

export async function pdf(req, res) {
  // Checked before any bytes are sent, so a too-large export still gets a normal JSON error.
  await exporter.countForPdf(req.space._id, req.valid.query);
  attachment(res, 'application/pdf', exporter.exportFilename('pdf'));
  await exporter.writePdf(req.space, req.user, req.valid.query, res);
}
