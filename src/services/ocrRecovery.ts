/**
 * OCR 恢复与严格数值校验（技术方案参考自用户的 TIANSHAN GAS codx 项目）。
 * 原则：不同预处理尝试必须在同一帧像素上达成一致；
 * 绝不使用上一帧的数值来"补全"当前帧缺失的数字或小数点。
 */

import type { OcrRecognitionResult } from '@physics-software-sensors/core';

/** 接受阈值（库的 confidence 为 0–1） */
export const MIN_OCR_CONFIDENCE = 0.65;

/** 严格的数值候选：纯数字（可带小数点、可带 kPa/K 单位后缀），必须为正 */
export function numericCandidate(result: OcrRecognitionResult): number | null {
  if (result.error) return null;
  const text = result.rawText.trim().replace(/\s*(?:kPa|K)$/, '');
  if (!/^[+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 多尝试一致性恢复（多数表决）：
 *  - ≥2 个尝试在同一帧上解析出相同数值 → 采纳，取这些尝试中置信度最高者；
 *  - 没有任何数值获得多数 → 拒绝（confidence 置 0），绝不猜数、
 *    绝不用上一帧数值"补全"当前帧。
 * 相比"要求全部一致"的严格策略，多数表决能挽救"两次读对、一次小数点丢失"
 * 的常见情况，同时单次错误读数永远形不成多数，不会污染数据。
 */
export function recoverOcr(attempts: OcrRecognitionResult[]): OcrRecognitionResult {
  const parsed = attempts.map((a) => numericCandidate(a));

  // 统计每个数值的得票（只在成功解析出数值的尝试之间）
  const counts = new Map<number, number>();
  for (const v of parsed) {
    if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let majority: number | null = null;
  let majorityVotes = 0;
  for (const [v, c] of counts) {
    if (c > majorityVotes) {
      majority = v;
      majorityVotes = c;
    }
  }

  if (majority !== null && majorityVotes >= 2) {
    const agreeing = attempts.filter((a) => numericCandidate(a) === majority);
    const best = agreeing.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
    return {
      ...best,
      details: {
        ...best.details,
        recovery_confirmed: true,
        recovery_votes: majorityVotes,
        attempts: attempts.map((a) => ({
          raw_text: a.rawText,
          confidence: a.confidence,
          preprocess_mode: String(a.details?.preprocess_mode ?? 'auto'),
        })),
      },
    };
  }

  return {
    ...attempts[0],
    confidence: 0,
    warning: '多次识别结果不一致，已跳过（不采用任何单次数值）',
    details: {
      ...attempts[0].details,
      recovery_confirmed: false,
      attempts: attempts.map((a) => ({
        raw_text: a.rawText,
        confidence: a.confidence,
        preprocess_mode: String(a.details?.preprocess_mode ?? 'auto'),
      })),
    },
  };
}
