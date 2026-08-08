import type { GraphSchema } from './graph-types';

export const GRAPH_SCHEMAS: GraphSchema[] = [
  {
    id: 'general', name: '通用知识', description: '人物、组织、概念、事件与资料',
    nodeTypes: ['人物', '组织', '概念', '事件', '资料'],
    relationTypes: [
      { name: '属于', from: ['人物', '概念'], to: ['组织', '概念'] },
      { name: '参与', from: ['人物', '组织'], to: ['事件'] },
      { name: '引用', from: ['资料', '概念'], to: ['资料', '概念'] },
      { name: '相关', from: ['人物', '组织', '概念', '事件', '资料'], to: ['人物', '组织', '概念', '事件', '资料'] },
    ],
  },
  {
    id: 'software', name: '软件工程', description: '模块、组件、接口、数据与依赖',
    nodeTypes: ['系统', '模块', '组件', '接口', '数据库', '技术', '文件'],
    relationTypes: [
      { name: '依赖', from: ['系统', '模块', '组件'], to: ['模块', '组件', '技术'] },
      { name: '调用', from: ['模块', '组件'], to: ['接口', '模块', '组件'] },
      { name: '读写', from: ['模块', '组件'], to: ['数据库'] },
      { name: '包含', from: ['系统', '模块'], to: ['模块', '组件', '接口', '文件'] },
      { name: '实现', from: ['模块', '组件'], to: ['接口'] },
    ],
  },
  {
    id: 'project', name: '项目管理', description: '项目、任务、人员、决策与风险',
    nodeTypes: ['项目', '任务', '人员', '决策', '风险', '里程碑'],
    relationTypes: [
      { name: '负责', from: ['人员'], to: ['项目', '任务'] },
      { name: '包含', from: ['项目'], to: ['任务', '里程碑', '风险'] },
      { name: '依赖', from: ['任务'], to: ['任务', '决策'] },
      { name: '影响', from: ['风险', '决策'], to: ['项目', '任务', '里程碑'] },
    ],
  },
  {
    id: 'research', name: '阅读研究', description: '书籍、作者、观点、证据与主题',
    nodeTypes: ['书籍', '作者', '观点', '证据', '主题'],
    relationTypes: [
      { name: '创作', from: ['作者'], to: ['书籍'] },
      { name: '提出', from: ['作者', '书籍'], to: ['观点'] },
      { name: '支持', from: ['证据'], to: ['观点'] },
      { name: '反驳', from: ['证据', '观点'], to: ['观点'] },
      { name: '属于', from: ['书籍', '观点'], to: ['主题'] },
    ],
  },
];
