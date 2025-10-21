import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

async function main() {
  dotenv.config({ path: '.env.local' });
  const uri = process.env.MONGODB_URI;
  const dbname = process.env.MONGODB_DBNAME || 'creative_workbench';
  if (!uri) {
    console.error('MONGODB_URI 未设置，请在 creative-workbench/.env.local 中配置。');
    process.exit(1);
  }

  const client = new MongoClient(uri, {
    maxPoolSize: 10,
  });

  try {
    await client.connect();
    const db = client.db(dbname);
    const coll = db.collection('reference_images');

    console.log('开始在 reference_images 创建/确保索引...');

    const created = [];

    const idx1 = await coll.createIndex({ user_id: 1, created_at: -1 }, { name: 'user_id_1_created_at_-1' });
    created.push(idx1);

    const idx2 = await coll.createIndex({ label: 1, created_at: -1 }, { name: 'label_1_created_at_-1' });
    created.push(idx2);

    const idx3 = await coll.createIndex({ labels: 1, created_at: -1 }, { name: 'labels_1_created_at_-1' });
    created.push(idx3);

    // 保留已有的 created_at 索引即可，无需删除

    console.log('索引处理完成，结果如下:');
    for (const name of created) {
      console.log('  -', name);
    }

    const indexes = await coll.indexes();
    console.log('\n当前 reference_images 索引列表:');
    for (const idx of indexes) {
      console.log(JSON.stringify(idx));
    }
  } catch (err) {
    console.error('创建索引失败:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();