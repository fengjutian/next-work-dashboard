import type { Prompt } from '../types';

import { prompts_writing } from './writing';
import { prompts_analysis } from './analysis';
import { prompts_programming } from './programming';
import { prompts_translation } from './translation';
import { prompts_marketing } from './marketing';
import { prompts_design } from './design';
import { prompts_general } from './general';

export const DEFAULT_PROMPTS: Prompt[] = [
  ...prompts_writing,
  ...prompts_analysis,
  ...prompts_programming,
  ...prompts_translation,
  ...prompts_marketing,
  ...prompts_design,
  ...prompts_general,
];
