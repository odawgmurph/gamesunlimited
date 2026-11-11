/**
 * Type hints for game authors (editors pick these up from JSDoc @type comments).
 * See docs/ADDING_A_GAME.md for a walkthrough.
 */
import type { ComponentType } from 'preact';

export type Setting =
  | { key: string; label: string; type: 'number'; default: number; min?: number; max?: number; step?: number; suffix?: string; help?: string; when?: (v: any) => boolean }
  | { key: string; label: string; type: 'toggle'; default: boolean; help?: string; when?: (v: any) => boolean }
  | { key: string; label: string; type: 'select'; default: string; options: { value: string; label: string }[]; help?: string; when?: (v: any) => boolean };

export interface GameManifest {
  id: string;
  name: string;
  icon: string;
  color: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  rules?: string[];
  settings?: Setting[];
  /** Set false if the game has its own chat and the room chat would leak information. */
  roomChatDuringGame?: boolean;
  load: () => Promise<GameModule>;
}

/** Passed to every logic function. Only ever exists on the host. */
export interface HostContext<Settings = any, Assets = any> {
  now: number;
  random: () => number;
  players: string[];
  settings: Settings;
  assets: Assets;
  name: (id: string) => string;
  isConnected: (id: string) => boolean;
  /** One-off event (sound, animation) to everyone, or to the given member id(s). */
  emit: (event: any, to?: string | string[] | null) => void;
}

export interface GameLogic<State = any> {
  setup(ctx: HostContext): State;
  /** Mutate state in place. Return false if nothing changed. */
  action(state: State, playerId: string, action: any, ctx: HostContext): void | false;
  /** Called ~10x/second. Return false if nothing changed. */
  tick?(state: State, ctx: HostContext): void | false;
  /** A player left the room for good. */
  leave?(state: State, playerId: string, ctx: HostContext): void | false;
  /** What one member may see. viewerId may be a spectator who isn't in ctx.players. */
  view(state: State, viewerId: string, ctx: HostContext): any;
}

export interface GameApi {
  me: string;
  act(action: any): void;
  now(): number;
  onEvent(fn: (event: any) => void): () => void;
  name(id: string): string;
}

export interface GameModule {
  logic: GameLogic;
  View: ComponentType<{ view: any; info: any; api: GameApi; isHost: boolean }>;
  prepare?: () => Promise<any>;
}
