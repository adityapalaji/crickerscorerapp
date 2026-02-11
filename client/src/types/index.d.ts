export type Player = { id: string; name?: string; [k: string]: any };
export type Team = {
  id: string;
  name?: string;
  players?: Record<string, Player>;
  roster?: string[];
  [k: string]: any;
};
