import fs from 'node:fs';
import path from 'node:path';
const p = process.env.DB_PATH || path.join(process.cwd(), 'data', 'nmchv-student.db');
for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
console.log('База удалена:', p);
