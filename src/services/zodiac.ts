import type { DotDockState, ZodiacId } from '../types/dotdock';

import ratSvg from '../assets/zodiac/rat.svg';
import oxSvg from '../assets/zodiac/ox.svg';
import tigerSvg from '../assets/zodiac/tiger.svg';
import rabbitSvg from '../assets/zodiac/rabbit.svg';
import dragonSvg from '../assets/zodiac/dragon.svg';
import snakeSvg from '../assets/zodiac/snake.svg';
import horseSvg from '../assets/zodiac/horse.svg';
import sheepSvg from '../assets/zodiac/sheep.svg';
import monkeySvg from '../assets/zodiac/monkey.svg';
import roosterSvg from '../assets/zodiac/rooster.svg';
import dogSvg from '../assets/zodiac/dog.svg';
import pigSvg from '../assets/zodiac/pig.svg';

import ratPixelSvg from '../assets/zodiac/rat-pixel.svg';
import oxPixelSvg from '../assets/zodiac/ox-pixel.svg';
import tigerPixelSvg from '../assets/zodiac/tiger-pixel.svg';
import rabbitPixelSvg from '../assets/zodiac/rabbit-pixel.svg';
import dragonPixelSvg from '../assets/zodiac/dragon-pixel.svg';
import snakePixelSvg from '../assets/zodiac/snake-pixel.svg';
import horsePixelSvg from '../assets/zodiac/horse-pixel.svg';
import sheepPixelSvg from '../assets/zodiac/sheep-pixel.svg';
import monkeyPixelSvg from '../assets/zodiac/monkey-pixel.svg';
import roosterPixelSvg from '../assets/zodiac/rooster-pixel.svg';
import dogPixelSvg from '../assets/zodiac/dog-pixel.svg';
import pigPixelSvg from '../assets/zodiac/pig-pixel.svg';

export interface ZodiacMeta {
  id: ZodiacId;
  index: number;
  koreanName: string;
  ttiLabel: string;
  hanja: string;
  emoji: string;
  accent: string;
  defaultPng: string;
  pixelSvg: string;
}

export const ZODIAC_LIST: ZodiacMeta[] = [
  { id: 'rat', index: 0, koreanName: '쥐', ttiLabel: '쥐띠', hanja: '子', emoji: '🐭', accent: '#9aa5ce', defaultPng: ratSvg, pixelSvg: ratPixelSvg },
  { id: 'ox', index: 1, koreanName: '소', ttiLabel: '소띠', hanja: '丑', emoji: '🐮', accent: '#c08457', defaultPng: oxSvg, pixelSvg: oxPixelSvg },
  { id: 'tiger', index: 2, koreanName: '호랑이', ttiLabel: '호랑이띠', hanja: '寅', emoji: '🐯', accent: '#ff922b', defaultPng: tigerSvg, pixelSvg: tigerPixelSvg },
  { id: 'rabbit', index: 3, koreanName: '토끼', ttiLabel: '토끼띠', hanja: '卯', emoji: '🐰', accent: '#f472b6', defaultPng: rabbitSvg, pixelSvg: rabbitPixelSvg },
  { id: 'dragon', index: 4, koreanName: '용', ttiLabel: '용띠', hanja: '辰', emoji: '🐲', accent: '#10b981', defaultPng: dragonSvg, pixelSvg: dragonPixelSvg },
  { id: 'snake', index: 5, koreanName: '뱀', ttiLabel: '뱀띠', hanja: '巳', emoji: '🐍', accent: '#4ade80', defaultPng: snakeSvg, pixelSvg: snakePixelSvg },
  { id: 'horse', index: 6, koreanName: '말', ttiLabel: '말띠', hanja: '午', emoji: '🐴', accent: '#d97706', defaultPng: horseSvg, pixelSvg: horsePixelSvg },
  { id: 'sheep', index: 7, koreanName: '양', ttiLabel: '양띠', hanja: '未', emoji: '🐑', accent: '#e2e8f0', defaultPng: sheepSvg, pixelSvg: sheepPixelSvg },
  { id: 'monkey', index: 8, koreanName: '원숭이', ttiLabel: '원숭이띠', hanja: '申', emoji: '🐵', accent: '#eab308', defaultPng: monkeySvg, pixelSvg: monkeyPixelSvg },
  { id: 'rooster', index: 9, koreanName: '닭', ttiLabel: '닭띠', hanja: '酉', emoji: '🐔', accent: '#ef4444', defaultPng: roosterSvg, pixelSvg: roosterPixelSvg },
  { id: 'dog', index: 10, koreanName: '개', ttiLabel: '개띠', hanja: '戌', emoji: '🐶', accent: '#f59e0b', defaultPng: dogSvg, pixelSvg: dogPixelSvg },
  { id: 'pig', index: 11, koreanName: '돼지', ttiLabel: '돼지띠', hanja: '亥', emoji: '🐷', accent: '#fb7185', defaultPng: pigSvg, pixelSvg: pigPixelSvg }
];

export function getZodiacById(id: ZodiacId): ZodiacMeta {
  return ZODIAC_LIST.find((z) => z.id === id) ?? ZODIAC_LIST[4];
}

export function getZodiacByBirthYear(year: number): ZodiacMeta {
  const index = (((Math.floor(year) - 4) % 12) + 12) % 12;
  return ZODIAC_LIST[index];
}

export function getZodiacImage(zodiac: ZodiacMeta, style: DotDockState['characterStyle']): string {
  return style === 'pixel' ? zodiac.pixelSvg : zodiac.defaultPng;
}
