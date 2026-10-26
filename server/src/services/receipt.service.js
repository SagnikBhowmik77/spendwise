import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { Transaction } from '../models/index.js';
import { logActivity } from './activity.service.js';
import { describeTx } from './transaction.service.js';

// Receipt photos live in MongoDB GridFS (bucket "receipts"). The app compresses them before upload.
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'receipts' });
const NOT_FOUND = () => new HttpError(404, 'transaction_not_found', 'Transaction not found');

// Trust the file's first bytes, not the Content-Type header.
function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function liveTx(spaceId, id) {
  if (!mongoose.isValidObjectId(id)) throw NOT_FOUND();
  const tx = await Transaction.findOne({ _id: id, space: spaceId, deletedAt: null });
  if (!tx) throw NOT_FOUND();
  return tx;
}

async function deleteFile(id) {
  try { await bucket().delete(id); } catch { /* already gone */ }
}

export async function upload({ space, user }, txId, body) {
  const tx = await liveTx(space._id, txId);
  const buf = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  if (!buf.length) throw new HttpError(400, 'no_file', 'Send a JPEG, PNG or WebP image');
  if (buf.length > MAX_RECEIPT_BYTES) throw new HttpError(413, 'too_large', 'That file is too big (2 MB at most)');
  const contentType = imageType(buf);
  if (!contentType) throw new HttpError(400, 'unsupported_image', 'Only JPEG, PNG or WebP images can be attached');

  const id = await new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(`receipt-${tx._id}`, {
      metadata: { space: space._id, transaction: tx._id, contentType },
    });
    stream.once('finish', () => resolve(stream.id));
    stream.once('error', reject);
    stream.end(buf);
  });
  const old = tx.receipt;
  tx.receipt = id;
  await tx.save();
  if (old) await deleteFile(old);
  await logActivity({ space: space._id, user: user._id, entity: 'transaction', entityId: tx._id, action: 'update', summary: `Attached a receipt to ${describeTx(tx)}` });
  return { bytes: buf.length, contentType };
}

export async function stream(spaceId, txId, res) {
  const tx = await liveTx(spaceId, txId);
  if (!tx.receipt) throw new HttpError(404, 'no_receipt', 'This entry has no receipt');
  const [file] = await bucket().find({ _id: tx.receipt }).toArray();
  if (!file) throw new HttpError(404, 'no_receipt', 'This entry has no receipt');
  res.set({ 'Content-Type': file.metadata.contentType, 'Content-Length': file.length, 'Cache-Control': 'private, max-age=3600' });
  await new Promise((resolve, reject) => {
    bucket().openDownloadStream(file._id).on('error', reject).on('end', resolve).pipe(res);
  });
}

export async function remove({ space, user }, txId) {
  const tx = await liveTx(space._id, txId);
  if (!tx.receipt) throw new HttpError(404, 'no_receipt', 'This entry has no receipt');
  const old = tx.receipt;
  tx.receipt = null;
  await tx.save();
  await deleteFile(old);
  await logActivity({ space: space._id, user: user._id, entity: 'transaction', entityId: tx._id, action: 'update', summary: `Removed the receipt from ${describeTx(tx)}` });
}

// Photos whose entry is gone for good (purged after the undo window, or a deleted space).
export async function removeOrphanReceipts() {
  if (mongoose.connection.readyState !== 1) return 0;
  const files = await bucket().find({}, { projection: { _id: 1, 'metadata.transaction': 1 } }).toArray();
  if (!files.length) return 0;
  const live = new Set((await Transaction.find({ receipt: { $in: files.map((f) => f._id) } }).select('receipt').lean()).map((t) => String(t.receipt)));
  const orphans = files.filter((f) => !live.has(String(f._id)));
  for (const f of orphans) await deleteFile(f._id);
  return orphans.length;
}

export async function purgeSpaceReceipts(spaceId) {
  const files = await bucket().find({ 'metadata.space': spaceId }, { projection: { _id: 1 } }).toArray();
  for (const f of files) await deleteFile(f._id);
}

// Ids of the photos stored for a space (a restored backup keeps the links to photos still here).
export async function spaceReceiptIds(spaceId) {
  const files = await bucket().find({ 'metadata.space': spaceId }, { projection: { _id: 1 } }).toArray();
  return new Set(files.map((f) => String(f._id)));
}
