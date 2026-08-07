// ── Skill Slice — zustand 状态管理 ──

import type { StoreApi } from 'zustand';
import type { Skill } from '@/core/skill';
import { loadSkillFromGitHub } from '@/core/skill';
import {
  isDbReady,
  dbLoadSkills,
  dbInsertSkill,
  dbUpdateSkill,
  dbDeleteSkill,
} from '@/db';

export interface SkillSlice {
  skills: Skill[];
  /** 绑定了技能的 session id 集合（全局 UI 状态，实际绑定在 Session 级别） */
  importSkillFromGitHub: (githubUrl: string) => Promise<Skill>;
  toggleSkill: (id: string) => void;
  deleteSkill: (id: string) => void;
  loadSkillsFromDb: () => void;
}

export function createSkillSlice<T extends SkillSlice>(set: StoreApi<T>['setState']): SkillSlice {
  return {
    skills: [],

    importSkillFromGitHub: async (githubUrl) => {
      const loaded = await loadSkillFromGitHub(githubUrl);
      const now = Date.now();
      const newSkill: Skill = {
        id: `sk-${now}`,
        ...loaded,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };

      if (isDbReady()) dbInsertSkill(newSkill);

      set((state) => ({
        skills: [...state.skills, newSkill],
      }) as Partial<T>);

      return newSkill;
    },

    toggleSkill: (id) => {
      set((state) => {
        const updated = state.skills.map((s) =>
          s.id === id ? { ...s, enabled: !s.enabled, updatedAt: Date.now() } : s,
        );
        const target = updated.find((s) => s.id === id);
        if (target && isDbReady()) {
          dbUpdateSkill(id, { enabled: target.enabled, updatedAt: target.updatedAt });
        }
        return { skills: updated } as Partial<T>;
      });
    },

    deleteSkill: (id) => {
      if (isDbReady()) dbDeleteSkill(id);
      set((state) => ({
        skills: state.skills.filter((s) => s.id !== id),
      }) as Partial<T>);
    },

    loadSkillsFromDb: () => {
      if (!isDbReady()) return;
      try {
        const skills = dbLoadSkills();
        if (skills.length > 0) set({ skills } as Partial<T>);
      } catch (err) {
        console.warn('[store] Failed to load skills from DB:', err);
      }
    },
  };
}
