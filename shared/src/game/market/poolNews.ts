// 正式的消息引擎：用 AI 預先生成並審核過的內容庫（news.data.json）。
// 不從 shared/src/index.ts 匯出（庫很大，客戶端不需要；只有伺服器 import 這個檔案）。
import pool from "./news.data.json";
import { NewsEngine, type NewsPoolItem } from "./news";

export const POOL_NEWS = new NewsEngine(pool as unknown as NewsPoolItem[]);
