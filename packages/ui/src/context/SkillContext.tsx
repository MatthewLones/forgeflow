import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
  type Dispatch,
} from 'react';

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillState {
  skillName: string;
  files: SkillFile[];
  selectedFilePath: string | null;
  dirty: boolean;
}

export type SkillAction =
  | { type: 'SELECT_FILE'; path: string }
  | { type: 'UPDATE_FILE'; path: string; content: string }
  | { type: 'ADD_FILE'; path: string; content: string }
  | { type: 'DELETE_FILE'; path: string }
  | { type: 'RENAME_FILE'; oldPath: string; newPath: string }
  | { type: 'SET_SKILL'; state: SkillState };

function skillReducer(state: SkillState, action: SkillAction): SkillState {
  switch (action.type) {
    case 'SELECT_FILE':
      return { ...state, selectedFilePath: action.path };

    case 'UPDATE_FILE':
      return {
        ...state,
        files: state.files.map((f) =>
          f.path === action.path ? { ...f, content: action.content } : f,
        ),
        dirty: true,
      };

    case 'ADD_FILE': {
      if (state.files.some((f) => f.path === action.path)) return state;
      return {
        ...state,
        files: [...state.files, { path: action.path, content: action.content }],
        selectedFilePath: action.path,
        dirty: true,
      };
    }

    case 'DELETE_FILE': {
      if (action.path === 'SKILL.md') return state; // Can't delete SKILL.md
      return {
        ...state,
        files: state.files.filter((f) => f.path !== action.path),
        selectedFilePath:
          state.selectedFilePath === action.path ? 'SKILL.md' : state.selectedFilePath,
        dirty: true,
      };
    }

    case 'RENAME_FILE': {
      if (action.oldPath === 'SKILL.md') return state;
      return {
        ...state,
        files: state.files.map((f) =>
          f.path === action.oldPath ? { ...f, path: action.newPath } : f,
        ),
        selectedFilePath:
          state.selectedFilePath === action.oldPath ? action.newPath : state.selectedFilePath,
        dirty: true,
      };
    }

    case 'SET_SKILL':
      return action.state;

    default:
      return state;
  }
}

interface SkillContextValue {
  state: SkillState;
  dispatch: Dispatch<SkillAction>;

  selectedFile: SkillFile | null;
  selectFile: (path: string) => void;
  updateFile: (path: string, content: string) => void;
  addFile: (path: string, content?: string) => void;
  deleteFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
}

const SkillContext = createContext<SkillContextValue | null>(null);

interface SkillProviderProps {
  initialState: SkillState;
  children: ReactNode;
}

export function SkillProvider({ initialState, children }: SkillProviderProps) {
  const [state, dispatch] = useReducer(skillReducer, initialState);

  const selectedFile = state.selectedFilePath
    ? state.files.find((f) => f.path === state.selectedFilePath) ?? null
    : null;

  const selectFile = useCallback(
    (path: string) => dispatch({ type: 'SELECT_FILE', path }),
    [],
  );

  const updateFile = useCallback(
    (path: string, content: string) => dispatch({ type: 'UPDATE_FILE', path, content }),
    [],
  );

  const addFile = useCallback(
    (path: string, content?: string) => {
      const defaultContent = path.endsWith('.md')
        ? `---\ntitle: "${path.split('/').pop()?.replace('.md', '') ?? ''}"\ncategory: general\nrelevance: ""\n---\n\n# ${path.split('/').pop()?.replace('.md', '') ?? ''}\n\n`
        : '';
      dispatch({ type: 'ADD_FILE', path, content: content ?? defaultContent });
    },
    [],
  );

  const deleteFile = useCallback(
    (path: string) => dispatch({ type: 'DELETE_FILE', path }),
    [],
  );

  const renameFile = useCallback(
    (oldPath: string, newPath: string) =>
      dispatch({ type: 'RENAME_FILE', oldPath, newPath }),
    [],
  );

  return (
    <SkillContext.Provider
      value={{
        state,
        dispatch,
        selectedFile,
        selectFile,
        updateFile,
        addFile,
        deleteFile,
        renameFile,
      }}
    >
      {children}
    </SkillContext.Provider>
  );
}

export function useSkill(): SkillContextValue {
  const ctx = useContext(SkillContext);
  if (!ctx) throw new Error('useSkill must be used within SkillProvider');
  return ctx;
}
