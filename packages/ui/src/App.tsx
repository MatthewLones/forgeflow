import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ProjectStoreProvider } from './context/ProjectStore';
import { DashboardPage } from './pages/DashboardPage';
import { RunLayout } from './layouts/RunLayout';

const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })),
);

const RunDashboardPage = lazy(() =>
  import('./pages/RunDashboardPage').then((m) => ({ default: m.RunDashboardPage })),
);

const InterruptPage = lazy(() =>
  import('./pages/InterruptPage').then((m) => ({ default: m.InterruptPage })),
);

const CheckpointPage = lazy(() =>
  import('./pages/CheckpointPage').then((m) => ({ default: m.CheckpointPage })),
);

const RunListPage = lazy(() =>
  import('./pages/RunListPage').then((m) => ({ default: m.RunListPage })),
);

const GitHubCallbackPage = lazy(() =>
  import('./pages/GitHubCallbackPage').then((m) => ({ default: m.GitHubCallbackPage })),
);

function Loading() {
  return (
    <div className="h-screen flex items-center justify-center text-sm text-[var(--color-text-muted)]">
      Loading...
    </div>
  );
}

/** Redirect /design/:id → /workspace/:id (preserving the actual param) */
function DesignRedirect() {
  const { id } = useParams();
  return <Navigate to={`/workspace/${id}`} replace />;
}

/** Redirect /skills/:id → /workspace/:id with skill query param */
function SkillRedirect() {
  const { id } = useParams();
  return <Navigate to={`/workspace/${id}`} replace />;
}

export function App() {
  return (
    <ProjectStoreProvider>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/workspace/:id"
          element={
            <Suspense fallback={<Loading />}>
              <WorkspacePage />
            </Suspense>
          }
        />
        <Route
          path="/projects/:projectId/runs"
          element={
            <Suspense fallback={<Loading />}>
              <RunListPage />
            </Suspense>
          }
        />
        <Route path="/projects/:projectId/runs/:runId" element={<RunLayout />}>
          <Route
            index
            element={
              <Suspense fallback={<Loading />}>
                <RunDashboardPage />
              </Suspense>
            }
          />
          <Route
            path="interrupts"
            element={
              <Suspense fallback={<Loading />}>
                <InterruptPage />
              </Suspense>
            }
          />
          <Route
            path="checkpoint"
            element={
              <Suspense fallback={<Loading />}>
                <CheckpointPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          path="/github/callback"
          element={
            <Suspense fallback={<Loading />}>
              <GitHubCallbackPage />
            </Suspense>
          }
        />
        {/* Legacy routes redirect to workspace with actual :id param */}
        <Route path="/design/:id" element={<DesignRedirect />} />
        <Route path="/skills/:id" element={<SkillRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProjectStoreProvider>
  );
}
