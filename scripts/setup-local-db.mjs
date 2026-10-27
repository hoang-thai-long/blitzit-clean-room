import { writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) console.log('.env đã tồn tại, giữ nguyên cấu hình.');
else {
  writeFileSync('.env', `DAYLIGHT_DB_PASSWORD=${randomBytes(24).toString('hex')}\nDAYLIGHT_DB_PORT=54329\n`, { mode: 0o600, flag: 'wx' });
  console.log('Đã tạo .env với password ngẫu nhiên (quyền 0600). Chạy npm run db:up, rồi npm run desktop:local.');
}
