/**
 * QuestionInput — 问题输入 + 4 个生成选项
 */

import { useCallback, useId, useState } from 'react';
import { Sparkles, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { LENGTH_OPTIONS, MODE_OPTIONS, SCENE_OPTIONS, TONE_OPTIONS } from '../zodiac-data';
import type { GenerationOptions } from '../zodiac-types';
import { QUESTION_MAX_LENGTH, QUESTION_MIN_LENGTH } from '../zodiac-types';

const SAMPLE_QUESTIONS: ReadonlyArray<string> = [
  '我是否应该离开稳定但没有成长的工作？',
  '朋友很久不回复消息，应该如何理解和处理？',
  '怎样向同事提出他反复出现的问题？',
  '这款新产品的宣传主题可以怎样设计？',
  '为什么这次项目推进不顺利，复盘一下？',
  '十二星座会怎样理解"稳定比热爱更重要"？',
];

export interface QuestionInputProps {
  options: GenerationOptions;
  onOptionsChange: (next: GenerationOptions) => void;
  onSubmit: (question: string) => void;
  onClear: () => void;
  disabled?: boolean;
  /** 已配 AI 服务时为 true */
  aiConfigured: boolean;
}

export function QuestionInput({
  options,
  onOptionsChange,
  onSubmit,
  onClear,
  disabled = false,
  aiConfigured,
}: QuestionInputProps) {
  const [question, setQuestion] = useState('');
  const lengthId = useId();
  const sceneId = useId();
  const toneId = useId();
  const synthesisId = useId();
  const modeId = useId();
  const trimmed = question.trim();
  const tooShort = trimmed.length < QUESTION_MIN_LENGTH;
  const tooLong = trimmed.length > QUESTION_MAX_LENGTH;
  const canSubmit = !disabled && aiConfigured && !tooShort && !tooLong;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  }, [canSubmit, onSubmit, trimmed]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground" htmlFor="zodiac-question">
            你的问题
          </label>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{trimmed.length} / {QUESTION_MAX_LENGTH}</span>
            {question && (
              <button
                type="button"
                onClick={() => { setQuestion(''); onClear(); }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
                aria-label="清空输入"
              >
                <X className="h-3 w-3" /> 清空
              </button>
            )}
          </div>
        </div>
        <textarea
          id="zodiac-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="例：我是否应该离开稳定但没有成长的工作？"
          rows={4}
          maxLength={QUESTION_MAX_LENGTH}
          disabled={disabled}
          className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        {tooLong && (
          <p className="text-xs text-destructive">问题超出 {QUESTION_MAX_LENGTH} 字上限</p>
        )}
        <div className="flex flex-wrap gap-2">
          {SAMPLE_QUESTIONS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setQuestion(sample)}
              className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              disabled={disabled}
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <OptionGroup
          inputId={modeId}
          label="模式"
          value={options.mode}
          options={MODE_OPTIONS}
          onChange={(value) => {
            const mode = value as GenerationOptions['mode'];
            onOptionsChange({
              ...options,
              mode,
              length: mode === 'fast' ? 'short' : mode === 'deep' ? 'detailed' : options.length,
              includeSynthesis: mode === 'fast' ? false : mode === 'deep' ? true : options.includeSynthesis,
            });
          }}
          disabled={disabled}
        />
        <OptionGroup
          inputId={sceneId}
          label="场景"
          value={options.scene}
          options={SCENE_OPTIONS}
          onChange={(value) => onOptionsChange({ ...options, scene: value as GenerationOptions['scene'] })}
          disabled={disabled}
        />
        <OptionGroup
          inputId={lengthId}
          label="篇幅"
          value={options.length}
          options={LENGTH_OPTIONS}
          onChange={(value) => onOptionsChange({ ...options, length: value as GenerationOptions['length'] })}
          disabled={disabled}
        />
        <OptionGroup
          inputId={toneId}
          label="语气"
          value={options.tone}
          options={TONE_OPTIONS}
          onChange={(value) => onOptionsChange({ ...options, tone: value as GenerationOptions['tone'] })}
          disabled={disabled}
        />
        <div className="space-y-2">
          <label htmlFor={synthesisId} className="text-sm font-medium text-foreground">汇总</label>
          <label
            htmlFor={synthesisId}
            className="flex h-[42px] cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:bg-muted/40"
          >
            <input
              id={synthesisId}
              type="checkbox"
              checked={options.includeSynthesis}
              onChange={(event) => onOptionsChange({ ...options, includeSynthesis: event.target.checked })}
              disabled={disabled || options.mode === 'fast'}
              aria-describedby={`${synthesisId}-hint`}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <span>生成对比总结</span>
          </label>
          <p id={`${synthesisId}-hint`} className="text-xs text-muted-foreground">
            {options.mode === 'fast' ? '快速模式固定关闭总结' : '关闭后只输出 12 个星座视角'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {!aiConfigured && (
            <span className="text-destructive">⚠ 请先在工作台设置中配置 AI 服务（API Key、Base URL、模型）</span>
          )}
          {aiConfigured && (
            <span>预计 {options.mode === 'fast' ? '1' : options.includeSynthesis ? '13' : '12'} 次模型请求 · Ctrl/⌘ + Enter 提交</span>
          )}
        </div>
        <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2">
          <Sparkles className="h-4 w-4" />
          让十二星座回答
        </Button>
      </div>
    </div>
  );
}

interface OptionGroupProps<T extends string> {
  inputId: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}

function OptionGroup<T extends string>({
  inputId,
  label,
  value,
  options,
  onChange,
  disabled,
}: OptionGroupProps<T>) {
  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>
      <select
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        disabled={disabled}
        className="h-[42px] w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} — {option.hint}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {options.find((option) => option.value === value)?.hint}
      </p>
    </div>
  );
}
