import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  LayoutNode,
  SplitDirection,
} from '../lib/layout-tree';
import {
  replaceLeaf,
  removeLeaf,
  simplifyTree,
  getAllGroupIds,
  resizeSplitForGroup,
} from '../lib/layout-tree';

/* ── Types ───────────────────────────────────────────────── */

export interface EditorTab {
  id: string;           // nodeId for agents, "skill:{name}" for skills, "ref:{path}" for references
  type: 'agent' | 'skill' | 'reference';
  label: string;
  nodeId?: string;      // populated for agent tabs
  skillName?: string;   // populated for skill tabs
  refPath?: string;     // populated for reference tabs
}

export interface EditorGroup {
  id: string;
  tabs: EditorTab[];
  activeTabId: string | null;
}

export type WorkspaceSelection =
  | { type: 'agent'; nodeId: string }
  | { type: 'skill'; skillName: string }
  | { type: 'reference'; refPath: string }
  | null;

interface WorkspaceState {
  groups: Record<string, EditorGroup>;
  layout: LayoutNode;
  activeGroupId: string;
  dagCollapsed: boolean;
  bottomPanelHeight: number;
  bottomPanelTab: string;
  dagBreadcrumb: string[];
}

/* ── Actions ─────────────────────────────────────────────── */

type WorkspaceAction =
  // Tab actions (group-aware)
  | { type: 'OPEN_TAB'; tab: EditorTab; groupId?: string }
  | { type: 'CLOSE_TAB'; tabId: string; groupId: string }
  | { type: 'ACTIVATE_TAB'; tabId: string; groupId: string }
  | { type: 'UPDATE_TAB_LABEL'; tabId: string; label: string }
  | { type: 'REORDER_TAB'; groupId: string; fromIndex: number; toIndex: number }
  | { type: 'MOVE_TAB_TO_GROUP'; tabId: string; fromGroupId: string; toGroupId: string; toIndex?: number }
  // Split pane actions
  | { type: 'SPLIT_GROUP'; groupId: string; direction: SplitDirection; tabId?: string; fromGroupId?: string }
  | { type: 'CLOSE_GROUP'; groupId: string }
  | { type: 'RESIZE_SPLIT'; path: number[]; sizes: number[] }
  | { type: 'SET_ACTIVE_GROUP'; groupId: string }
  // Existing actions (unchanged)
  | { type: 'TOGGLE_DAG' }
  | { type: 'SET_BOTTOM_PANEL_HEIGHT'; height: number }
  | { type: 'SET_BOTTOM_PANEL_TAB'; tab: string }
  | { type: 'DAG_DRILL_IN'; nodeId: string }
  | { type: 'DAG_DRILL_OUT' }
  | { type: 'DAG_DRILL_ROOT' };

/* ── Helpers ─────────────────────────────────────────────── */

let groupCounter = 1;
function nextGroupId(): string {
  return `group-${++groupCounter}`;
}

function findTabInAllGroups(
  groups: Record<string, EditorGroup>,
  tabId: string,
): { groupId: string; tab: EditorTab } | null {
  for (const group of Object.values(groups)) {
    const tab = group.tabs.find((t) => t.id === tabId);
    if (tab) return { groupId: group.id, tab };
  }
  return null;
}

function updateGroup(
  groups: Record<string, EditorGroup>,
  groupId: string,
  updater: (g: EditorGroup) => EditorGroup,
): Record<string, EditorGroup> {
  const group = groups[groupId];
  if (!group) return groups;
  return { ...groups, [groupId]: updater(group) };
}

function removeTabFromGroup(group: EditorGroup, tabId: string): EditorGroup {
  const closingIndex = group.tabs.findIndex((t) => t.id === tabId);
  if (closingIndex === -1) return group;
  const newTabs = group.tabs.filter((t) => t.id !== tabId);
  let newActiveId = group.activeTabId;
  if (group.activeTabId === tabId) {
    if (newTabs.length === 0) {
      newActiveId = null;
    } else if (closingIndex >= newTabs.length) {
      newActiveId = newTabs[newTabs.length - 1].id;
    } else {
      newActiveId = newTabs[closingIndex].id;
    }
  }
  return { ...group, tabs: newTabs, activeTabId: newActiveId };
}

/* ── Reducer ─────────────────────────────────────────────── */

const INITIAL_GROUP_ID = 'group-1';

const initialState: WorkspaceState = {
  groups: {
    [INITIAL_GROUP_ID]: { id: INITIAL_GROUP_ID, tabs: [], activeTabId: null },
  },
  layout: { type: 'leaf', groupId: INITIAL_GROUP_ID },
  activeGroupId: INITIAL_GROUP_ID,
  dagCollapsed: false,
  bottomPanelHeight: 0,
  bottomPanelTab: 'io',
  dagBreadcrumb: [],
};

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    /* ── Tab actions ──────────────────────────────────── */

    case 'OPEN_TAB': {
      // Search all groups for existing tab (deduplicate across groups)
      const existing = findTabInAllGroups(state.groups, action.tab.id);
      if (existing) {
        // Activate existing tab in its group + focus that group
        return {
          ...state,
          groups: updateGroup(state.groups, existing.groupId, (g) => ({
            ...g,
            activeTabId: existing.tab.id,
          })),
          activeGroupId: existing.groupId,
        };
      }
      const targetGroupId = action.groupId ?? state.activeGroupId;
      const group = state.groups[targetGroupId];
      if (!group) return state;
      const activeIndex = group.tabs.findIndex((t) => t.id === group.activeTabId);
      const insertAt = activeIndex >= 0 ? activeIndex + 1 : group.tabs.length;
      const newTabs = [...group.tabs];
      newTabs.splice(insertAt, 0, action.tab);
      return {
        ...state,
        groups: updateGroup(state.groups, targetGroupId, (g) => ({
          ...g,
          tabs: newTabs,
          activeTabId: action.tab.id,
        })),
        activeGroupId: targetGroupId,
      };
    }

    case 'CLOSE_TAB': {
      const group = state.groups[action.groupId];
      if (!group) return state;
      const updatedGroup = removeTabFromGroup(group, action.tabId);
      let newState = {
        ...state,
        groups: { ...state.groups, [action.groupId]: updatedGroup },
      };
      // Auto-close empty non-sole groups
      const allIds = getAllGroupIds(newState.layout);
      if (updatedGroup.tabs.length === 0 && allIds.length > 1) {
        const { [action.groupId]: _, ...remainingGroups } = newState.groups;
        const newLayout = removeLeaf(newState.layout, action.groupId);
        const remainingIds = getAllGroupIds(newLayout);
        return {
          ...newState,
          groups: remainingGroups,
          layout: newLayout,
          activeGroupId: remainingIds.includes(newState.activeGroupId)
            ? newState.activeGroupId
            : remainingIds[0] ?? INITIAL_GROUP_ID,
        };
      }
      return newState;
    }

    case 'ACTIVATE_TAB': {
      const group = state.groups[action.groupId];
      if (!group || !group.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        ...state,
        groups: updateGroup(state.groups, action.groupId, (g) => ({
          ...g,
          activeTabId: action.tabId,
        })),
        activeGroupId: action.groupId,
      };
    }

    case 'UPDATE_TAB_LABEL': {
      // Search all groups
      const newGroups = { ...state.groups };
      for (const [gid, group] of Object.entries(newGroups)) {
        const hasTab = group.tabs.some((t) => t.id === action.tabId);
        if (hasTab) {
          newGroups[gid] = {
            ...group,
            tabs: group.tabs.map((t) =>
              t.id === action.tabId ? { ...t, label: action.label } : t,
            ),
          };
          break;
        }
      }
      return { ...state, groups: newGroups };
    }

    case 'REORDER_TAB': {
      const group = state.groups[action.groupId];
      if (!group) return state;
      const newTabs = [...group.tabs];
      const [moved] = newTabs.splice(action.fromIndex, 1);
      newTabs.splice(action.toIndex, 0, moved);
      return {
        ...state,
        groups: updateGroup(state.groups, action.groupId, (g) => ({
          ...g,
          tabs: newTabs,
        })),
      };
    }

    case 'MOVE_TAB_TO_GROUP': {
      const fromGroup = state.groups[action.fromGroupId];
      const toGroup = state.groups[action.toGroupId];
      if (!fromGroup || !toGroup) return state;
      const tab = fromGroup.tabs.find((t) => t.id === action.tabId);
      if (!tab) return state;

      // Remove from source
      const updatedFrom = removeTabFromGroup(fromGroup, action.tabId);

      // Add to target
      const toIndex = action.toIndex ?? toGroup.tabs.length;
      const newToTabs = [...toGroup.tabs];
      newToTabs.splice(toIndex, 0, tab);

      let newGroups = {
        ...state.groups,
        [action.fromGroupId]: updatedFrom,
        [action.toGroupId]: { ...toGroup, tabs: newToTabs, activeTabId: tab.id },
      };

      let newLayout = state.layout;
      let newActiveGroupId = action.toGroupId;

      // Auto-close empty source group
      const allIds = getAllGroupIds(state.layout);
      if (updatedFrom.tabs.length === 0 && allIds.length > 1) {
        const { [action.fromGroupId]: _, ...remaining } = newGroups;
        newGroups = remaining;
        newLayout = removeLeaf(newLayout, action.fromGroupId);
      }

      return {
        ...state,
        groups: newGroups,
        layout: newLayout,
        activeGroupId: newActiveGroupId,
      };
    }

    /* ── Split pane actions ───────────────────────────── */

    case 'SPLIT_GROUP': {
      const group = state.groups[action.groupId];
      if (!group) return state;

      const newGroupId = nextGroupId();
      let newGroupTabs: EditorTab[] = [];
      let newGroupActiveTab: string | null = null;

      // The group whose tabs are modified when moving a tab
      const sourceGroupId = action.fromGroupId ?? action.groupId;
      const sourceGroup = state.groups[sourceGroupId];
      let updatedSourceGroup = sourceGroup ?? group;
      let updatedTargetGroup = group;

      // Optionally move a specific tab to the new group
      if (action.tabId && sourceGroup) {
        const tab = sourceGroup.tabs.find((t) => t.id === action.tabId);
        if (tab) {
          newGroupTabs = [tab];
          newGroupActiveTab = tab.id;
          updatedSourceGroup = removeTabFromGroup(sourceGroup, action.tabId);
          // If source and target are the same group, update both references
          if (sourceGroupId === action.groupId) {
            updatedTargetGroup = updatedSourceGroup;
          }
        }
      }

      const newGroup: EditorGroup = {
        id: newGroupId,
        tabs: newGroupTabs,
        activeTabId: newGroupActiveTab,
      };

      // Replace the leaf with a split containing old + new
      const newLayout = replaceLeaf(state.layout, action.groupId, {
        type: 'split',
        direction: action.direction,
        children: [
          { type: 'leaf', groupId: action.groupId },
          { type: 'leaf', groupId: newGroupId },
        ],
        sizes: [0.5, 0.5],
      });

      let newGroups = {
        ...state.groups,
        [action.groupId]: updatedTargetGroup,
        [sourceGroupId]: updatedSourceGroup,
        [newGroupId]: newGroup,
      };

      let finalLayout = simplifyTree(newLayout);

      // Auto-close empty source group if it's different from target
      if (sourceGroupId !== action.groupId && updatedSourceGroup.tabs.length === 0) {
        const allIds = getAllGroupIds(finalLayout);
        if (allIds.length > 1) {
          const { [sourceGroupId]: _, ...remaining } = newGroups;
          newGroups = remaining;
          finalLayout = removeLeaf(finalLayout, sourceGroupId);
        }
      }

      return {
        ...state,
        groups: newGroups,
        layout: finalLayout,
        activeGroupId: newGroupId,
      };
    }

    case 'CLOSE_GROUP': {
      const allIds = getAllGroupIds(state.layout);
      if (allIds.length <= 1) return state; // can't close the last group

      const { [action.groupId]: _, ...remainingGroups } = state.groups;
      const newLayout = removeLeaf(state.layout, action.groupId);
      const remainingIds = getAllGroupIds(newLayout);

      return {
        ...state,
        groups: remainingGroups,
        layout: newLayout,
        activeGroupId: remainingIds.includes(state.activeGroupId)
          ? state.activeGroupId
          : remainingIds[0] ?? INITIAL_GROUP_ID,
      };
    }

    case 'RESIZE_SPLIT': {
      return {
        ...state,
        layout: resizeSplitForGroup(state.layout, action.path, action.sizes),
      };
    }

    case 'SET_ACTIVE_GROUP': {
      if (!state.groups[action.groupId]) return state;
      return { ...state, activeGroupId: action.groupId };
    }

    /* ── Existing actions (unchanged) ─────────────────── */

    case 'TOGGLE_DAG':
      return { ...state, dagCollapsed: !state.dagCollapsed };

    case 'SET_BOTTOM_PANEL_HEIGHT':
      return { ...state, bottomPanelHeight: Math.max(0, Math.min(400, action.height)) };

    case 'SET_BOTTOM_PANEL_TAB': {
      if (state.bottomPanelTab === action.tab && state.bottomPanelHeight > 0) {
        return { ...state, bottomPanelHeight: 0 };
      }
      return {
        ...state,
        bottomPanelTab: action.tab,
        bottomPanelHeight: state.bottomPanelHeight === 0 ? 160 : state.bottomPanelHeight,
      };
    }

    case 'DAG_DRILL_IN':
      return { ...state, dagBreadcrumb: [...state.dagBreadcrumb, action.nodeId] };

    case 'DAG_DRILL_OUT':
      return { ...state, dagBreadcrumb: state.dagBreadcrumb.slice(0, -1) };

    case 'DAG_DRILL_ROOT':
      return { ...state, dagBreadcrumb: [] };

    default:
      return state;
  }
}

/* ── Context ─────────────────────────────────────────────── */

interface WorkspaceContextValue {
  // Backward-compatible: derived from active group
  tabs: EditorTab[];
  activeTabId: string | null;
  selection: WorkspaceSelection;

  // New: group-aware
  groups: Record<string, EditorGroup>;
  layout: LayoutNode;
  activeGroupId: string;

  // Tab actions
  openTab: (tab: EditorTab, groupId?: string) => void;
  closeTab: (tabId: string, groupId?: string) => void;
  activateTab: (tabId: string, groupId?: string) => void;
  updateTabLabel: (tabId: string, label: string) => void;
  reorderTab: (groupId: string, fromIndex: number, toIndex: number) => void;
  moveTabToGroup: (tabId: string, fromGroupId: string, toGroupId: string, toIndex?: number) => void;

  // Selection shortcuts
  selectAgent: (nodeId: string, label?: string) => void;
  selectSkill: (skillName: string) => void;
  selectReference: (refPath: string, label?: string) => void;
  clearSelection: () => void;

  // Split pane actions
  splitGroup: (groupId: string, direction: SplitDirection, tabId?: string, fromGroupId?: string) => void;
  closeGroup: (groupId: string) => void;
  resizeSplit: (path: number[], sizes: number[]) => void;
  setActiveGroup: (groupId: string) => void;

  // Existing
  dagCollapsed: boolean;
  bottomPanelHeight: number;
  bottomPanelTab: string;
  dagBreadcrumb: string[];
  toggleDag: () => void;
  dagDrillIn: (nodeId: string) => void;
  dagDrillOut: () => void;
  dagDrillRoot: () => void;
  setBottomPanelHeight: (height: number) => void;
  setBottomPanelTab: (tab: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function selectionFromGroup(group: EditorGroup | undefined): WorkspaceSelection {
  if (!group || !group.activeTabId) return null;
  const tab = group.tabs.find((t) => t.id === group.activeTabId);
  if (!tab) return null;
  if (tab.type === 'agent' && tab.nodeId) return { type: 'agent', nodeId: tab.nodeId };
  if (tab.type === 'skill' && tab.skillName) return { type: 'skill', skillName: tab.skillName };
  if (tab.type === 'reference' && tab.refPath) return { type: 'reference', refPath: tab.refPath };
  return null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);

  const activeGroup = state.groups[state.activeGroupId];

  // Backward-compatible derived values
  const tabs = activeGroup?.tabs ?? [];
  const activeTabId = activeGroup?.activeTabId ?? null;
  const selection = useMemo(() => selectionFromGroup(activeGroup), [activeGroup]);

  // Tab actions
  const openTab = useCallback((tab: EditorTab, groupId?: string) =>
    dispatch({ type: 'OPEN_TAB', tab, groupId }), []);
  const closeTab = useCallback((tabId: string, groupId?: string) =>
    dispatch({ type: 'CLOSE_TAB', tabId, groupId: groupId ?? state.activeGroupId }), [state.activeGroupId]);
  const activateTab = useCallback((tabId: string, groupId?: string) =>
    dispatch({ type: 'ACTIVATE_TAB', tabId, groupId: groupId ?? state.activeGroupId }), [state.activeGroupId]);
  const updateTabLabel = useCallback((tabId: string, label: string) =>
    dispatch({ type: 'UPDATE_TAB_LABEL', tabId, label }), []);
  const reorderTab = useCallback((groupId: string, fromIndex: number, toIndex: number) =>
    dispatch({ type: 'REORDER_TAB', groupId, fromIndex, toIndex }), []);
  const moveTabToGroup = useCallback((tabId: string, fromGroupId: string, toGroupId: string, toIndex?: number) =>
    dispatch({ type: 'MOVE_TAB_TO_GROUP', tabId, fromGroupId, toGroupId, toIndex }), []);

  // Selection shortcuts
  const selectAgent = useCallback((nodeId: string, label?: string) => {
    dispatch({ type: 'OPEN_TAB', tab: { id: nodeId, type: 'agent', label: label ?? nodeId, nodeId } });
  }, []);
  const selectSkill = useCallback((skillName: string) => {
    dispatch({ type: 'OPEN_TAB', tab: { id: `skill:${skillName}`, type: 'skill', label: skillName, skillName } });
  }, []);
  const selectReference = useCallback((refPath: string, label?: string) => {
    const displayLabel = label ?? refPath.split('/').pop() ?? refPath;
    dispatch({ type: 'OPEN_TAB', tab: { id: `ref:${refPath}`, type: 'reference', label: displayLabel, refPath } });
  }, []);
  const clearSelection = useCallback(() => {
    const group = state.groups[state.activeGroupId];
    if (group?.activeTabId) {
      dispatch({ type: 'CLOSE_TAB', tabId: group.activeTabId, groupId: state.activeGroupId });
    }
  }, [state.activeGroupId, state.groups]);

  // Split pane actions
  const splitGroup = useCallback((groupId: string, direction: SplitDirection, tabId?: string, fromGroupId?: string) =>
    dispatch({ type: 'SPLIT_GROUP', groupId, direction, tabId, fromGroupId }), []);
  const closeGroup = useCallback((groupId: string) =>
    dispatch({ type: 'CLOSE_GROUP', groupId }), []);
  const resizeSplit = useCallback((path: number[], sizes: number[]) =>
    dispatch({ type: 'RESIZE_SPLIT', path, sizes }), []);
  const setActiveGroup = useCallback((groupId: string) =>
    dispatch({ type: 'SET_ACTIVE_GROUP', groupId }), []);

  // Existing
  const toggleDag = useCallback(() => dispatch({ type: 'TOGGLE_DAG' }), []);
  const dagDrillIn = useCallback((nodeId: string) => dispatch({ type: 'DAG_DRILL_IN', nodeId }), []);
  const dagDrillOut = useCallback(() => dispatch({ type: 'DAG_DRILL_OUT' }), []);
  const dagDrillRoot = useCallback(() => dispatch({ type: 'DAG_DRILL_ROOT' }), []);
  const setBottomPanelHeight = useCallback((height: number) => dispatch({ type: 'SET_BOTTOM_PANEL_HEIGHT', height }), []);
  const setBottomPanelTab = useCallback((tab: string) => dispatch({ type: 'SET_BOTTOM_PANEL_TAB', tab }), []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      tabs, activeTabId, selection,
      groups: state.groups, layout: state.layout, activeGroupId: state.activeGroupId,
      openTab, closeTab, activateTab, updateTabLabel, reorderTab, moveTabToGroup,
      selectAgent, selectSkill, selectReference, clearSelection,
      splitGroup, closeGroup, resizeSplit, setActiveGroup,
      dagCollapsed: state.dagCollapsed,
      bottomPanelHeight: state.bottomPanelHeight,
      bottomPanelTab: state.bottomPanelTab,
      dagBreadcrumb: state.dagBreadcrumb,
      toggleDag, dagDrillIn, dagDrillOut, dagDrillRoot,
      setBottomPanelHeight, setBottomPanelTab,
    }),
    [
      tabs, activeTabId, selection,
      state.groups, state.layout, state.activeGroupId,
      state.dagCollapsed, state.bottomPanelHeight, state.bottomPanelTab, state.dagBreadcrumb,
      openTab, closeTab, activateTab, updateTabLabel, reorderTab, moveTabToGroup,
      selectAgent, selectSkill, selectReference, clearSelection,
      splitGroup, closeGroup, resizeSplit, setActiveGroup,
      toggleDag, dagDrillIn, dagDrillOut, dagDrillRoot,
      setBottomPanelHeight, setBottomPanelTab,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
