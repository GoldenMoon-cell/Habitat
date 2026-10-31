import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  loadGroups,
  nextGroupId,
  saveGroups,
  type Group,
} from "../data/groups";
import type { ConvId } from "../data/mock";
import type { PersonaId } from "../data/personas";

import { usePersonas } from "./personas";

interface GroupStore {
  groups: Group[];
  get: (id: ConvId) => Group | undefined;
  create: (name: string, members: PersonaId[]) => Group | null;
  remove: (id: ConvId) => void;
  rename: (id: ConvId, name: string) => void;
  setMembers: (id: ConvId, members: PersonaId[]) => void;
  /** 改群消息历史上限（k） */
  setCtxMax: (id: ConvId, ctxMax: number) => void;
}

const Ctx = createContext<GroupStore | null>(null);

export function GroupProvider({ children }: { children: ReactNode }) {
  const { personas } = usePersonas();

  const [groups, setGroups] = useState<Group[]>(() => {
    const saved = loadGroups();
    if (saved.length > 0) return saved;
    /* 没有存档：给一个默认群，成员取前三个角色。
       旧版本用户会通过新手引导导入完整数据，这里的默认值只是兜底。 */
    return [
      {
        id: "group" as ConvId,
        name: "生境之家",
        members: personas.slice(0, 3).map((p) => p.id),
        at: Date.now(),
      },
    ];
  });

  const commit = useCallback((next: Group[]) => {
    setGroups(next);
    saveGroups(next);
  }, []);

  const get = useCallback(
    (id: ConvId) => groups.find((g) => g.id === id),
    [groups]
  );

  const create = useCallback(
    (name: string, members: PersonaId[]) => {
      if (members.length < 1) return null;
      const g: Group = {
        id: nextGroupId(groups) as ConvId,
        name: name.trim() || "新群聊",
        members,
        at: Date.now(),
      };
      commit([...groups, g]);
      return g;
    },
    [groups, commit]
  );

  const remove = useCallback(
    (id: ConvId) => commit(groups.filter((g) => g.id !== id)),
    [groups, commit]
  );

  const rename = useCallback(
    (id: ConvId, name: string) =>
      commit(groups.map((g) => (g.id === id ? { ...g, name } : g))),
    [groups, commit]
  );

  const setMembers = useCallback(
    (id: ConvId, members: PersonaId[]) =>
      commit(groups.map((g) => (g.id === id ? { ...g, members } : g))),
    [groups, commit]
  );

  const setCtxMax = useCallback(
    (id: ConvId, ctxMax: number) =>
      commit(groups.map((g) => (g.id === id ? { ...g, ctxMax } : g))),
    [groups, commit]
  );

  const value: GroupStore = useMemo(
    () => ({ groups, get, create, remove, rename, setMembers, setCtxMax }),
    [groups, get, create, remove, rename, setMembers, setCtxMax]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGroups(): GroupStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGroups 必须在 <GroupProvider> 内使用");
  return v;
}
