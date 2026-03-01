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
  forwardStack: string[];
}

/* ── Actions ──────────────────────────────────────────────── */

type DagAction =
  | { type: 'TOGGLE' }
  | { type: 'DRILL_IN'; nodeId: string }
  | { type: 'DRILL_OUT' }
  | { type: 'DRILL_ROOT' }
  | { type: 'DRILL_FORWARD' };

const initialState: DagState = {
  collapsed: false,
  breadcrumb: [],
  forwardStack: [],
};

function dagReducer(state: DagState, action: DagAction): DagState {
  switch (action.type) {
    case 'TOGGLE':
      return { ...state, collapsed: !state.collapsed };
    case 'DRILL_IN':
      return { ...state, breadcrumb: [...state.breadcrumb, action.nodeId], forwardStack: [] };
    case 'DRILL_OUT': {
      if (state.breadcrumb.length === 0) return state;
      const popped = state.breadcrumb[state.breadcrumb.length - 1];
      return {
        ...state,
        breadcrumb: state.breadcrumb.slice(0, -1),
        forwardStack: [popped, ...state.forwardStack],
      };
    }
    case 'DRILL_FORWARD': {
      if (state.forwardStack.length === 0) return state;
      const [next, ...rest] = state.forwardStack;
      return {
        ...state,
        breadcrumb: [...state.breadcrumb, next],
        forwardStack: rest,
      };
    }
    case 'DRILL_ROOT':
      return { ...state, breadcrumb: [], forwardStack: [] };
    default:
      return state;
  }
}

/* ── Context ──────────────────────────────────────────────── */

interface DagContextValue {
  dagCollapsed: boolean;
  dagBreadcrumb: string[];
  canGoForward: boolean;
  toggleDag: () => void;
  dagDrillIn: (nodeId: string) => void;
  dagDrillOut: () => void;
  dagDrillForward: () => void;
  dagDrillRoot: () => void;
}

const DagContext = createContext<DagContextValue | null>(null);

export function DagProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(dagReducer, initialState);

  const toggleDag = useCallback(() => dispatch({ type: 'TOGGLE' }), []);
  const dagDrillIn = useCallback((nodeId: string) => dispatch({ type: 'DRILL_IN', nodeId }), []);
  const dagDrillOut = useCallback(() => dispatch({ type: 'DRILL_OUT' }), []);
  const dagDrillForward = useCallback(() => dispatch({ type: 'DRILL_FORWARD' }), []);
  const dagDrillRoot = useCallback(() => dispatch({ type: 'DRILL_ROOT' }), []);

  const value = useMemo<DagContextValue>(
    () => ({
      dagCollapsed: state.collapsed,
      dagBreadcrumb: state.breadcrumb,
      canGoForward: state.forwardStack.length > 0,
      toggleDag,
      dagDrillIn,
      dagDrillOut,
      dagDrillForward,
      dagDrillRoot,
    }),
    [state.collapsed, state.breadcrumb, state.forwardStack.length, toggleDag, dagDrillIn, dagDrillOut, dagDrillForward, dagDrillRoot],
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
