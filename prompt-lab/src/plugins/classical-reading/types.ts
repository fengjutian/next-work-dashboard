// 古文阅读插件 — 本地类型定义
// 与 src/db 的 ClassicalReading 保持一致；此文件用于插件内部消费时的强类型。

import type { ClassicalReading } from '@/db';

export type ClassicalReadingStatus = 'success' | 'error';

export type ClassicalReadingRecord = ClassicalReading;
