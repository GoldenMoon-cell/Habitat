import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearPersonas,
  defaultPersonas,
  loadPersonas,
  nextPersonaId,
  savePersonas,
} from "../data/personaStore";
import type { Persona, PersonaId } from "../data/personas";

/**
 * 角色是运行时数据，不是编译时常量。
 *
 * 组件通过 usePersonas() 拿：
 *   personas  有序列表（第二栏按这个渲染）
 *   map       id → Persona 查表（气泡、雷达、记忆都用它）
 *   add/update/remove  改完立刻落盘
 */

interface PersonaStore {
  personas: Persona[];
  map: Record<string, Persona>;
  add: (p: Omit<Persona, "id"> & { id?: string }) => Persona;
  update: (id: PersonaId, patch: Partial<Persona>) => void;
  remove: (id: PersonaId) => void;
  /** 整批替换：新手引导选定初始数据时用 */
  replaceAll: (list: Persona[]) => void;
  reset: () => void;
  /** 是否还是出厂状态（用来判断要不要跑新手引导） */
  isPristine: boolean;
}

const Ctx = createContext<PersonaStore | null>(null);

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [personas, setPersonas] = useState<Persona[]>(() => loadPersonas());

  const commit = useCallback((next: Persona[]) => {
    setPersonas(next);
    savePersonas(next);
  }, []);

  const map = useMemo(
    () => Object.fromEntries(personas.map((p) => [p.id, p])) as Record<string, Persona>,
    [personas]
  );

  const add = useCallback(
    (p: Omit<Persona, "id"> & { id?: string }) => {
      const created = {
        ...p,
        id: (p.id ?? nextPersonaId(personas)) as PersonaId,
      } as Persona;
      commit([...personas, created]);
      return created;
    },
    [personas, commit]
  );

  const update = useCallback(
    (id: PersonaId, patch: Partial<Persona>) => {
      commit(personas.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    [personas, commit]
  );

  const remove = useCallback(
    (id: PersonaId) => {
      commit(personas.filter((p) => p.id !== id));
    },
    [personas, commit]
  );

  const reset = useCallback(() => {
    clearPersonas();
    setPersonas(defaultPersonas());
  }, []);

  const replaceAll = useCallback(
    (list: Persona[]) => {
      commit(list);
    },
    [commit]
  );

  /* 出厂状态 = 和默认列表逐 id 一致，且没有任何自定义角色 */
  const isPristine = useMemo(() => {
    const def = defaultPersonas();
    if (personas.length !== def.length) return false;
    return def.every((d, i) => personas[i]?.id === d.id);
  }, [personas]);

  const value: PersonaStore = {
    personas,
    map,
    add,
    update,
    remove,
    replaceAll,
    reset,
    isPristine,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePersonas(): PersonaStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePersonas 必须在 <PersonaProvider> 内使用");
  return v;
}
