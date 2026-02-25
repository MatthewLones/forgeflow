import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

/* ── State ────────────────────────────────────────────────── */

interface DagState {
  collapsed: boolean;
  breadcrumb: string[];
}

/* ── Actions ──────────────────────────────────────────────── */

type DagAction =
  | { type: 'TOGGLE' }
  | { type: 'DRILL_IN'; nodeId: string }
  | { type: 'DRILL_OUT' }
  | { type: 'DRILL_ROOT' };

const initialState: DagState = {
  collapsed: false,
  breadcrumb: [],
};

function dagReducer(state: DagState, action: DagAction): DagState {
  switch (action.type) {
    case 'TOGGLE':
      return { ...state, collapsed: !state.collapsed };
    case 'DRILL_IN':
      return { ...state, breadcrumb: [...state.breadcrumb, action.nodeId] };
    case 'DRILL_OUT':
      return { ...state, breadcrumb: state.breadcrumb.slice(0, -1) };
    case 'DRILL_ROOT':
      return { ...state, breadcrumb: [] };
    default:
      return state;
  }
}

/* ── Context ──────────────────────────────────────────────── */

interface DagContextValue {
  dagCollapsed: boolean;
  dagBreadcrumb: string[];
  toggleDag: () => void;
  dagDrillIn: (nodeId: string) => void;
  dagDrillOut: () => void;
  dagDrillRoot: () => void;
}

const DagContext = createContext<DagContextValue | null>(null);

export function DagProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(dagReducer, initialState);

  const toggleDag = useCallback(() => dispatch({ type: 'TOGGLE' }), []);
  const dagDrillIn = useCallback((nodeId: string) => dispatch({ type: 'DRILL_IN', nodeId }), []);
  const dagDrillOut = useCallback(() => dispatch({ type: 'DRILL_OUT' }), []);
  const dagDrillRoot = useCallback(() => dispatch({ type: 'DRILL_ROOT' }), []);

  const value = useMemo<DagContextValue>(
    () => ({
      dagCollapsed: state.collapsed,
      dagBreadcrumb: state.breadcrumb,
      toggleDag,
      dagDrillIn,
      dagDrillOut,
      dagDrillRoot,
    }),
    [state.collapsed, state.breadcrumb, toggleDag, dagDrillIn, dagDrillOut, dagDrillRoot],
  );

  return (
    <DagContext.Provider value={value}>
      {children}
    </DagContext.Provider>
  );
}

export function useDag(): DagContextValue {
  const ctx = useContext(DagContext);
  if (!ctx) throw new Error('useDag must be used within DagProvider');
  return ctx;
}
