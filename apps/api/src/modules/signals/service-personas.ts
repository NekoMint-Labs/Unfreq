import personasData from "../../config/personas.json" with { type: "json" };
import type { SignalPersona } from "./types.js";

export const personas = personasData.personas as SignalPersona[];

export function pickPersonas(count: number, offset = 0): SignalPersona[] {
  if (count <= 0 || personas.length === 0) {
    return [];
  }

  return Array.from({ length: count }, (_, index) => {
    return personas[(index + offset) % personas.length];
  });
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function toPersonaGuestKey(persona: SignalPersona): string {
  return `ai-persona:${persona.id}`;
}
