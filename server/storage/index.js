/**
 * Blob storage behind one tiny interface: put(key, buffer, mimeType), get(key) -> Readable, remove(key).
 * STORAGE_DRIVER=local (default, ./uploads) or s3 (AWS S3 / MinIO / R2 via S3_* env vars).
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const local = {
    async put(key, buffer) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        await fs.promises.writeFile(path.join(UPLOAD_DIR, path.basename(key)), buffer);
    },
    async get(key) {
        return fs.createReadStream(path.join(UPLOAD_DIR, path.basename(key)));
    },
    async remove(key) {
        await fs.promises.rm(path.join(UPLOAD_DIR, path.basename(key)), { force: true });
    },
};

const makeS3 = () => {
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const Bucket = process.env.S3_BUCKET;
    if (!Bucket) throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET');
    const client = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT || undefined,   // MinIO / R2
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        credentials: process.env.S3_ACCESS_KEY_ID
            ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
            : undefined,
    });
    return {
        async put(key, buffer, mimeType) {
            await client.send(new PutObjectCommand({ Bucket, Key: key, Body: buffer, ContentType: mimeType }));
        },
        async get(key) {
            const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
            return out.Body instanceof Readable ? out.Body : Readable.from(out.Body);
        },
        async remove(key) {
            await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
        },
    };
};

const driver = process.env.STORAGE_DRIVER === 's3' ? makeS3() : local;

module.exports = driver;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
