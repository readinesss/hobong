/** 번들에 포함된 캐릭터 규칙(data/character.json) */
import raw from '../../../data/character.json';
import type { CharacterRules } from './look.ts';

export const characterRules = raw as unknown as CharacterRules;
