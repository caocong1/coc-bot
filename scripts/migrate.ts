/**
 * 数据库迁移脚本
 *
 * 当前版本初始化：
 * - characters
 * - active_cards
 */

import { migrateCoreSchema, openDatabase, resolveDatabasePath } from '../src/storage/Database';

const dbPath = resolveDatabasePath();
const db = openDatabase(dbPath);

try {
  migrateCoreSchema(db);
  console.log(`[migrate] done: ${dbPath}`);
} finally {
  db.close();
}

